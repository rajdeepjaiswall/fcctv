package com.getdown.fcctv.ui

import android.graphics.BitmapFactory
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.BatteryChargingFull
import androidx.compose.material.icons.filled.BatteryStd
import androidx.compose.material.icons.filled.Bluetooth
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.getdown.fcctv.R
import com.getdown.fcctv.data.DebugLog
import com.getdown.fcctv.glasses.GlassesScanner
import com.getdown.fcctv.glasses.LinkState
import com.getdown.fcctv.live.LiveController
import com.getdown.fcctv.live.LivePhase
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch

// ------------------------------------------------------------------ shared pieces

@Composable
private fun BrandHeader(title: String = "FCCTV", onBack: (() -> Unit)? = null) {
    Surface(color = Brand.MuddyBrown, contentColor = Brand.White) {
        Row(
            Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Brand.White) }
            } else {
                Image(painterResource(R.drawable.logo_icon), null, Modifier.size(36.dp).clip(RoundedCornerShape(8.dp)))
                Spacer(Modifier.width(10.dp))
            }
            Column {
                Text(title, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                Text("by Get Down Foundation", fontSize = 12.sp, color = Brand.LeafyGreen)
            }
        }
    }
}

@Composable
fun BrandSplash() {
    Column(
        Modifier.fillMaxSize().background(Brand.White).padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Image(painterResource(R.drawable.logo_full), "Getdown Foundation logo", Modifier.fillMaxWidth(0.8f))
        Spacer(Modifier.height(24.dp))
        Text("FCCTV", fontSize = 40.sp, fontWeight = FontWeight.Black, color = Brand.Black)
        Text("by Get Down Foundation", fontSize = 16.sp, color = Brand.MuddyBrown)
    }
}

// ------------------------------------------------------------------ consent

