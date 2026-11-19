package com.getdown.fcctv.net

import com.getdown.fcctv.data.DebugLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.selects.select
import java.util.concurrent.atomic.AtomicReference

class Frame(val jpeg: ByteArray, val takenAt: Long, val battery: Int?, val fromLive: Boolean)

/**
 * Sends frames to the backend. Snapshots are queued (kept even if the network blips, up to 30);
 * live frames are "latest only" — an old live frame is useless, so a newer one replaces it.
 */
class Uploader(
    private val scope: CoroutineScope,
    private val backend: Backend,
    private val token: () -> String?,
    private val session: () -> String?,
    private val onResult: (ok: Boolean, live: Boolean, error: String?) -> Unit,
) {
    private val snapshots = Channel<Frame>(30, BufferOverflow.DROP_OLDEST)
    private val liveSlot = AtomicReference<Frame?>(null)
    private val liveSignal = Channel<Unit>(Channel.CONFLATED)
    private var job: Job? = null

    fun snapshot(f: Frame) { snapshots.trySend(f) }
    fun live(f: Frame) { liveSlot.set(f); liveSignal.trySend(Unit) }

    fun start() {
        if (job != null) return
        job = scope.launch(Dispatchers.IO) {
            while (isActive) {
                val (frame, isLive) = select {
                    snapshots.onReceive { it to false }
                    liveSignal.onReceive { (liveSlot.getAndSet(null)) to true }
                }
                frame ?: continue
                val t = token() ?: continue
                var tries = 0
                while (isActive) {
                    try {
                        backend.uploadFrame(t, frame.jpeg, isLive, frame.fromLive, session(), frame.battery, frame.takenAt)
                        onResult(true, isLive, null)
                        break
                    } catch (e: UnpairedException) {
                        onResult(false, isLive, e.message); break
                    } catch (e: Exception) {
                        onResult(false, isLive, e.message)
                        if (isLive || ++tries >= 5) break // drop stale live frames; give up on a snapshot after 5 tries
                        if (tries == 1) DebugLog.add("Upload", "Snapshot upload failed, retrying: ${e.message}")
                        delay(2000L * tries)
                    }
                }
            }
        }
    }

    fun stop() { job?.cancel(); job = null; liveSlot.set(null) }
}
