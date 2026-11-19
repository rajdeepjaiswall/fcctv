package com.getdown.fcctv.live

import android.app.Application
import android.os.PowerManager
import com.getdown.fcctv.data.DebugLog
import com.getdown.fcctv.data.Prefs
import com.getdown.fcctv.glasses.GlassEvent
import com.getdown.fcctv.glasses.GlassesManager
import com.getdown.fcctv.glasses.GlassesWifi
import com.getdown.fcctv.glasses.LinkState
import com.getdown.fcctv.glasses.WifiDirectLink
import com.getdown.fcctv.stream.MjpegServer
import com.getdown.fcctv.stream.RtspFrameSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

enum class LivePhase { OFF, STARTING, LIVE, RETRYING }

data class LiveState(
    val link: LinkState = LinkState.DISCONNECTED,
    val phase: LivePhase = LivePhase.OFF,
    val detail: String = "",
    val battery: Int? = null,
    val charging: Boolean = false,
    val frames: Long = 0,
    val fps: Double = 0.0,
    val frameBytes: Int = 0,
    val deviceName: String? = null,
)

/**
 * The whole live pipeline, process-wide (the foreground [LiveService] keeps the process alive):
 *
 *   Bluetooth connect -> live-preview command (02 01 14 01) -> Wi-Fi Direct, phone as group
 *   owner -> RTSP H.264 from the glasses -> decoded JPEG frames -> latest frame shown in the
 *   app and served at http://127.0.0.1:8080/mjpeg (Phase 2 uploads these to the dashboard).
 *
 * If anything drops while the worker wants to stream, it tears down and retries with backoff.
 */
object LiveController {
    const val FRAME_INTERVAL_MS = 500L   // ~2 fps
    const val FRAME_MAX_SIDE = 1280
    const val MJPEG_PORT = 8080

    private lateinit var app: Application
    lateinit var prefs: Prefs; private set
    lateinit var glasses: GlassesManager; private set
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val _state = MutableStateFlow(LiveState())
    val state: StateFlow<LiveState> = _state.asStateFlow()

    /** Latest JPEG from the glasses (for the in-app preview). */
    private val _frame = MutableStateFlow<ByteArray?>(null)
    val frame: StateFlow<ByteArray?> = _frame.asStateFlow()

    @Volatile private var wanted = false
    private var runJob: Job? = null
    private var wifi: GlassesWifi? = null
    private var video: RtspFrameSource? = null
    private var mjpeg: MjpegServer? = null
    private var wake: PowerManager.WakeLock? = null
    private val frameTimes = ArrayDeque<Long>()

    fun init(application: Application) {
        app = application
        prefs = Prefs(application)
        glasses = GlassesManager(application)
        _state.update { it.copy(deviceName = prefs.deviceName) }
        scope.launch { glasses.state.collect { s -> _state.update { it.copy(link = s) } } }
        scope.launch {
            glasses.events.collect { e ->
                if (e is GlassEvent.Battery) _state.update { it.copy(battery = e.percent, charging = e.charging) }
            }
        }
    }

    fun selectDevice(address: String, name: String?) {
        if (wanted) stop()
        glasses.disconnect()
        prefs.deviceAddress = address
        prefs.deviceName = name
        _state.update { it.copy(deviceName = name, battery = null) }
        glasses.connect(address)
    }

    /** Connect Bluetooth early (for battery) when the app opens. */
    fun connectSaved() {
        val mac = prefs.deviceAddress ?: return
        if (glasses.state.value == LinkState.DISCONNECTED) glasses.connect(mac)
    }

    fun start() {
        if (wanted) return
        if (prefs.deviceAddress == null) { _state.update { it.copy(detail = "Choose your glasses first.") }; return }
        wanted = true
        acquireWake()
        openMjpeg()
        runJob = scope.launch {
            var backoff = 5_000L
            while (isActive && wanted) {
                try {
                    runOnce()
                    backoff = 5_000L
                } catch (e: Exception) {
                    if (!wanted) break
                    DebugLog.add("Live", "Stream failed: ${e.message}")
                    closeCamera(sendStop = true)
                    _state.update { it.copy(phase = LivePhase.RETRYING, detail = "Reconnecting in ${backoff / 1000}s: ${e.message}") }
                    delay(backoff)
                    backoff = (backoff * 2).coerceAtMost(60_000L)
                }
            }
        }
    }

