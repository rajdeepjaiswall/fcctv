package com.getdown.fcctv.glasses

import android.annotation.SuppressLint
import android.app.Application
import android.bluetooth.BluetoothDevice
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.oudmon.ble.base.bluetooth.BleAction
import com.oudmon.ble.base.bluetooth.BleOperateManager
import com.oudmon.ble.base.bluetooth.QCBluetoothCallbackCloneReceiver
import com.oudmon.ble.base.communication.LargeDataHandler
import com.oudmon.ble.base.communication.bigData.resp.GlassModelControlResponse
import com.oudmon.ble.base.communication.bigData.resp.GlassesDeviceNotifyListener
import com.oudmon.ble.base.communication.bigData.resp.GlassesDeviceNotifyRsp
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withTimeoutOrNull

enum class LinkState { DISCONNECTED, CONNECTING, CONNECTED }

/** Events the glasses push to the phone over BLE. */
sealed interface GlassEvent {
    /** AI / voice button on the glasses temple (notify event 0x03). */
    data object AiButton : GlassEvent
    /** AI-photo / capture button (notify event 0x02). */
    data object PhotoButton : GlassEvent
    /** Glasses joined Wi-Fi Direct and report their IP (notify event 0x08). */
    data class WifiIp(val ip: String) : GlassEvent
    data class Battery(val percent: Int, val charging: Boolean) : GlassEvent
    /** Any other notify event code; used to learn a long-press for Scan & Pay. */
    data class Other(val code: Int) : GlassEvent
}

/**
 * Bluetooth control channel to HeyCyan / QC-SDK glasses (e.g. HQ508C, A02HQ hardware).
 *
 * HOW BUTTON DETECTION WORKS
 * The glasses firmware does not report raw "left double-click" or "right double-click".
 * It interprets the touch/button gestures itself and sends a device-notify packet over
 * BLE. LargeDataHandler hands us the packet as `loadData`; byte [6] is the event type:
 *   0x02  AI-photo taken by the capture gesture   -> [GlassEvent.PhotoButton]
 *   0x03  AI/voice button pressed ([7] == 1)      -> [GlassEvent.AiButton]
 *   0x05  battery report: [7] = percent, [8] = charging flag
 *   0x08  Wi-Fi Direct IP: bytes [7..10]
 *   0x09  error, 0x0b temperature, 0x12 volume (logged only)
 * Which physical gesture fires 0x02/0x03 is set by the glasses firmware / official app.
 * The app maps those events to actions in Settings (ButtonAction).
 *
 * Event codes come from the HeyCyan SDK sample and the CyanBridge project
 * (github.com/FerSaiyan/Alternative-HeyCyan-App-and-SDK, Apache-2.0).
 */
class GlassesManager(private val app: Application) {
    private val main = Handler(Looper.getMainLooper())
    private val data: LargeDataHandler get() = LargeDataHandler.getInstance()
    private val ble: BleOperateManager by lazy {
        BleOperateManager.getInstance(app).also {
            it.setApplication(app)
            it.init()
            com.oudmon.ble.base.bluetooth.BleBaseControl.getInstance(app).setmContext(app)
        }
    }

    private val _state = MutableStateFlow(LinkState.DISCONNECTED)
    val state: StateFlow<LinkState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<GlassEvent>(extraBufferCapacity = 32)
    val events: SharedFlow<GlassEvent> = _events.asSharedFlow()

    private var address: String? = null
    private var wantConnected = false
    private var autoReconnect = true
    private var reconnectDelayMs = RECONNECT_MIN_MS
    private var receiverRegistered = false
    private var lastAiButtonAt = 0L

    private val reconnect = Runnable { address?.let { if (wantConnected) doConnect(it) } }
    private val batteryPoll = object : Runnable {
        override fun run() {
            if (_state.value == LinkState.CONNECTED) runCatching { data.syncBattery() }
            main.postDelayed(this, 60_000)
        }
    }
    private val connectTimeout = Runnable {
        if (_state.value == LinkState.CONNECTING) {
            Log.w(TAG, "BLE connect timed out")
            onLinkLost()
        }
    }

    private val bleReceiver = object : QCBluetoothCallbackCloneReceiver() {
        override fun connectStatue(device: BluetoothDevice?, connected: Boolean) {
            main.post { if (!connected && _state.value != LinkState.DISCONNECTED) onLinkLost() }
        }

        override fun onServiceDiscovered() {
            main.post { onReady() }
        }
    }

