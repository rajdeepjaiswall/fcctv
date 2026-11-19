package com.getdown.fcctv.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.getdown.fcctv.live.LiveController
import com.getdown.fcctv.live.LiveService
import kotlinx.coroutines.delay

enum class Screen { SPLASH, CONSENT, HOME, DEVICES, LOG }

class MainActivity : ComponentActivity() {
    private var screen by mutableStateOf(Screen.SPLASH)
    private var permissionsOk by mutableStateOf(false)
    private var pendingStart = false

    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        permissionsOk = missingPermissions().isEmpty()
        if (permissionsOk) {
            LiveController.connectSaved()
            if (pendingStart) { pendingStart = false; startLive() }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        permissionsOk = missingPermissions().isEmpty()
        setContent {
            FcctvTheme {
                LaunchedEffect(Unit) {
                    delay(1200)
                    screen = if (LiveController.prefs.consentAt == 0L) Screen.CONSENT else Screen.HOME
                }
                when (screen) {
                    Screen.SPLASH -> BrandSplash()
                    Screen.CONSENT -> ConsentScreen(
                        initialName = LiveController.prefs.workerName,
                        onAccept = { name ->
                            LiveController.prefs.workerName = name
                            LiveController.prefs.consentAt = System.currentTimeMillis()
                            screen = Screen.HOME
                            askPermissions()
                        },
                        onDecline = { finish() },
                    )
                    Screen.HOME -> HomeScreen(
                        permissionsOk = permissionsOk,
                        onGrantPermissions = ::askPermissions,
                        onChooseGlasses = { screen = Screen.DEVICES },
                        onStart = ::startLive,
                        onStop = { LiveService.stop(this) },
                        onOpenLog = { screen = Screen.LOG },
                        onBatteryExemption = ::requestBatteryExemption,
                        batteryOptimized = !ignoringBatteryOptimizations(),
                    )
                    Screen.DEVICES -> DeviceScreen(
                        onBack = { screen = Screen.HOME },
                        onPicked = { addr, name -> LiveController.selectDevice(addr, name); screen = Screen.HOME },
                    )
                    Screen.LOG -> LogScreen(onBack = { screen = Screen.HOME })
                }
                androidx.activity.compose.BackHandler(enabled = screen == Screen.DEVICES || screen == Screen.LOG) {
                    screen = Screen.HOME
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        permissionsOk = missingPermissions().isEmpty()
        if (permissionsOk && LiveController.prefs.consentAt != 0L) LiveController.connectSaved()
    }

    private fun startLive() {
        if (!permissionsOk) { pendingStart = true; askPermissions(); return }
        LiveService.start(this)
    }

    private fun askPermissions() {
        val missing = missingPermissions()
        if (missing.isNotEmpty()) permissionLauncher.launch(missing.toTypedArray())
        else { permissionsOk = true; LiveController.connectSaved() }
    }

    private fun missingPermissions(): List<String> {
        val wanted = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        if (Build.VERSION.SDK_INT >= 31) wanted += listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        if (Build.VERSION.SDK_INT >= 33) wanted += listOf(Manifest.permission.NEARBY_WIFI_DEVICES, Manifest.permission.POST_NOTIFICATIONS)
        return wanted.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
    }

    private fun ignoringBatteryOptimizations(): Boolean =
        getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)

    /** Lets the stream survive the phone's battery saver with the screen off. */
    @SuppressLint("BatteryLife")
    private fun requestBatteryExemption() {
        runCatching {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        }.onFailure { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
    }
}
