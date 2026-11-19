package com.getdown.fcctv.net

import android.net.Network
import com.getdown.fcctv.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

data class ServerConfig(
    val liveRequested: Boolean = false,
    val snapshotIntervalSec: Int = 10,
    val liveFps: Int = 2,
    val withinHours: Boolean = true,
    val workStart: String = "",
    val workEnd: String = "",
    val active: Boolean = true,
    val reachedServer: Boolean = false,
)

class UnpairedException : IOException("This phone is no longer paired. Ask the owner for a new pairing code.")

/** Talks to the FCCTV device API (Supabase Edge Function), always over a real internet network. */
class Backend(private val net: InternetNetwork) {
    private val base = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()
    private var boundTo: Network? = null
    private var bound: OkHttpClient = base

    @Synchronized
    private fun client(): OkHttpClient {
        val n = net.pick()
        if (n != boundTo) {
            boundTo = n
            bound = if (n == null) base else base.newBuilder().socketFactory(n.socketFactory).build()
        }
        return bound
    }

    private val jsonType = "application/json".toMediaType()
    private val jpegType = "image/jpeg".toMediaType()

    private suspend fun post(path: String, token: String?, body: okhttp3.RequestBody, headers: Map<String, String> = emptyMap()): JSONObject =
        withContext(Dispatchers.IO) {
            val req = Request.Builder().url("${Config.DEVICE_API}/$path").post(body).apply {
                token?.let { header("Authorization", "Bearer $it") }
                headers.forEach { (k, v) -> header(k, v) }
            }.build()
            client().newCall(req).execute().use { r ->
                val text = r.body?.string().orEmpty()
                val obj = runCatching { JSONObject(text) }.getOrElse { JSONObject() }
                if (r.code == 401) throw UnpairedException()
                if (!r.isSuccessful) throw IOException(obj.optString("error").ifBlank { "Server error ${r.code}" })
                obj
            }
        }

    data class Pairing(val deviceId: String, val workerName: String, val token: String)

    suspend fun pair(code: String, consentAt: Long, consentName: String): Pairing {
        val body = JSONObject()
            .put("code", code)
            .put("consent_at", java.time.Instant.ofEpochMilli(consentAt).toString())
            .put("consent_name", consentName)
            .put("app_version", BuildConfig.VERSION_NAME)
        val r = post("pair", null, body.toString().toRequestBody(jsonType))
        return Pairing(r.getString("device_id"), r.optString("worker_name"), r.getString("token"))
    }

    suspend fun heartbeat(token: String, status: JSONObject): ServerConfig {
        val r = post("heartbeat", token, status.put("app_version", BuildConfig.VERSION_NAME).toString().toRequestBody(jsonType))
        return ServerConfig(
            liveRequested = r.optBoolean("live_requested"),
            snapshotIntervalSec = r.optInt("snapshot_interval_sec", 10).coerceIn(3, 600),
            liveFps = r.optInt("live_fps", 2).coerceIn(1, 5),
            withinHours = r.optBoolean("within_hours", true),
            workStart = r.optString("work_start"),
            workEnd = r.optString("work_end"),
            active = r.optBoolean("active", true),
            reachedServer = true,
        )
    }

    suspend fun startSession(token: String): String =
        post("session", token, JSONObject().put("action", "start").toString().toRequestBody(jsonType)).getString("session_id")

    suspend fun stopSession(token: String, sessionId: String) {
        post("session", token, JSONObject().put("action", "stop").put("session_id", sessionId).toString().toRequestBody(jsonType))
    }

    suspend fun uploadFrame(token: String, jpeg: ByteArray, live: Boolean, fromLive: Boolean, sessionId: String?, battery: Int?, takenAt: Long) {
        val h = mutableMapOf("x-kind" to if (live) "live" else "snapshot", "x-source" to if (fromLive) "live" else "photo", "x-taken-at" to takenAt.toString())
        sessionId?.let { h["x-session"] = it }
        battery?.let { h["x-battery"] = it.toString() }
        post("frame", token, jpeg.toRequestBody(jpegType), h)
    }
}
