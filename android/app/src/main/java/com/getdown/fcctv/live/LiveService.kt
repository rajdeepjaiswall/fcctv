package com.getdown.fcctv.live

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.getdown.fcctv.R
import com.getdown.fcctv.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Keeps streaming with the screen off. Its permanent notification is the worker's always-visible
 * sign that the camera is live, with a Stop button.
 */
class LiveService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var started = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            LiveController.stop()
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        if (!started) {
            started = true
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL, "Live camera", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Shows while the glasses camera is streaming to the owner"
                    setShowBadge(false)
                }
            )
            ServiceCompat.startForeground(this, NOTIF_ID, build(LiveController.state.value),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
            LiveController.start()
            scope.launch {
                LiveController.state
                    .map { listOf(it.phase, it.battery, it.charging, it.detail.take(40)) to it }
                    .distinctUntilChanged { a, b -> a.first == b.first }
                    .collect { (_, s) ->
                        if (s.phase == LivePhase.OFF && !LiveController.isWanted) { stopSelf(); return@collect }
                        getSystemService(NotificationManager::class.java).notify(NOTIF_ID, build(s))
                    }
            }
        }
        return START_NOT_STICKY
    }

    private fun build(s: LiveState): Notification {
        val title = when (s.phase) {
            LivePhase.LIVE -> "● LIVE · Camera is streaming to the owner"
            LivePhase.STARTING -> "Starting camera…"
            LivePhase.RETRYING -> "Reconnecting camera…"
            LivePhase.OFF -> "Camera off"
        }
        val text = buildString {
            append(s.detail)
            s.battery?.let { append(" · Glasses battery $it%"); if (s.charging) append(" ⚡") }
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, LiveService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_live)
            .setColor(ContextCompat.getColor(this, R.color.leafy_green_dark))
            .setColorized(false)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(0, "Stop streaming", stop)
            .build()
    }

    override fun onDestroy() { scope.cancel(); super.onDestroy() }

    companion object {
        private const val CHANNEL = "live"
        private const val NOTIF_ID = 11
        private const val ACTION_STOP = "com.getdown.fcctv.STOP"

        fun start(context: Context) =
            ContextCompat.startForegroundService(context, Intent(context, LiveService::class.java))

        fun stop(context: Context) {
            context.startService(Intent(context, LiveService::class.java).setAction(ACTION_STOP))
        }
    }
}