@Composable
fun ConsentScreen(initialName: String, onAccept: (String) -> Unit, onDecline: () -> Unit) {
    var name by remember { mutableStateOf(initialName) }
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        BrandHeader("Before you start")
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Camera notice for workers", fontWeight = FontWeight.Bold, fontSize = 22.sp)
            Text("This app connects to the smart glasses you wear and sends photos from their camera (every few seconds) and, when the owner asks, live video to the shop owner's dashboard and phone.")
            Text("• Video is streamed only while the camera is on, during working hours set by the owner.\n" +
                "• You will always see a \"LIVE\" sign in this app and a notification while it streams.\n" +
                "• Snapshots and clips may be saved and reviewed by the owner, including by AI tools that summarise activity.\n" +
                "• You can ask the owner how long recordings are kept and who can see them.")
            Text("Please type your name and tap \"I understand and agree\". The date and time of your agreement are recorded.")
            OutlinedTextField(name, { name = it }, label = { Text("Your name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        }
        Column(Modifier.padding(20.dp).navigationBarsPadding()) {
            Button(
                onClick = { onAccept(name.trim()) }, enabled = name.isNotBlank(),
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text("I understand and agree", fontWeight = FontWeight.Bold) }
            TextButton(onClick = onDecline, modifier = Modifier.fillMaxWidth()) { Text("I don't agree (close app)", color = Brand.MuddyBrown) }
        }
    }
}

// ------------------------------------------------------------------ home

@Composable
fun HomeScreen(
    permissionsOk: Boolean,
    onGrantPermissions: () -> Unit,
    onChooseGlasses: () -> Unit,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onOpenLog: () -> Unit,
    onBatteryExemption: () -> Unit,
    batteryOptimized: Boolean,
) {
    val s by LiveController.state.collectAsState()
    val frame by LiveController.frame.collectAsState()
    val running = s.phase != LivePhase.OFF

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        BrandHeader()
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            LiveBadge(s.phase)

            // Preview
            Box(
                Modifier.fillMaxWidth().aspectRatio(4f / 3f).clip(RoundedCornerShape(16.dp)).background(Brand.Black),
                contentAlignment = Alignment.Center,
            ) {
                val bmp = remember(frame) { frame?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } }
                if (bmp != null) Image(bmp, "Live view from glasses", Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                else Text(if (running) s.detail.ifBlank { "Starting…" } else "Camera is off. Tap Start duty.", color = Brand.White, modifier = Modifier.padding(16.dp))
            }
            if (s.frames > 0 || running) Text(
                buildString {
                    append("Captured ${s.frames} · sent ${s.uploaded}")
                    if (s.phase == LivePhase.LIVE) append(" · %.1f fps".format(s.fps))
                    append(if (s.online) " · server OK" else " · server not reached")
                },
                fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            s.uploadError?.let { if (running || !s.paired) Text(it, fontSize = 13.sp, color = Brand.MuddyBrown) }
            if (!s.paired) PairCard()
            else Text("Paired as ${s.workerName ?: "worker"}", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)

            if (!permissionsOk) {
                InfoCard("Permissions needed", "Allow Nearby devices, Location and Notifications so FCCTV can reach the glasses.", "Allow", onGrantPermissions)
            }

            // Glasses card
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Bluetooth, null, tint = Brand.MuddyBrown)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(s.deviceName ?: "No glasses chosen", fontWeight = FontWeight.Bold)
                        Text(
                            when (s.link) {
                                LinkState.CONNECTED -> "Connected"
                                LinkState.CONNECTING -> "Connecting…"
                                LinkState.DISCONNECTED -> "Not connected"
                            }, fontSize = 13.sp,
                        )
                    }
                    s.battery?.let {
                        Icon(if (s.charging) Icons.Filled.BatteryChargingFull else Icons.Filled.BatteryStd, null,
                            tint = if (it <= 20) Brand.MuddyBrown else Brand.LeafyGreenDark)
                        Text("$it%", fontWeight = FontWeight.Bold)
                        Spacer(Modifier.width(8.dp))
                    }
                    OutlinedButton(onClick = onChooseGlasses, enabled = !running) { Text(if (s.deviceName == null) "Choose" else "Change") }
                }
            }

            if (s.detail.isNotBlank()) Text(s.detail, fontSize = 14.sp)

            if (batteryOptimized) {
                InfoCard("Keep streaming with the screen off", "Allow FCCTV to run in the background so OnePlus battery saver doesn't stop it.", "Allow", onBatteryExemption)
            }

            Text("Local stream on this phone: http://127.0.0.1:${LiveController.MJPEG_PORT}/mjpeg", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = onOpenLog) { Text("Connection log", color = Brand.MuddyBrown) }
        }

        Box(Modifier.padding(16.dp).navigationBarsPadding()) {
            if (!running) Button(onClick = onStart, enabled = s.deviceName != null && s.paired, modifier = Modifier.fillMaxWidth().height(56.dp)) {
                Icon(Icons.Filled.Videocam, null); Spacer(Modifier.width(8.dp)); Text("Start duty", fontWeight = FontWeight.Bold, fontSize = 17.sp)
            } else Button(
                onClick = onStop, modifier = Modifier.fillMaxWidth().height(56.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Brand.MuddyBrown, contentColor = Brand.White),
            ) { Text("Stop duty", fontWeight = FontWeight.Bold, fontSize = 17.sp) }
        }
    }
}

@Composable
private fun PairCard() {
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    Card(colors = CardDefaults.cardColors(containerColor = Brand.MuddyBrown, contentColor = Brand.White)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Connect to the owner", fontWeight = FontWeight.Bold)
            Text("Type the pairing code shown on the owner's dashboard (Workers → Add worker).", fontSize = 14.sp)
            OutlinedTextField(
                code, { code = it.uppercase().filter { c -> c.isLetterOrDigit() }.take(12) },
                label = { Text("Pairing code") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                    focusedTextColor = Brand.White, unfocusedTextColor = Brand.White,
                    focusedLabelColor = Brand.LeafyGreen, unfocusedLabelColor = Brand.White,
                    focusedBorderColor = Brand.LeafyGreen, unfocusedBorderColor = Brand.White,
                ),
            )
            error?.let { Text(it, fontSize = 14.sp, fontWeight = FontWeight.Bold) }
            Button(enabled = code.length >= 6 && !busy, onClick = {
                busy = true; error = null
                scope.launch {
                    runCatching { LiveController.pair(code) }.onFailure { error = it.message ?: "Couldn't pair" }
                    busy = false
                }
            }) { Text(if (busy) "Pairing…" else "Pair this phone") }
        }
    }
}

