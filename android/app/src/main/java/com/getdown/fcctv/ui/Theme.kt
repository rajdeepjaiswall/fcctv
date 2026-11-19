package com.getdown.fcctv.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** FCCTV palette — only these four colours (plus darker tones of green and brown). */
object Brand {
    val LeafyGreen = Color(0xFFA5E420)
    val LeafyGreenDark = Color(0xFF4E7A0E)
    val MuddyBrown = Color(0xFF8A4B22)
    val MuddyBrownDark = Color(0xFF5C3216)
    val White = Color(0xFFFFFFFF)
    val Black = Color(0xFF111111)
}

private val Light = lightColorScheme(
    primary = Brand.LeafyGreen, onPrimary = Brand.Black,
    secondary = Brand.MuddyBrown, onSecondary = Brand.White,
    tertiary = Brand.LeafyGreenDark, onTertiary = Brand.White,
    background = Brand.White, onBackground = Brand.Black,
    surface = Brand.White, onSurface = Brand.Black,
    surfaceVariant = Color(0xFFF4F1EE), onSurfaceVariant = Brand.MuddyBrownDark,
    error = Brand.MuddyBrownDark, onError = Brand.White,
    outline = Brand.MuddyBrown,
)

private val Dark = darkColorScheme(
    primary = Brand.LeafyGreen, onPrimary = Brand.Black,
    secondary = Brand.MuddyBrown, onSecondary = Brand.White,
    tertiary = Brand.LeafyGreen, onTertiary = Brand.Black,
    background = Brand.Black, onBackground = Brand.White,
    surface = Brand.Black, onSurface = Brand.White,
    surfaceVariant = Color(0xFF221A14), onSurfaceVariant = Color(0xFFE8DDD4),
    error = Brand.MuddyBrown, onError = Brand.White,
    outline = Brand.MuddyBrown,
)

@Composable
fun FcctvTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}