    /** One attempt: returns only when the stream ends (by throwing) or [stop] is called. */
    private suspend fun runOnce() {
        val mac = prefs.deviceAddress ?: throw IllegalStateException("No glasses selected")
        _state.update { it.copy(phase = LivePhase.STARTING, detail = "Connecting to glasses over Bluetooth") }
        if (glasses.state.value != LinkState.CONNECTED) {
            if (glasses.state.value == LinkState.DISCONNECTED) glasses.connect(mac)
            withTimeoutOrNull(45_000) { glasses.state.first { it == LinkState.CONNECTED } }
                ?: throw IllegalStateException("Glasses didn't connect over Bluetooth. Are they on and nearby?")
        }
        val w = GlassesWifi.open(app, scope, glasses, mac, prefs.deviceName, WifiDirectLink.Mode.LIVE,
            GlassesManager.CMD_LIVE_START, port = 8554) { msg -> _state.update { it.copy(detail = msg) } }
        if (!wanted) { w.close(); return }
        wifi = w
        _state.update { it.copy(detail = "Opening live video from ${w.ip}") }

        val failed = kotlinx.coroutines.CompletableDeferred<String>()
        video = RtspFrameSource(w.ip, object : RtspFrameSource.Listener {
            override fun frame(jpeg: ByteArray) = onFrame(jpeg)
            override fun error(message: String) { failed.complete(message) }
        }, maxSide = FRAME_MAX_SIDE, frameIntervalMs = FRAME_INTERVAL_MS).also { it.start() }

        // Keep the glasses in live mode (firmware drops it without BLE heartbeats) and watch for drops.
        while (wanted) {
            if (failed.isCompleted) throw IllegalStateException(failed.await())
            if (glasses.state.value != LinkState.CONNECTED) throw IllegalStateException("Bluetooth to glasses dropped")
            glasses.heartbeat()
            withTimeoutOrNull(5_000) { failed.await() }
        }
    }

    private fun onFrame(jpeg: ByteArray) {
        val now = System.currentTimeMillis()
        val fps = synchronized(frameTimes) {
            frameTimes.addLast(now)
            while (frameTimes.size > 1 && now - frameTimes.first() > 10_000) frameTimes.removeFirst()
            if (frameTimes.size < 2) 0.0 else (frameTimes.size - 1) * 1000.0 / (now - frameTimes.first())
        }
        if (_state.value.frames == 0L) DebugLog.add("Live", "First picture decoded (${jpeg.size / 1024} KB) — live view is working")
        _frame.value = jpeg
        _state.update {
            val n = it.frames + 1
            runCatching { mjpeg?.publish(jpeg, "frame-$n.jpg") }
            it.copy(phase = LivePhase.LIVE, detail = "Streaming from glasses", frames = n, fps = fps, frameBytes = jpeg.size)
        }
    }

    fun stop() {
        if (!wanted) return
        wanted = false
        runJob?.cancel(); runJob = null
        closeCamera(sendStop = true)
        runCatching { mjpeg?.close() }; mjpeg = null
        releaseWake()
        _frame.value = null
        _state.update { it.copy(phase = LivePhase.OFF, detail = "Stopped", fps = 0.0) }
        DebugLog.add("Live", "Stopped by user")
    }

    val isWanted: Boolean get() = wanted

    private fun closeCamera(sendStop: Boolean) {
        runCatching { video?.close() }; video = null
        runCatching { wifi?.close() }; wifi = null
        if (sendStop && glasses.state.value == LinkState.CONNECTED) {
            scope.launch { runCatching { glasses.command(GlassesManager.CMD_LIVE_STOP, 1500) } }
        }
    }

    private fun openMjpeg() {
        if (mjpeg != null) return
        mjpeg = runCatching { MjpegServer(MJPEG_PORT) }
            .onFailure { DebugLog.add("Live", "Local MJPEG server not started: ${it.message}") }
            .getOrNull()
    }

    private fun acquireWake() {
        if (wake?.isHeld == true) return
        wake = app.getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "fcctv:live").also { it.acquire() }
    }

    private fun releaseWake() { wake?.let { if (it.isHeld) it.release() }; wake = null }
}
