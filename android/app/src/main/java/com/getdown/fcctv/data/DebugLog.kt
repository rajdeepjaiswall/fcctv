package com.getdown.fcctv.data

import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * In-app connection log (last 300 lines), shown in Settings -> Connection log so problems
 * can be copied and shared without a computer or adb.
 */
object DebugLog {
    private val fmt = SimpleDateFormat("HH:mm:ss", Locale.US)
    private val _lines = MutableStateFlow<List<String>>(emptyList())
    val lines: StateFlow<List<String>> = _lines.asStateFlow()

    @Synchronized
    fun add(tag: String, msg: String) {
        Log.i(tag, msg)
        _lines.value = (_lines.value + "${fmt.format(Date())} [$tag] $msg").takeLast(300)
    }

    fun clear() { _lines.value = emptyList() }
}
