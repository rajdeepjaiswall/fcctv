package com.getdown.fcctv.live

import android.app.Application
import android.os.BatteryManager
import android.os.PowerManager
import com.getdown.fcctv.data.DebugLog
import com.getdown.fcctv.data.Prefs
import com.getdown.fcctv.glasses.GlassEvent
import com.getdown.fcctv.glasses.GlassesManager
import com.getdown.fcctv.glasses.GlassesWifi
import com.getdown.fcctv.glasses.LinkState
import com.getdown.fcctv.glasses.WifiDirectLink
import com.getdown.fcctv.net.Backend
import com.getdown.fcctv.net.Frame
import com.getdown.fcctv.net.InternetNetwork
import com.getdown.fcctv.net.ServerConfig
import com.getdown.fcctv.net.UnpairedException
import com.getdown.fcctv.net.Uploader
import com.getdown.fcctv.stream.Jpeg
import com.getdown.fcctv.stream.MjpegServer
import com.getdown.fcctv.stream.RtspFrameSource
import kotlinx.coroutines.CompletableDeferred
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
import org.json.JSONObject

/** What the camera is doing right now. */
/** OFF = app off · STANDBY = ready, camera off, waiting for the owner · SNAPSHOT/LIVE = recording/streaming. */
enum class LivePhase { OFF, STANDBY, STARTING, SNAPSHOT, LIVE, RETRYING, PAUSED }

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
    val paired: Boolean = false,
    val workerName: String? = null,
    val online: Boolean = false,
    val uploaded: Long = 0,
    val uploadError: String? = null,
    val snapshotEverySec: Int = 10,
    val recording: Boolean = false,
    val captureMode: String = "images",
)

/**
 * The worker's "duty" — process-wide; the foreground [LiveService] keeps the process alive.
 *
 *  - SNAPSHOT mode (default): every N seconds (owner's setting) take a photo on the glasses over
 *    Bluetooth and upload it. Light on the glasses battery.
 *  - LIVE mode (when the owner taps "Watch live" on the dashboard): Bluetooth live-preview command
 *    -> Wi-Fi Direct (phone is group owner) -> RTSP H.264 -> JPEG at the owner's fps -> upload.
 *    One frame every N seconds is also kept as a snapshot.
 *  - A heartbeat every 5-15 s tells the server our status and fetches the owner's wishes.
 * Uploads always leave over a real internet network (mobile data while Wi-Fi Direct is up).
 */
object LiveController {
    const val MJPEG_PORT = 8080
    private const val FRAME_MAX_SIDE = 1280

    private lateinit var app: Application
    lateinit var prefs: Prefs; private set
    lateinit var glasses: GlassesManager; private set
    private lateinit var net: InternetNetwork
    lateinit var backend: Backend; private set
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val _state = MutableStateFlow(LiveState())
    val state: StateFlow<LiveState> = _state.asStateFlow()

    /** Latest JPEG from the glasses (for the in-app preview). */
    private val _frame = MutableStateFlow<ByteArray?>(null)
    val frame: StateFlow<ByteArray?> = _frame.asStateFlow()

    private val config = MutableStateFlow(ServerConfig())

    @Volatile private var duty = false
    private var dutyJob: Job? = null
    private var heartbeatJob: Job? = null
    private var uploader: Uploader? = null
    private var wifi: GlassesWifi? = null
    private var video: RtspFrameSource? = null
    private var mjpeg: MjpegServer? = null
    private var wake: PowerManager.WakeLock? = null
    private val frameTimes = ArrayDeque<Long>()
    @Volatile private var lastLiveSentAt = 0L
    @Volatile private var lastSnapshotAt = 0L

    fun init(application: Application) {
        app = application
        prefs = Prefs(application)
        glasses = GlassesManager(application)
        net = InternetNetwork(application)
        backend = Backend(net)
        _state.update { it.copy(deviceName = prefs.deviceName, paired = prefs.deviceToken != null, workerName = prefs.pairedWorkerName) }
        // Only report a battery number while the glasses are actually connected.
        scope.launch {
            glasses.state.collect { s ->
                _state.update { it.copy(link = s, battery = if (s == LinkState.CONNECTED) it.battery else null) }
                if (s == LinkState.CONNECTED) glasses.requestBattery()
            }
        }
        scope.launch {
            glasses.events.collect { e ->
                if (e is GlassEvent.Battery) _state.update { it.copy(battery = e.percent, charging = e.charging) }
            }
        }
    }

