package com.getdown.fcctv.net

/** Backend address. No secret lives in the APK: each phone gets its own token at pairing. */
object Config {
    const val SERVER = "https://fcctv.vercel.app"
    const val DEVICE_API = "$SERVER/api/device"
}
