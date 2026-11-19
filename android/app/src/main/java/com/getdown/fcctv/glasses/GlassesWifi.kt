package com.getdown.fcctv.glasses

import android.content.Context
import com.getdown.fcctv.data.DebugLog
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.net.InetSocketAddress
import java.net.Socket

/** An open Wi-Fi Direct connection to the glasses and their IP address. */
class GlassesWifi(val link: WifiDirectLink, val ip: String) {
    fun close() = link.close()

    companion object {
        /**
         * Brings up Wi-Fi Direct to the glasses and returns their IP.
         *
         *  1. Start listening for the glasses' IP report over Bluetooth (notify 0x08).
         *  2. Start Wi-Fi Direct discovery (see [WifiDirectLink]), then send [command]
         *     (live preview 02 01 14 01, or transfer mode 02 01 04) so the glasses turn Wi-Fi on.
         *  3. Once the group forms, the IP comes from: the group-owner address (glasses own the
         *     group), else the Bluetooth report, else a quick scan of the 192.168.49.x
         *     Wi-Fi Direct subnet for the glasses' server port ([port]: 80 files, 8554 video).
         */
        suspend fun open(
            context: Context,
            scope: CoroutineScope,
            glasses: GlassesManager,
            bleAddress: String,
            bleName: String?,
            mode: WifiDirectLink.Mode,
            command: ByteArray,
            port: Int,
            onStatus: (String) -> Unit,
        ): GlassesWifi {
            val bleIp = CompletableDeferred<String>()
            val ipJob = scope.launch(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
                val e = glasses.events.filterIsInstance<GlassEvent.WifiIp>().first()
                DebugLog.add("WiFiDirect", "Glasses reported IP over Bluetooth: ${e.ip}")
                bleIp.complete(e.ip)
            }
            val formed = CompletableDeferred<Pair<String?, Boolean>>()
            val link = WifiDirectLink(context, bleAddress, bleName, mode, object : WifiDirectLink.Listener {
                override fun onGroupFormed(ownerHost: String?, phoneIsOwner: Boolean) { formed.complete(ownerHost to phoneIsOwner) }
                override fun onLost(reason: String) { if (!formed.isCompleted) formed.completeExceptionally(IllegalStateException(reason)) }
                override fun onStatus(text: String) = onStatus(text)
            })
            link.preflight()?.let { ipJob.cancel(); throw IllegalStateException(it) }
            try {
                link.start()
                onStatus("Asking the glasses to turn on Wi-Fi")
                val ack = glasses.command(command, 5000)
                DebugLog.add("WiFiDirect", "Command ${command.joinToString(" ") { "%02x".format(it) }} -> " +
                    (ack?.let { "dataType=${it.dataType} error=${it.errorCode} work=${it.workTypeIng}" } ?: "no reply (normal on some firmware)"))
                val (ownerHost, phoneIsOwner) = withTimeoutOrNull(75_000) { formed.await() }
                    ?: throw IllegalStateException(
                        "Wi-Fi Direct timed out: the phone never saw the glasses. Turn Wi-Fi and Location on, " +
                            "force-stop the official HeyCyan app, and keep the glasses close. Details: Settings → Connection log."
                    )
                val ip = ownerHost
                    ?: withTimeoutOrNull(8_000) { bleIp.await() }
                    ?: run {
                        onStatus("Finding the glasses on Wi-Fi")
                        scanSubnet(port, skipSelf = phoneIsOwner)
                    }
                    ?: throw IllegalStateException("Connected over Wi-Fi but couldn't find the glasses' address")
                DebugLog.add("WiFiDirect", "Using glasses IP $ip")
                return GlassesWifi(link, ip)
            } catch (e: Exception) {
                link.close()
                throw e
            } finally {
                ipJob.cancel()
            }
        }

        /** Looks for an open [port] on 192.168.49.x (the Wi-Fi Direct subnet), 32 probes at a time. */
        private suspend fun scanSubnet(port: Int, skipSelf: Boolean): String? = withContext(Dispatchers.IO) {
            val found = java.util.concurrent.atomic.AtomicReference<String?>(null)
            val sem = Semaphore(32)
            withTimeoutOrNull(15_000) {
                coroutineScope {
                    (if (skipSelf) 2..254 else 1..254).map { h ->
                        async {
                            sem.withPermit {
                                if (found.get() != null) return@withPermit
                                val ip = "192.168.49.$h"
                                val open = runCatching { Socket().use { it.connect(InetSocketAddress(ip, port), 350) }; true }.getOrDefault(false)
                                if (open) found.compareAndSet(null, ip)
                            }
                        }
                    }.awaitAll()
                }
            }
            found.get()?.also { DebugLog.add("WiFiDirect", "Found glasses by subnet scan: $it") }
        }
    }
}