    // ---------------------------------------------------------------- pairing & glasses

    suspend fun pair(code: String) {
        val p = backend.pair(code, prefs.consentAt, prefs.workerName)
        prefs.deviceToken = p.token
        prefs.pairedWorkerName = p.workerName
        _state.update { it.copy(paired = true, workerName = p.workerName) }
        DebugLog.add("Server", "Paired as ${p.workerName}")
    }

    private fun unpair(reason: String) {
        prefs.deviceToken = null
        _state.update { it.copy(paired = false, uploadError = reason) }
        stop()
    }

    fun selectDevice(address: String, name: String?) {
        if (duty) stop()
        glasses.disconnect()
        prefs.deviceAddress = address
        prefs.deviceName = name
        _state.update { it.copy(deviceName = name, battery = null) }
        glasses.connect(address)
    }

    fun connectSaved() {
        val mac = prefs.deviceAddress ?: return
        if (glasses.state.value == LinkState.DISCONNECTED) glasses.connect(mac)
    }

    // ---------------------------------------------------------------- duty on / off

    val isWanted: Boolean get() = duty

    fun start() {
        if (duty) return
        if (prefs.deviceAddress == null) { _state.update { it.copy(detail = "Choose your glasses first.") }; return }
        if (prefs.deviceToken == null) { _state.update { it.copy(detail = "Pair this phone with the owner's dashboard first.") }; return }
        duty = true
        acquireWake()
        openMjpeg()
        net.start()
        _state.update { it.copy(phase = LivePhase.STANDBY, detail = "Ready. The owner can start recording.", uploadError = null) }
        uploader = Uploader(scope, backend, { prefs.deviceToken }, { config.value.sessionId }) { ok, _, err ->
            _state.update {
                if (ok) it.copy(uploaded = it.uploaded + 1, uploadError = null, online = true)
                else it.copy(uploadError = err, online = false)
            }
            if (!ok && err != null && err.contains("no longer paired")) scope.launch { unpair(err) }
        }.also { it.start() }
        heartbeatJob = scope.launch { heartbeatLoop() }
        dutyJob = scope.launch { dutyLoop() }
        DebugLog.add("Duty", "Started")
    }

    fun stop() {
        if (!duty) return
        duty = false
        dutyJob?.cancel(); dutyJob = null
        heartbeatJob?.cancel(); heartbeatJob = null
        closeCamera(sendStop = true)
        uploader?.stop(); uploader = null
        runCatching { mjpeg?.close() }; mjpeg = null
        releaseWake()
        _frame.value = null
        _state.update { it.copy(phase = LivePhase.OFF, detail = "FCCTV is off", fps = 0.0, recording = false) }
        config.value = config.value.copy(duty = false, liveRequested = false, sessionId = null)
        val token = prefs.deviceToken
        scope.launch {
            if (token != null) {
                runCatching { backend.workerOff(token) }
                runCatching { backend.heartbeat(token, status("off")) }
            }
            net.stop()
        }
        DebugLog.add("Duty", "Stopped")
    }

    // ---------------------------------------------------------------- heartbeat