    /** Device-notify packets: the place where button presses arrive. */
    private val notifyListener = object : GlassesDeviceNotifyListener() {
        override fun parseData(cmdType: Int, response: GlassesDeviceNotifyRsp?) {
            val bytes = response?.loadData?.clone() ?: return
            if (bytes.size < 7) return
            val event = bytes[6].toInt() and 0xFF
            com.getdown.fcctv.data.DebugLog.add("Glasses", "signal 0x%02x payload=%s".format(event, bytes.drop(6).joinToString(",") { (it.toInt() and 0xFF).toString() }))
            when (event) {
                // Photo ready. If the app itself pressed the shutter, this completes that request
                // instead of counting as a button press.
                0x02 -> {
                    val waiter = photoWaiter
                    if (waiter != null && !waiter.isCompleted) waiter.complete(Unit) else emit(GlassEvent.PhotoButton)
                }
                0x03 -> if (bytes.size > 7 && bytes[7].toInt() == 1) {
                    // Debounce: some firmware sends the press twice within a few hundred ms.
                    val now = System.currentTimeMillis()
                    if (now - lastAiButtonAt > 800) { lastAiButtonAt = now; emit(GlassEvent.AiButton) }
                }
                0x05 -> if (bytes.size > 8) emit(GlassEvent.Battery(bytes[7].toInt() and 0xFF, bytes[8].toInt() == 1))
                0x08 -> if (bytes.size >= 11) {
                    val ip = (7..10).joinToString(".") { (bytes[it].toInt() and 0xFF).toString() }
                    emit(GlassEvent.WifiIp(ip))
                }
                0x09 -> Log.w(TAG, "Glasses reported an error notification")
                0x04, 0x0b, 0x12 -> Unit // OTA progress, temperature, volume: not buttons
                // Anything else (e.g. a long-press on some firmware) can be bound to Scan & Pay
                // with Settings -> "Learn long-press".
                else -> emit(GlassEvent.Other(event))
            }
        }
    }

    private fun emit(e: GlassEvent) { _events.tryEmit(e) }

    fun setAutoReconnect(enabled: Boolean) { autoReconnect = enabled }

    @SuppressLint("MissingPermission")
    fun connect(mac: String) {
        address = mac
        wantConnected = true
        reconnectDelayMs = RECONNECT_MIN_MS
        main.removeCallbacks(reconnect)
        doConnect(mac)
    }

    private fun doConnect(mac: String) {
        if (_state.value != LinkState.DISCONNECTED) return
        if (!receiverRegistered) {
            LocalBroadcastManager.getInstance(app).registerReceiver(bleReceiver, BleAction.getIntentFilter())
            receiverRegistered = true
        }
        _state.value = LinkState.CONNECTING
        com.getdown.fcctv.data.DebugLog.add("Bluetooth", "Connecting to $mac")
        main.removeCallbacks(connectTimeout)
        main.postDelayed(connectTimeout, 30_000)
        runCatching { ble.connectDirectly(mac) }.onFailure { Log.e(TAG, "connectDirectly failed", it); onLinkLost() }
    }

    private fun onReady() {
        if (_state.value == LinkState.CONNECTED) return
        main.removeCallbacks(connectTimeout)
        runCatching {
            data.initEnable()
            ble.setReady(true)
            data.addOutDeviceListener(NOTIFY_ID, notifyListener)
            data.addBatteryCallBack(TAG) { _, r -> if (r != null) emit(GlassEvent.Battery(r.battery, r.isCharging)) }
            data.syncTime { _, _ -> }
            data.syncBattery()
        }.onFailure { Log.e(TAG, "SDK init after connect failed", it) }
        _state.value = LinkState.CONNECTED
        reconnectDelayMs = RECONNECT_MIN_MS
        main.removeCallbacks(batteryPoll)
        main.postDelayed(batteryPoll, 60_000)
        com.getdown.fcctv.data.DebugLog.add("Bluetooth", "Connected and ready")
    }

    private fun onLinkLost() {
        main.removeCallbacks(connectTimeout)
        main.removeCallbacks(batteryPoll)
        runCatching { data.removeOutDeviceListener(NOTIFY_ID) }
        runCatching { data.removeBatteryCallBack(TAG) }
        _state.value = LinkState.DISCONNECTED
        if (wantConnected && autoReconnect) {
            // Exponential backoff so a phone in a pocket doesn't hammer Bluetooth.
            com.getdown.fcctv.data.DebugLog.add("Bluetooth", "Link lost; reconnecting in ${reconnectDelayMs / 1000}s")
            main.removeCallbacks(reconnect)
            main.postDelayed(reconnect, reconnectDelayMs)
            reconnectDelayMs = (reconnectDelayMs * 2).coerceAtMost(RECONNECT_MAX_MS)
        }
    }

