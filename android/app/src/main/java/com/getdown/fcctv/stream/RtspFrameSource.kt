package com.getdown.fcctv.stream

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.media.Image
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.os.SystemClock
import android.util.Log
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.IOException
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.util.Base64
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Pulls the glasses' live camera and turns it into ~1 JPEG per second for Gemini.
 *
 * RTSP FRAME EXTRACTION, STEP BY STEP
 *  1. TCP-connect to rtsp://<glasses-ip>:8554/ch0 (retries while the glasses boot their server).
 *  2. RTSP DESCRIBE -> read the SDP: video track URL and the H.264 SPS/PPS (sprop-parameter-sets).
 *  3. SETUP with RTP interleaved over the same TCP socket (channels 0-1), then PLAY.
 *  4. Every 2 s send RTSP OPTIONS + an RTCP receiver report. Without these keep-alives the
 *     glasses stall after about three frames.
 *  5. Interleaved packets start with '$'. For the video channel we strip the RTP header
 *     and depacketize H.264 per RFC 6184: single NAL units (types 1-23), STAP-A (24) and
 *     FU-A fragments (28) are reassembled into Annex-B access units.
 *  6. A complete access unit (RTP marker bit or new timestamp) goes into a hardware
 *     MediaCodec H.264 decoder that outputs YUV420 images (no Surface needed).
 *  7. At most once per [frameIntervalMs] a decoded image is converted YUV -> NV21 -> JPEG,
 *     scaled to fit within [maxSide] x [maxSide] (768 is Gemini's native image tile) and
 *     handed to [Listener.frame]. Only the latest frame is kept; nothing is saved to disk.
 *
 * Ported from github.com/jacob-kruger-work/heycyan_live_stream (RtspFrames.java),
 * which was verified on real HeyCyan hardware.
 */
class RtspFrameSource(
    private val host: String,
    private val listener: Listener,
    private val maxSide: Int = 768,
    private val frameIntervalMs: Long = 1000,
) : AutoCloseable {
    interface Listener {
        fun frame(jpeg: ByteArray)
        fun error(message: String)
    }

    private class Response { val headers = HashMap<String, String>(); var body = ""; var status = 0 }

    @Volatile private var closed = false
    @Volatile private var socket: Socket? = null
    private lateinit var input: DataInputStream
    private lateinit var output: OutputStream
    private var cseq = 0
    private var session: String? = null
    private val base = "rtsp://$host:8554/ch0"
    private var codec: MediaCodec? = null
    private val accessUnit = ByteArrayOutputStream()
    private var fragment: ByteArrayOutputStream? = null
    private var sps: ByteArray? = null
    private var pps: ByteArray? = null
    private var lastSequence = -1
    private var damaged = false
    private var timestamp = -1L
    private var lastPublished = 0L
    private var lastVideo = 0L
    private var videoChannel = 0
    private var rtcpChannel = 1
    @Volatile private var senderSsrc = 0
    @Volatile private var highestSequence = 0
    private var sequenceCycles = 0
    private val keepalive = Executors.newSingleThreadScheduledExecutor()

    fun start() {
        Thread({ loop() }, "fcctv-rtsp").apply { isDaemon = true; start() }
    }

    private fun loop() {
        try {
            var connectError: IOException? = null
            for (attempt in 0 until 40) {
                if (closed) return
                val s = Socket()
                socket = s
                try {
                    s.connect(InetSocketAddress(host, 8554), 2000); connectError = null; break
                } catch (e: IOException) {
                    connectError = e; s.close()
                    if (attempt % 5 == 0) Log.i(TAG, "Waiting for RTSP server on $host:8554")
                    Thread.sleep(500)
                }
            }
            if (closed) return
            if (connectError != null) throw IOException("Glasses joined Wi-Fi but never opened RTSP port 8554", connectError)
            val s = socket!!
            s.soTimeout = 10_000
            s.tcpNoDelay = true
            input = DataInputStream(BufferedInputStream(s.getInputStream(), 65536))
            output = s.getOutputStream()

            val description = request("DESCRIBE", base, "Accept: application/sdp\r\n")
            val contentBase = description.headers["content-base"] ?: "$base/"
            var track: String? = null
            var video = false
            for (line in description.body.split(Regex("\r?\n"))) {
                if (line.startsWith("m=")) video = line.startsWith("m=video")
                if (video && line.startsWith("a=control:")) track = line.substring(10).trim()
                if (video && line.startsWith("a=fmtp:") && line.contains("sprop-parameter-sets=")) {
                    val param = line.substringAfter("sprop-parameter-sets=").split(Regex("[; ]"), 2)[0]
                    val sets = param.split(",")
                    if (sets.size >= 2) { sps = Base64.getDecoder().decode(sets[0]); pps = Base64.getDecoder().decode(sets[1]) }
                }
            }
            val t = track ?: throw IOException("RTSP description has no video track")
            val trackUrl = when {
                t.startsWith("rtsp://") -> t
                t.startsWith("/") -> "rtsp://$host:8554$t"
                else -> contentBase + (if (contentBase.endsWith("/")) "" else "/") + t
            }
            val setup = request("SETUP", trackUrl, "Transport: RTP/AVP/TCP;unicast;interleaved=0-1\r\n")
            session = (setup.headers["session"] ?: throw IOException("RTSP SETUP returned no session")).split(";", limit = 2)[0]
            setup.headers["transport"]?.takeIf { it.contains("interleaved=") }?.let {
                val ch = it.substringAfter("interleaved=").split(Regex("[-;]"))
                videoChannel = ch[0].toInt()
                if (ch.size > 1) rtcpChannel = ch[1].toInt()
            }
            request("PLAY", base, "Range: npt=0.000-\r\n")
            keepalive.scheduleAtFixedRate({
                if (!closed) try { send("OPTIONS", base, ""); receiverReport() } catch (e: IOException) {
                    if (!closed) { listener.error("RTSP keep-alive failed: ${e.message}"); close() }
                }
            }, 1, 2, TimeUnit.SECONDS)
            lastVideo = SystemClock.elapsedRealtime()
            while (!closed) {
                readItem(); drain()
                if (SystemClock.elapsedRealtime() - lastVideo > 15_000) throw IOException("No video packets for 15 seconds")
            }
        } catch (e: Exception) {
            if (!closed) { Log.e(TAG, "RTSP failed", e); listener.error("Live video: ${e.message ?: e.javaClass.simpleName}") }
        } finally {
            codec?.let { runCatching { it.stop() }; it.release() }
            codec = null
            close()
        }
    }

    @Synchronized
    private fun send(method: String, url: String, headers: String) {
        val msg = "$method $url RTSP/1.0\r\nCSeq: ${++cseq}\r\nUser-Agent: FCCTV/1.0\r\n" +
            (session?.let { "Session: $it\r\n" } ?: "") + headers + "\r\n"
        output.write(msg.toByteArray(Charsets.US_ASCII)); output.flush()
    }

    /** RFC 3550 compound RTCP receiver report + SDES CNAME, sent over interleaved channel. */
    @Synchronized
    private fun receiverReport() {
        if (senderSsrc == 0) return
        val r = ByteBuffer.allocate(52)
        r.put(0x81.toByte()).put(201.toByte()).putShort(7).putInt(SSRC)
        r.putInt(senderSsrc).putInt(0).putInt(highestSequence).putInt(0).putInt(0).putInt(0)
        r.put(0x81.toByte()).put(202.toByte()).putShort(4).putInt(SSRC)
        r.put(1).put(7).put("getdown".toByteArray(Charsets.US_ASCII)).put(0).putShort(0)
        output.write(byteArrayOf('$'.code.toByte(), rtcpChannel.toByte(), 0, 52)); output.write(r.array()); output.flush()
    }

    private fun request(method: String, url: String, headers: String): Response {
        send(method, url, headers)
        var resp: Response?
        do { resp = readItem() } while (resp == null && !closed)
        if (resp == null || resp.status != 200) throw IOException("$method failed: ${resp?.status ?: "closed"}")
        return resp
    }

    private fun readItem(): Response? {
        val first = input.readUnsignedByte()
        if (first == '$'.code) {
            val channel = input.readUnsignedByte()
            val length = input.readUnsignedShort()
            val packet = ByteArray(length); input.readFully(packet)
            if (channel == videoChannel) { lastVideo = SystemClock.elapsedRealtime(); rtp(packet) }
            return null
        }
        val header = ByteArrayOutputStream(); header.write(first)
        var tail = first
        while (tail != 0x0d0a0d0a) {
            val b = input.readUnsignedByte(); header.write(b); tail = (tail shl 8) or b
            if (header.size() > 16384) throw IOException("RTSP header too large")
        }
        val lines = header.toString("US-ASCII").split("\r\n")
        val resp = Response()
        val status = lines[0].split(" ")
        if (status.size < 2 || !status[0].startsWith("RTSP/")) throw IOException("Unexpected RTSP message")
        resp.status = status[1].toInt()
        for (i in 1 until lines.size) {
            val colon = lines[i].indexOf(':')
            if (colon > 0) resp.headers[lines[i].substring(0, colon).trim().lowercase(Locale.US)] = lines[i].substring(colon + 1).trim()
        }
        val len = (resp.headers["content-length"] ?: "0").toInt()
        if (len < 0 || len > 1024 * 1024) throw IOException("Invalid RTSP body length")
        val body = ByteArray(len); input.readFully(body)
        resp.body = String(body, Charsets.UTF_8)
        return resp
    }

    private fun rtp(p: ByteArray) {
        if (p.size < 12 || (p[0].toInt() and 0xc0) != 0x80) return
        var offset = 12 + 4 * (p[0].toInt() and 15)
        if (offset > p.size) return
        if ((p[0].toInt() and 16) != 0) {
            if (offset + 4 > p.size) return
            val words = ((p[offset + 2].toInt() and 255) shl 8) or (p[offset + 3].toInt() and 255)
            offset += 4 + 4 * words
        }
        var end = p.size
        if ((p[0].toInt() and 32) != 0) {
            val padding = p[end - 1].toInt() and 255
            if (padding == 0 || padding > end - offset) return
            end -= padding
        }
        if (offset >= end) return
        val sequence = ((p[2].toInt() and 255) shl 8) or (p[3].toInt() and 255)
        senderSsrc = ((p[8].toInt() and 255) shl 24) or ((p[9].toInt() and 255) shl 16) or ((p[10].toInt() and 255) shl 8) or (p[11].toInt() and 255)
        if (lastSequence > 60000 && sequence < 5000) sequenceCycles += 65536
        highestSequence = sequenceCycles + sequence
        val stamp = ((p[4].toLong() and 255) shl 24) or ((p[5].toLong() and 255) shl 16) or ((p[6].toLong() and 255) shl 8) or (p[7].toLong() and 255)
        if (timestamp != stamp) { flush(); timestamp = stamp; damaged = false; fragment = null }
        if (lastSequence != -1 && sequence != ((lastSequence + 1) and 65535)) { damaged = true; fragment = null }
        lastSequence = sequence
        val type = p[offset].toInt() and 31
        when {
            type in 1..23 -> nal(p.copyOfRange(offset, end))
            type == 24 -> { // STAP-A: several NAL units in one packet
                var i = offset + 1
                while (i + 2 <= end) {
                    val n = ((p[i].toInt() and 255) shl 8) or (p[i + 1].toInt() and 255); i += 2
                    if (n == 0 || i + n > end) { damaged = true; break }
                    nal(p.copyOfRange(i, i + n)); i += n
                }
            }
            type == 28 && offset + 2 < end -> { // FU-A: one NAL split across packets
                val flags = p[offset + 1].toInt() and 255
                if ((flags and 128) != 0) {
                    fragment = ByteArrayOutputStream().apply { write((p[offset].toInt() and 0xe0) or (flags and 31)) }
                }
                val f = fragment
                if (f != null) {
                    f.write(p, offset + 2, end - offset - 2)
                    if (f.size() > 4 * 1024 * 1024) throw IOException("H.264 fragment too large")
                    if ((flags and 64) != 0) { nal(f.toByteArray()); fragment = null }
                } else damaged = true
            }
        }
        if ((p[1].toInt() and 128) != 0) flush()
    }

    private fun nal(bytes: ByteArray) {
        when (bytes[0].toInt() and 31) { 7 -> sps = bytes; 8 -> pps = bytes }
        if (accessUnit.size() + bytes.size > 4 * 1024 * 1024) throw IOException("H.264 frame too large")
        accessUnit.write(byteArrayOf(0, 0, 0, 1)); accessUnit.write(bytes)
    }

    private fun flush() {
        val bytes = accessUnit.toByteArray(); accessUnit.reset()
        if (bytes.isEmpty() || damaged || fragment != null) return
        var c = codec
        if (c == null) {
            val s = sps ?: return
            val pp = pps ?: return
            val format = MediaFormat.createVideoFormat("video/avc", 1600, 1200).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
                setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 4 * 1024 * 1024)
                setByteBuffer("csd-0", annexB(s)); setByteBuffer("csd-1", annexB(pp))
            }
            c = MediaCodec.createDecoderByType("video/avc")
            c.configure(format, null, null, 0); c.start()
            codec = c
        }
        drain()
        var index = c.dequeueInputBuffer(10_000)
        if (index < 0) { drain(); index = c.dequeueInputBuffer(10_000) }
        if (index < 0) throw IOException("Video decoder input stalled")
        val buf = c.getInputBuffer(index)
        if (buf == null || buf.capacity() < bytes.size) throw IOException("Video decoder input too small")
        buf.clear(); buf.put(bytes)
        c.queueInputBuffer(index, 0, bytes.size, SystemClock.elapsedRealtimeNanos() / 1000, 0)
        drain()
    }

    private fun annexB(nal: ByteArray): ByteBuffer =
        ByteBuffer.allocate(nal.size + 4).apply { putInt(1); put(nal); flip() }

    private fun drain() {
        val c = codec ?: return
        val info = MediaCodec.BufferInfo()
        while (!closed) {
            val index = c.dequeueOutputBuffer(info, 0)
            if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) continue
            if (index < 0) return
            try {
                val now = SystemClock.elapsedRealtime()
                if (info.size > 0 && (lastPublished == 0L || now - lastPublished >= frameIntervalMs)) {
                    c.getOutputImage(index)?.use { img ->
                        val jpeg = toJpeg(img)
                        lastPublished = now
                        listener.frame(jpeg)
                    }
                }
            } finally {
                c.releaseOutputBuffer(index, false)
            }
        }
    }

    /** YUV420 (any stride / pixel stride) -> NV21 -> JPEG scaled to fit [maxSide]. */
    private fun toJpeg(image: Image): ByteArray {
        val crop = image.cropRect
        val w = crop.width() and 1.inv()
        val h = crop.height() and 1.inv()
        val nv21 = ByteArray(w * h * 3 / 2)
        val planes = image.planes
        if (planes.size != 3) throw IOException("Expected YUV420 planes")
        for (pl in 0..2) {
            val shift = if (pl == 0) 0 else 1
            val pw = w shr shift; val ph = h shr shift
            val buffer = planes[pl].buffer
            val stride = planes[pl].rowStride; val pixel = planes[pl].pixelStride
            val origin = buffer.position() + (crop.top shr shift) * stride + (crop.left shr shift) * pixel
            for (y in 0 until ph) for (x in 0 until pw) {
                val target = if (pl == 0) y * w + x else w * h + 2 * (y * pw + x) + (if (pl == 1) 1 else 0)
                nv21[target] = buffer.get(origin + y * stride + x * pixel)
            }
        }
        val full = ByteArrayOutputStream()
        YuvImage(nv21, ImageFormat.NV21, w, h, null).compressToJpeg(Rect(0, 0, w, h), 90, full)
        val raw = full.toByteArray()
        val scale = maxSide.toFloat() / maxOf(w, h)
        if (scale >= 1f) return raw
        val bmp = BitmapFactory.decodeByteArray(raw, 0, raw.size) ?: throw IOException("Frame decode failed")
        val scaled = Bitmap.createScaledBitmap(bmp, (w * scale).toInt(), (h * scale).toInt(), true)
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, 80, out)
        if (scaled !== bmp) scaled.recycle()
        bmp.recycle()
        return out.toByteArray()
    }

    override fun close() {
        closed = true
        keepalive.shutdownNow()
        socket?.let { runCatching { it.close() } }
    }

    companion object {
        private const val TAG = "FcctvRtsp"
        private const val SSRC = 0x47444c53 // "GDLS"
    }
}
