package com.getdown.fcctv.stream

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.ByteArrayOutputStream

/** Glasses photos can be several MB; shrink to ~1280 px for fast mobile upload and AI analysis. */
object Jpeg {
    fun shrink(jpeg: ByteArray, maxSide: Int = 1280, quality: Int = 82): ByteArray = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size, bounds)
        val longest = maxOf(bounds.outWidth, bounds.outHeight)
        if (longest <= 0 || (longest <= maxSide && jpeg.size < 400_000)) return jpeg
        var sample = 1
        while (longest / (sample * 2) >= maxSide) sample *= 2
        val decoded = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: return jpeg
        val scale = maxSide.toFloat() / maxOf(decoded.width, decoded.height)
        val bmp = if (scale < 1f) Bitmap.createScaledBitmap(decoded, (decoded.width * scale).toInt(), (decoded.height * scale).toInt(), true) else decoded
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, quality, out)
        if (bmp !== decoded) decoded.recycle()
        bmp.recycle()
        out.toByteArray()
    }.getOrDefault(jpeg)
}
