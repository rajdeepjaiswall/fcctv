package com.getdown.fcctv.data

import android.content.Context

/** Small on-phone settings: consent record, chosen glasses and worker name. */
class Prefs(context: Context) {
    private val p = context.getSharedPreferences("fcctv", Context.MODE_PRIVATE)

    /** When the worker accepted the streaming notice (epoch ms), 0 if never. */
    var consentAt: Long
        get() = p.getLong("consent_at", 0L)
        set(v) = p.edit().putLong("consent_at", v).apply()

    var workerName: String
        get() = p.getString("worker_name", "") ?: ""
        set(v) = p.edit().putString("worker_name", v).apply()

    var deviceAddress: String?
        get() = p.getString("device_address", null)
        set(v) = p.edit().putString("device_address", v).apply()

    /** Device token from pairing with the owner's dashboard (null = not paired). */
    var deviceToken: String?
        get() = p.getString("device_token", null)
        set(v) = p.edit().putString("device_token", v).apply()

    var pairedWorkerName: String?
        get() = p.getString("paired_worker", null)
        set(v) = p.edit().putString("paired_worker", v).apply()

    var deviceName: String?
        get() = p.getString("device_name", null)
        set(v) = p.edit().putString("device_name", v).apply()
}