@Composable
private fun LiveBadge(phase: LivePhase) {
    val pulse = rememberInfiniteTransition(label = "pulse")
    val a by pulse.animateFloat(1f, 0.25f, infiniteRepeatable(tween(800), RepeatMode.Reverse), label = "a")
    val (bg, fg, label) = when (phase) {
        LivePhase.LIVE -> Triple(Brand.LeafyGreen, Brand.Black, "LIVE · Video to owner")
        LivePhase.SNAPSHOT -> Triple(Brand.LeafyGreenDark, Brand.White, "ON DUTY · Photos to owner")
        LivePhase.STARTING -> Triple(Brand.MuddyBrown, Brand.White, "Starting camera…")
        LivePhase.RETRYING -> Triple(Brand.MuddyBrownDark, Brand.White, "Reconnecting…")
        LivePhase.PAUSED -> Triple(Brand.MuddyBrownDark, Brand.White, "Paused")
        LivePhase.OFF -> Triple(Brand.Black, Brand.White, "Camera off")
    }
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(bg).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(16.dp).alpha(if (phase == LivePhase.OFF) 0.4f else a).clip(CircleShape).background(fg))
        Spacer(Modifier.width(12.dp))
        Text(label, color = fg, fontWeight = FontWeight.Black, fontSize = 20.sp)
    }
}

@Composable
private fun InfoCard(title: String, body: String, action: String, onAction: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = Brand.MuddyBrown, contentColor = Brand.White)) {
        Column(Modifier.padding(14.dp)) {
            Text(title, fontWeight = FontWeight.Bold)
            Text(body, fontSize = 14.sp)
            Button(onClick = onAction, modifier = Modifier.padding(top = 8.dp)) { Text(action) }
        }
    }
}

// ------------------------------------------------------------------ device picker

@Composable
fun DeviceScreen(onBack: () -> Unit, onPicked: (String, String) -> Unit) {
    val context = LocalContext.current
    val scanner = remember { GlassesScanner(context) }
    val devices by scanner.devices.collectAsState()
    DisposableEffect(Unit) {
        runCatching { scanner.start() }
        onDispose { scanner.stop() }
    }
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        BrandHeader("Choose glasses", onBack)
        Text(
            if (!scanner.bluetoothOn) "Turn on Bluetooth first." else "Glasses (like HQ508C) appear at the top. Close the official HeyCyan app first.",
            Modifier.padding(16.dp),
        )
        LazyColumn(Modifier.fillMaxSize()) {
            items(devices, key = { it.address }) { d ->
                Row(
                    Modifier.fillMaxWidth().clickable { onPicked(d.address, d.name) }.padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(10.dp).clip(CircleShape).background(if (d.likelyGlasses) Brand.LeafyGreen else Brand.MuddyBrown))
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(d.name, fontWeight = if (d.likelyGlasses) FontWeight.Bold else FontWeight.Normal)
                        Text(d.address, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (d.likelyGlasses) Text("Glasses", color = Brand.LeafyGreenDark, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

// ------------------------------------------------------------------ log

@Composable
fun LogScreen(onBack: () -> Unit) {
    val lines by DebugLog.lines.collectAsState()
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        BrandHeader("Connection log", onBack)
        Row(Modifier.padding(horizontal = 16.dp)) {
            TextButton(onClick = { clipboard.setText(androidx.compose.ui.text.AnnotatedString(lines.joinToString("\n"))) }) { Text("Copy all") }
            TextButton(onClick = { DebugLog.clear() }) { Text("Clear") }
        }
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
            items(lines.reversed()) { Text(it, fontSize = 12.sp, modifier = Modifier.padding(vertical = 2.dp)) }
        }
    }
}