    fun disconnect() {
        wantConnected = false
        main.removeCallbacks(reconnect)
        main.removeCallbacks(batteryPoll)
        main.removeCallbacks(connectTimeout)
        runCatching { data.removeOutDeviceListener(NOTIFY_ID) }
        runCatching { ble.setNeedConnect(false); ble.setReady(false); ble.disconnect() }
        _state.value = LinkState.DISCONNECTED
    }

    fun requestBattery() { if (_state.value == LinkState.CONNECTED) runCatching { data.syncBattery() } }

    fun heartbeat() { runCatching { data.syncHeartBeat(4) } }

    /**
     * Sends a glassesControl command and waits for the SDK's reply.
     * Returns null on timeout; some firmware never answers newer commands (e.g. live 0x14),
     * so callers treat null as "sent, unconfirmed" rather than failure.
     */
    suspend fun command(bytes: ByteArray, timeoutMs: Long = 4000): GlassModelControlResponse? {
        if (_state.value != LinkState.CONNECTED) throw IllegalStateException("Glasses are not connected")
        val reply = CompletableDeferred<GlassModelControlResponse?>()
        main.post {
            runCatching { data.glassesControl(bytes) { _, r -> reply.complete(r) } }
                .onFailure { reply.completeExceptionally(it) }
        }
        return withTimeoutOrNull(timeoutMs) { reply.await() }
    }

    @Volatile private var photoWaiter: CompletableDeferred<Unit>? = null

    /**
     * Downloads the latest photo over Bluetooth (no Wi-Fi needed, ~1-3 s).
     * The SDK streams JPEG chunks to the callback until `complete` is true.
     */
    suspend fun fetchLatestPhoto(timeoutMs: Long = 20_000): ByteArray {
        if (_state.value != LinkState.CONNECTED) throw IllegalStateException("Glasses are not connected")
        val out = java.io.ByteArrayOutputStream()
        val done = CompletableDeferred<Unit>()
        main.post {
            runCatching {
                data.getPictureThumbnails { _, complete, bytes ->
                    if (bytes != null && bytes.isNotEmpty()) synchronized(out) { out.write(bytes) }
                    if (complete) done.complete(Unit)
                }
            }.onFailure { done.completeExceptionally(it) }
        }
        withTimeoutOrNull(timeoutMs) { done.await() } ?: throw IllegalStateException("Photo transfer from glasses timed out")
        val jpeg = synchronized(out) { out.toByteArray() }
        if (jpeg.size < 1000 || android.graphics.BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size) == null) {
            throw IllegalStateException("Glasses sent an unreadable photo")
        }
        return jpeg
    }

    /**
     * Takes a fresh photo from the app (no button press): set the AI-photo size, press the
     * shutter, wait for the glasses' "photo ready" (0x02), then download it.
     * Size 0..5 = instant..detailed; 3 is a good balance of detail and Bluetooth speed.
     */
    suspend fun takePhoto(size: Int = 3): ByteArray {
        val ready = CompletableDeferred<Unit>()
        photoWaiter = ready
        try {
            command(byteArrayOf(0x02, 0x01, 0x06, size.toByte(), size.toByte()), 2000)
            kotlinx.coroutines.delay(250)
            command(byteArrayOf(0x02, 0x01, 0x01), 2000)
            withTimeoutOrNull(6000) { ready.await() } ?: throw IllegalStateException("Glasses didn't confirm a new photo")
        } finally {
            photoWaiter = null
        }
        return fetchLatestPhoto()
    }

    companion object {
        private const val TAG = "FcctvBle"
        private const val NOTIFY_ID = 100
        private const val RECONNECT_MIN_MS = 5_000L
        private const val RECONNECT_MAX_MS = 60_000L

        // glassesControl payloads (HeyCyan SDK sample + live-stream research)
        val CMD_VIDEO_START = byteArrayOf(0x02, 0x01, 0x02)
        val CMD_VIDEO_STOP = byteArrayOf(0x02, 0x01, 0x03)
        val CMD_TRANSFER_MODE = byteArrayOf(0x02, 0x01, 0x04)
        val CMD_EXIT_TRANSFER = byteArrayOf(0x02, 0x01, 0x09)
        val CMD_LIVE_START = byteArrayOf(0x02, 0x01, 0x14, 0x01)
        val CMD_LIVE_STOP = byteArrayOf(0x02, 0x01, 0x15, 0x01)
    }
}
