package com.idento.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Brand color - Idento Green
 * Same as in web: #00935E
 */
val IdentoGreen = Color(0xFF00935E)

/**
 * Idento App Icon - Square with rounded corners
 * Used for app icon representation in UI
 */
@Composable
fun IdentoAppIcon(
    modifier: Modifier = Modifier,
    size: Dp = 80.dp,
    cornerRadius: Dp = 18.dp,
    showFullName: Boolean = false
) {
    val fontSize = if (showFullName) (size.value * 0.27f).sp else (size.value * 0.6f).sp
    val text = if (showFullName) "Idento" else "id"
    
    Box(
        modifier = modifier
            .size(size)
            .clip(RoundedCornerShape(cornerRadius))
            .background(IdentoGreen),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = text,
            color = Color.White,
            fontSize = fontSize,
            fontWeight = FontWeight.Bold
        )
    }
}

/**
 * Idento Logo - Horizontal text logo
 * Used in headers and branding
 */
@Composable
fun IdentoLogo(
    modifier: Modifier = Modifier,
    fontSize: TextUnit = 32.sp,
    color: Color = MaterialTheme.colorScheme.onBackground
) {
    Text(
        text = "Idento",
        modifier = modifier,
        color = color,
        fontSize = fontSize,
        fontWeight = FontWeight.Bold
    )
}

/**
 * Idento Logo with Icon - Combined icon and text
 */
@Composable
fun IdentoLogoWithIcon(
    modifier: Modifier = Modifier,
    iconSize: Dp = 48.dp,
    fontSize: TextUnit = 28.sp
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        IdentoAppIcon(
            size = iconSize,
            cornerRadius = (iconSize.value * 0.22f).dp
        )
        Text(
            text = "Idento",
            color = MaterialTheme.colorScheme.onBackground,
            fontSize = fontSize,
            fontWeight = FontWeight.Bold
        )
    }
}

/**
 * Large Idento branding for splash/login screens
 */
@Composable
fun IdentoBranding(
    modifier: Modifier = Modifier,
    iconSize: Dp = 100.dp,
    showText: Boolean = true
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        IdentoAppIcon(
            size = iconSize,
            cornerRadius = (iconSize.value * 0.22f).dp,
            showFullName = false
        )
        if (showText) {
            Text(
                text = "Idento",
                color = Color.White,
                fontSize = 36.sp,
                fontWeight = FontWeight.Bold
            )
        }
    }
}
