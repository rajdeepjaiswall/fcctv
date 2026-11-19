package com.getdown.fcctv.glasses

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.location.LocationManager
import android.net.wifi.WifiManager
import android.net.wifi.WpsInfo
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pDevice
import android.net.wifi.p2p.WifiP2pManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.getdown.fcctv.data.DebugLog
import androidx.core.content.ContextCompat
import java.util.Locale

/**
 * Wi-Fi Direct link to the glasses. Bluetooth stays connected for control while this
 * carries the bulky data (live video, recorded files).
 *
 * TWO ROLES, MATCHING WHAT WORKS ON REAL HARDWARE
 *  - [Mode.LIVE]: the phone is group owner (groupOwnerIntent = 15). In live-preview mode some
 *    firmware never opens RTSP port 8554 when the glasses own the group
 *    (heycyan_live_stream research).
 *  - [Mode.TRANSFER]: no owner preference, exactly like the official HeyCyan app's album import
 *    (WPS push-button, default intent). Forcing the phone as owner here is what made file
 *    copies time out.
 *
 * HOW THE GLASSES ARE FOUND
 *  The glasses advertise on Wi-Fi Direct as "<model>_<BLUETOOTH MAC WITHOUT COLONS>", e.g.
 *  "HQ508C_A1B2C3D4E5F6". We match that, then fall back to the last 4 MAC digits, then to a
 *  single peer whose name looks like glasses. Discovery is restarted every 8 s (phones stop
 *  scanning on their own) and a stuck connect is cancelled and retried up to 3 times.
 */