    private fun phoneBattery(): Int? =
        app.getSystemService(BatteryManager::class.java)?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)?.takeIf { it in 0..100 }

    private fun status(mode: String): JSONObject {
        val s = _state.value
        val connected = glasses.state.value == LinkState.CONNECTED
        if (connected) glasses.requestBattery()
        return JSONObject()
            .put("mode", mode)
            .put("glasses_connected", connected)
            .put("battery", if (connected) s.battery ?: JSONObject.NULL else JSONObject.NULL)
            .put("charging", if (connected && s.battery != null) s.charging else JSONObject.NULL)
            .put("phone_battery", phoneBattery() ?: JSONObject.NULL)
            .put("detail", s.detail)
            .put("glasses_name", prefs.deviceName ?: JSONObject.NULL)
            .put("glasses_mac", prefs.deviceAddress ?: JSONObject.NULL)
    }

    private fun modeName(p: LivePhase) = when (p) {
        LivePhase.LIVE -> "live"
        LivePhase.PAUSED -> "paused"
        LivePhase.OFF -> "off"
        LivePhase.STANDBY -> "standby"
        else -> if (config.value.duty) "snapshot" else "standby"
    }

    private suspend fun heartbeatLoop() {
        while (duty) {
            val token = prefs.deviceToken ?: return
            try {
                val cfg = backend.heartbeat(token, status(modeName(_state.value.phase)))
                val old = config.value
                if (cfg.liveRequested != old.liveRequested) DebugLog.add("Server", if (cfg.liveRequested) "Owner opened the live feed" else "Owner closed the live feed")
                if (cfg.duty != old.duty || cfg.sessionId != old.sessionId) {
                    DebugLog.add("Server", if (cfg.duty) "Owner started recording (${cfg.captureMode})" else "Owner stopped recording")
                }
                config.value = cfg
                _state.update {
                    it.copy(online = true, snapshotEverySec = cfg.snapshotIntervalSec, workerName = prefs.pairedWorkerName,
                        recording = cfg.duty, captureMode = cfg.captureMode)
                }
            } catch (e: UnpairedException) {
                unpair(e.message ?: "Unpaired"); return
            } catch (e: Exception) {
                _state.update { it.copy(online = false, uploadError = "Server: ${e.message}") }
            }
            val busy = config.value.liveRequested || config.value.duty || _state.value.phase == LivePhase.LIVE
            delay(if (busy) 4_000 else 7_000)
        }
    }

    // ---------------------------------------------------------------- duty loop

    private suspend fun dutyLoop() {
        var backoff = 5_000L
        while (duty) {
            val cfg = config.value
            if (!cfg.withinHours || !cfg.active) {
                closeCamera(sendStop = true)
                _state.update { it.copy(phase = LivePhase.PAUSED, detail = if (!cfg.active) "Paused by owner" else "Outside working hours (${cfg.workStart}–${cfg.workEnd})") }
                delay(10_000); continue
            }
            try {
                when {
                    cfg.liveRequested || (cfg.duty && cfg.captureMode == "video") -> { runLive(); backoff = 5_000L }
                    cfg.duty -> { snapshotOnce(); backoff = 5_000L; waitForNextSnapshot() }
                    else -> standby()
                }
            } catch (e: Exception) {
                if (!duty) break
                if (e is kotlinx.coroutines.CancellationException) throw e
                DebugLog.add("Duty", "Problem: ${e.message}")
                closeCamera(sendStop = true)
                _state.update { it.copy(phase = LivePhase.RETRYING, detail = "Retrying in ${backoff / 1000}s: ${e.message}") }
                delay(backoff)
                backoff = (backoff * 2).coerceAtMost(60_000L)
            }
        }
    }

    /** Sleeps until the next snapshot is due, but wakes early if the owner changes anything. */
    private suspend fun waitForNextSnapshot() {
        val start = config.value
        val due = lastSnapshotAt + start.snapshotIntervalSec * 1000L
        while (duty && config.value.duty && !config.value.liveRequested && config.value.captureMode == start.captureMode &&
            System.currentTimeMillis() < due) delay(500)
    }

    /** Camera off; keep Bluetooth up (for battery) and wait for the owner to start something. */
    private suspend fun standby() {
        closeCamera(sendStop = true)
        if (_state.value.phase != LivePhase.STANDBY) {
            _frame.value = null
            _state.update { it.copy(phase = LivePhase.STANDBY, detail = "Ready. Camera is off until the owner starts recording.", fps = 0.0) }
        }
        connectSaved()
        while (duty && !config.value.duty && !config.value.liveRequested && config.value.withinHours && config.value.active) delay(500)
    }

    private suspend fun ensureBluetooth() {
        val mac = prefs.deviceAddress ?: throw IllegalStateException("No glasses selected")
        if (glasses.state.value == LinkState.CONNECTED) return
        _state.update { it.copy(detail = "Connecting to glasses over Bluetooth") }
        if (glasses.state.value == LinkState.DISCONNECTED) glasses.connect(mac)
        withTimeoutOrNull(45_000) { glasses.state.first { it == LinkState.CONNECTED } }
            ?: throw IllegalStateException("Glasses didn't connect over Bluetooth. Are they on and nearby?")
    }

    private suspend fun snapshotOnce() {
        ensureBluetooth()
        if (_state.value.phase != LivePhase.SNAPSHOT) _state.update { it.copy(phase = LivePhase.SNAPSHOT) }
        if (config.value.sessionId == null) { delay(1_000); return }
        _state.update { it.copy(detail = "Taking photo") }
        val jpeg = Jpeg.shrink(glasses.takePhoto(3))
        val now = System.currentTimeMillis()
        lastSnapshotAt = now
        _frame.value = jpeg
        runCatching { mjpeg?.publish(jpeg, "snap-$now.jpg") }
        uploader?.snapshot(Frame(jpeg, now, _state.value.battery, fromLive = false))
        _state.update { it.copy(frames = it.frames + 1, frameBytes = jpeg.size, detail = "Photo every ${config.value.snapshotIntervalSec}s") }
        if (_state.value.frames == 1L) DebugLog.add("Duty", "First photo taken (${jpeg.size / 1024} KB)")
    }

    /** Runs live video until the owner stops it, duty ends, or it fails (throws). */
    private suspend fun runLive() {
        val mac = prefs.deviceAddress ?: throw IllegalStateException("No glasses selected")
        ensureBluetooth()
        _state.update { it.copy(phase = LivePhase.STARTING, detail = "Owner requested video; starting camera") }
        val liveWanted = {
            val c = config.value
            duty && (c.liveRequested || (c.duty && c.captureMode == "video")) && c.withinHours && c.active
        }
        val w = GlassesWifi.open(app, scope, glasses, mac, prefs.deviceName, WifiDirectLink.Mode.LIVE,
            GlassesManager.CMD_LIVE_START, port = 8554) { msg -> _state.update { it.copy(detail = msg) } }
        if (!liveWanted()) { w.close(); return }
        wifi = w
        _state.update { it.copy(detail = "Opening live video from ${w.ip}") }
        val failed = CompletableDeferred<String>()
        video = RtspFrameSource(w.ip, object : RtspFrameSource.Listener {
            override fun frame(jpeg: ByteArray) = onLiveFrame(jpeg)
            override fun error(message: String) { failed.complete(message) }
        }, maxSide = FRAME_MAX_SIDE, frameIntervalMs = 1000L / config.value.liveFps.coerceIn(1, 5)).also { it.start() }
        try {
            while (liveWanted()) {
                if (failed.isCompleted) throw IllegalStateException(failed.await())
                if (glasses.state.value != LinkState.CONNECTED) throw IllegalStateException("Bluetooth to glasses dropped")
                glasses.heartbeat()
                withTimeoutOrNull(2_000) { failed.await() }
            }
        } finally {
            closeCamera(sendStop = true)
            if (duty) _state.update { it.copy(phase = LivePhase.STARTING, detail = "Video stopped", fps = 0.0) }
        }
    }

    private fun onLiveFrame(jpeg: ByteArray) {
        val now = System.currentTimeMillis()
        val fps = synchronized(frameTimes) {
            frameTimes.addLast(now)
            while (frameTimes.size > 1 && now - frameTimes.first() > 10_000) frameTimes.removeFirst()
            if (frameTimes.size < 2) 0.0 else (frameTimes.size - 1) * 1000.0 / (now - frameTimes.first())
        }
        if (_state.value.phase != LivePhase.LIVE) DebugLog.add("Live", "Live video running (${jpeg.size / 1024} KB frames)")
        _frame.value = jpeg
        runCatching { mjpeg?.publish(jpeg, "frame-$now.jpg") }
        val battery = _state.value.battery
        val c = config.value
        val keepEveryMs = if (c.captureMode == "video") c.videoSaveEverySec * 1000L else c.snapshotIntervalSec * 1000L
        if (c.duty && c.sessionId != null && now - lastSnapshotAt >= keepEveryMs) {
            lastSnapshotAt = now
            uploader?.snapshot(Frame(jpeg, now, battery, fromLive = true))
        } else if (now - lastLiveSentAt >= 1000L / config.value.liveFps.coerceIn(1, 5) - 50) {
            lastLiveSentAt = now
            uploader?.live(Frame(jpeg, now, battery, fromLive = true))
        }
        _state.update {
            it.copy(phase = LivePhase.LIVE, detail = if (c.duty) "Recording video for the owner" else "Owner is watching the live feed",
                frames = it.frames + 1, fps = fps, frameBytes = jpeg.size)
        }
    }

    private fun closeCamera(sendStop: Boolean) {
        val hadCamera = video != null || wifi != null
        runCatching { video?.close() }; video = null
        runCatching { wifi?.close() }; wifi = null
        if (hadCamera && sendStop && glasses.state.value == LinkState.CONNECTED) {
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
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "fcctv:duty").also { it.acquire() }
    }

    private fun releaseWake() { wake?.let { if (it.isHeld) it.release() }; wake = null }
}
