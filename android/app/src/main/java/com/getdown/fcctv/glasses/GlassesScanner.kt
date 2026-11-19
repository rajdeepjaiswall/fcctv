package com.getdown.fcctv.glasses

import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.Locale

data class FoundDevice(val name: String, val address: String, val rssi: Int, val likelyGlasses: Boolean)

/** BLE scan that lists nearby devices, with HeyCyan-style glasses (e.g. HQ508C) on top. */
class GlassesScanner(context: Context) {
    private val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
    private val found = LinkedHashMap<String, FoundDevice>()
    private val _devices = MutableStateFlow<List<FoundDevice>>(emptyList())
    val devices: StateFlow<List<FoundDevice>> = _devices.asStateFlow()
    private val _scanning = MutableStateFlow(false)
    val scanning: StateFlow<Boolean> = _scanning.asStateFlow()

    private val callback = object : ScanCallback() {
        @SuppressLint("MissingPermission")
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val name = result.scanRecord?.deviceName ?: result.device.name ?: return
            add(name, result.device.address, result.rssi)
        }
    }

    val bluetoothOn: Boolean get() = adapter?.isEnabled == true

    @SuppressLint("MissingPermission")
    fun start() {
        val bt = adapter ?: return
        val scanner = bt.bluetoothLeScanner ?: return
        found.clear()
        // Already-paired glasses show up immediately.
        runCatching { bt.bondedDevices }.getOrNull()?.forEach { d -> d.name?.let { add(it, d.address, -100) } }
        scanner.startScan(null, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), callback)
        _scanning.value = true
    }

    @SuppressLint("MissingPermission")
    fun stop() {
        runCatching { adapter?.bluetoothLeScanner?.stopScan(callback) }
        _scanning.value = false
    }

    private fun add(name: String, address: String, rssi: Int) {
        val upper = name.uppercase(Locale.US)
        val glasses = GLASSES_HINTS.any { upper.contains(it) }
        found[address] = FoundDevice(name, address, maxOf(rssi, found[address]?.rssi ?: -127), glasses)
        _devices.value = found.values.sortedWith(compareByDescending<FoundDevice> { it.likelyGlasses }.thenByDescending { it.rssi })
    }

    companion object {
        private val GLASSES_HINTS = listOf("HQ508", "HQ5", "A02", "HEYCYAN", "CYAN", "M01", "M02", "GLASS", "W610", "E01")
    }
}
