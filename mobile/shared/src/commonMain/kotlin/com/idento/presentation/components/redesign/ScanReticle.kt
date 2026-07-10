package com.idento.presentation.components.redesign

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoRadius

/**
 * QR scan reticle with the animated sweeping scan line, matching the design's
 * `idm-scan` keyframes: 0%→top 10% opacity 1, 48%→top 86% opacity 1, 52-100%→top 10% opacity 0,
 * 2.6s infinite loop.
 */
@Composable
fun ScanReticle(modifier: Modifier = Modifier, size: androidx.compose.ui.unit.Dp = 260.dp) {
    val transition = rememberInfiniteTransition(label = "scan-reticle")
    val progress by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(animation = tween(2600, easing = LinearEasing), repeatMode = RepeatMode.Restart),
        label = "scan-line-progress"
    )
    // top% goes 10 -> 86 over the first 48% of the cycle, then the line is invisible for the rest.
    val linePositionFraction = (progress / 0.48f).coerceIn(0f, 1f)
    val lineTopFraction = 0.10f + linePositionFraction * (0.86f - 0.10f)
    val lineAlpha = if (progress <= 0.48f) 1f else 0f

    Box(
        modifier = modifier
            .size(size)
            .border(2.dp, IdentoColors.Indicator, RoundedCornerShape(IdentoRadius.scanReticle))
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(2.dp)
                .align(Alignment.TopCenter)
                .offset(y = size * lineTopFraction)
                .background(IdentoColors.Indicator)
                .alpha(lineAlpha)
        )
    }
}
