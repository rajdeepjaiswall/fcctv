package com.getdown.fcctv.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import com.getdown.fcctv.data.DebugLog

/**
 * While the phone runs a Wi-Fi Direct group with the glasses, uploads must still go out over a
 * network that really reaches the internet (normally mobile data). We keep a mobile-data network
 * requested in the background and pick, for every upload:
 *   1. the phone's default network if it is validated internet (and not the Wi-Fi Direct link),
 *   2. otherwise the mobile-data network we requested.
 * OkHttp sockets are then bound to that network, so frames never try to leave via the glasses.
 */
class InternetNetwork(context: Context) {
    private val cm = context.getSystemService(ConnectivityManager::class.java)
    @Volatile private var cellular: Network? = null

    private val cellularCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { cellular = network; DebugLog.add("Net", "Mobile data available for uploads") }
        override fun onLost(network: Network) { if (cellular == network) cellular = null; DebugLog.add("Net", "Mobile data lost") }
    }

    fun start() {
        runCatching {
            cm.requestNetwork(
                NetworkRequest.Builder()
                    .addTransportType(NetworkCapabilities.TRANSPORT_CELLULAR)
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build(),
                cellularCallback,
            )
        }.onFailure { DebugLog.add("Net", "Couldn't request mobile data: ${it.message}") }
    }

    fun stop() { runCatching { cm.unregisterNetworkCallback(cellularCallback) } }

    /** Best network for reaching the backend right now, or null to let Android decide. */
    fun pick(): Network? {
        val active = cm.activeNetwork
        val caps = active?.let { cm.getNetworkCapabilities(it) }
        val activeOk = caps != null &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        return if (activeOk) active else cellular ?: active
    }
}