class WifiDirectLink(
    private val context: Context,
    private val bleAddress: String,
    private val bleName: String?,
    private val mode: Mode,
    private val listener: Listener,
) {
    enum class Mode { LIVE, TRANSFER }

    interface Listener {
        /** Group formed. [ownerHost] is the glasses' IP when the glasses own the group. */
        fun onGroupFormed(ownerHost: String?, phoneIsOwner: Boolean)
        fun onLost(reason: String)
        fun onStatus(text: String) {}
    }

    private val main = Handler(Looper.getMainLooper())
    private val p2p = context.getSystemService(WifiP2pManager::class.java)
        ?: throw IllegalStateException("This phone has no Wi-Fi Direct")
    private var channel: WifiP2pManager.Channel? = null
    private var connecting = false
    private var connectAttempts = 0
    private var groupFormed = false
    private var closed = false
    private var registered = false
    private val seenPeers = LinkedHashSet<String>()

    private val macHex = bleAddress.replace(":", "").uppercase(Locale.US)

    private fun log(msg: String) = DebugLog.add("WiFiDirect", msg)

    private val receiver = object : BroadcastReceiver() {
        @SuppressLint("MissingPermission")
        override fun onReceive(c: Context, intent: Intent) {
            if (closed) return
            when (intent.action) {
                WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION -> {
                    val on = intent.getIntExtra(WifiP2pManager.EXTRA_WIFI_STATE, -1) == WifiP2pManager.WIFI_P2P_STATE_ENABLED
                    if (!on) log("Wi-Fi Direct is OFF on the phone")
                }
                WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION -> pickPeer()
                WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION -> channel?.let { ch ->
                    p2p.requestConnectionInfo(ch) { info ->
                        if (closed || info == null) return@requestConnectionInfo
                        if (info.groupFormed && !groupFormed) {
                            groupFormed = true
                            connecting = false
                            main.removeCallbacks(connectWatchdog)
                            main.removeCallbacks(rediscover)
                            val host = if (!info.isGroupOwner) info.groupOwnerAddress?.hostAddress else null
                            log("Group formed. phoneIsOwner=${info.isGroupOwner} ownerIp=${info.groupOwnerAddress?.hostAddress}")
                            listener.onStatus("Wi-Fi connected to glasses")
                            listener.onGroupFormed(host, info.isGroupOwner)
                        } else if (!info.groupFormed && groupFormed) {
                            groupFormed = false
                            log("Group lost")
                            listener.onLost("Wi-Fi Direct disconnected")
                        }
                    }
                }
            }
        }
    }

    /** Phones stop discovering after a while, and the glasses' Wi-Fi may come up late. */
    private val rediscover = object : Runnable {
        override fun run() {
            if (closed || groupFormed) return
            if (!connecting) discover()
            main.postDelayed(this, 8000)
        }
    }

    /** A connect that hasn't formed a group in 15 s is cancelled and retried. */
    private val connectWatchdog = Runnable {
        if (closed || groupFormed) return@Runnable
        val ch = channel ?: return@Runnable
        log("Connect attempt $connectAttempts didn't form a group; retrying")
        runCatching { p2p.cancelConnect(ch, null) }
        connecting = false
        if (connectAttempts >= 3) listener.onLost("Glasses found but Wi-Fi Direct wouldn't connect (3 tries)")
        else main.postDelayed({ discover() }, 1000)
    }

    /** Problems we can tell the user about before even trying. */
    fun preflight(): String? {
        val wifi = context.applicationContext.getSystemService(WifiManager::class.java)
        if (wifi != null && !wifi.isWifiEnabled) return "Turn on Wi-Fi on your phone (you don't need to join a network)."
        val loc = context.getSystemService(LocationManager::class.java)
        if (Build.VERSION.SDK_INT >= 28 && loc != null && !loc.isLocationEnabled) return "Turn on Location on your phone; Android needs it for Wi-Fi Direct."
        return null
    }

    @SuppressLint("MissingPermission")
    fun start() {
        log("Starting (${mode.name}) for $bleName / $bleAddress; expecting peer named *_$macHex")
        val ch = p2p.initialize(context, Looper.getMainLooper()) { if (!closed) listener.onLost("Wi-Fi Direct channel lost") }
        channel = ch
        val filter = IntentFilter().apply {
            addAction(WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION)
            addAction(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION)
            addAction(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION)
        }
        ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_EXPORTED)
        registered = true
        // Clear any stale group from a previous session, then keep discovering until connected.
        p2p.removeGroup(ch, null)
        listener.onStatus("Looking for the glasses on Wi-Fi Direct")
        main.postDelayed(rediscover, 600)
    }

    @SuppressLint("MissingPermission")
    private fun discover() {
        val ch = channel ?: return
        try {
            p2p.stopPeerDiscovery(ch, null)
            p2p.discoverPeers(ch, object : WifiP2pManager.ActionListener {
                override fun onSuccess() { pickPeer() }
                override fun onFailure(reason: Int) { log("discoverPeers failed ($reason: ${reasonText(reason)})") }
            })
        } catch (e: SecurityException) {
            listener.onLost("Allow Nearby devices and precise Location for FCCTV.")
        }
    }

    @SuppressLint("MissingPermission")
    private fun pickPeer() {
        val ch = channel ?: return
        if (closed || connecting || groupFormed) return
        try {
            p2p.requestPeers(ch) { list ->
                if (closed || connecting || groupFormed || list == null) return@requestPeers
                val peers = list.deviceList.toList()
                peers.forEach { p ->
                    val label = "${p.deviceName}/${p.deviceAddress}"
                    if (seenPeers.add(label)) log("Peer seen: $label status=${p.status}")
                }
                val peer = choose(peers) ?: run {
                    if (peers.isNotEmpty()) listener.onStatus("Looking for the glasses… (seen ${peers.size} other device(s))")
                    return@requestPeers
                }
                connect(ch, peer)
            }
        } catch (e: SecurityException) {
            listener.onLost("Allow Nearby devices and precise Location for FCCTV.")
        }
    }

    private fun choose(peers: List<WifiP2pDevice>): WifiP2pDevice? {
        fun name(p: WifiP2pDevice) = (p.deviceName ?: "").uppercase(Locale.US)
        val ordered = peers.sortedByDescending { it.status == WifiP2pDevice.AVAILABLE }
        // 1. Official naming: "<model>_<full MAC>"
        ordered.firstOrNull { name(it).endsWith(macHex) || name(it).contains(macHex) }?.let { return it }
        // 2. Last 4 MAC digits (older firmware)
        ordered.firstOrNull { name(it).contains(macHex.takeLast(4)) }?.let { return it }
        // 3. Exactly one peer that looks like glasses
        val hints = listOfNotNull(bleName?.uppercase(Locale.US)?.substringBefore('_')?.takeIf { it.length >= 3 },
            "HEYCYAN", "CYAN", "HQ5", "A02", "GLASS")
        val looksLike = ordered.filter { p -> hints.any { name(p).contains(it) } }
        return looksLike.singleOrNull()
    }

    @SuppressLint("MissingPermission")
    private fun connect(ch: WifiP2pManager.Channel, peer: WifiP2pDevice) {
        connecting = true
        connectAttempts++
        val config = WifiP2pConfig().apply {
            deviceAddress = peer.deviceAddress
            wps.setup = WpsInfo.PBC
            if (mode == Mode.LIVE) groupOwnerIntent = 15
        }
        log("Connecting to ${peer.deviceName} (${peer.deviceAddress}), attempt $connectAttempts, mode=${mode.name}")
        listener.onStatus("Connecting Wi-Fi to ${peer.deviceName}")
        p2p.connect(ch, config, object : WifiP2pManager.ActionListener {
            override fun onSuccess() { main.postDelayed(connectWatchdog, 15_000) }
            override fun onFailure(reason: Int) {
                connecting = false
                log("connect() refused ($reason: ${reasonText(reason)})")
                if (connectAttempts >= 3) listener.onLost("Wi-Fi Direct connection failed (${reasonText(reason)}). Close the official glasses app and retry.")
            }
        })
    }

    private fun reasonText(r: Int) = when (r) {
        WifiP2pManager.P2P_UNSUPPORTED -> "unsupported"
        WifiP2pManager.BUSY -> "busy"
        WifiP2pManager.ERROR -> "error"
        else -> "code $r"
    }

    fun close() {
        if (closed) return
        closed = true
        main.removeCallbacksAndMessages(null)
        if (registered) runCatching { context.unregisterReceiver(receiver) }
        channel?.let { ch ->
            runCatching { p2p.stopPeerDiscovery(ch, null) }
            runCatching { p2p.cancelConnect(ch, null) }
            runCatching { p2p.removeGroup(ch, null) }
            if (Build.VERSION.SDK_INT >= 27) runCatching { ch.close() }
        }
        channel = null
        log("Closed")
    }
}
