package com.getdown.fcctv

import android.app.Application
import com.getdown.fcctv.live.LiveController

class FcctvApp : Application() {
    override fun onCreate() {
        super.onCreate()
        LiveController.init(this)
    }
}
