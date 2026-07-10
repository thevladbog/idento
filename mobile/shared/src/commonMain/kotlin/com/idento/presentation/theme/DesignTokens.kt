package com.idento.presentation.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Design tokens for the mobile-redesign "kiosk-strict" dark UI (registration/zone-control/
 * kiosk station modes). Additive to the existing IdentoTheme/Color/Type — those keep serving
 * the pre-redesign screens unchanged; new screens (M1b/M1c) wrap themselves in a theme built
 * from these tokens instead. See docs/superpowers/specs/2026-07-10-mobile-refactor-redesign-design.md
 * section 6.1 for the source design.
 */
object IdentoColors {
    val Background = Color(0xFF111413)
    val Surface = Color(0xFF1B1F1D)
    val Brand = Color(0xFF00935E)
    val Indicator = Color(0xFF2EE6A8)
    val Queue = Color(0xFFFACC15)
    val Denied = Color(0xFFCE2B37)
    val Amber = Color(0xFFF5A300)
    val NeutralBand = Color(0xFF2B3230)

    val Hairline = Color(0xFF232725)
    val Border = Color(0xFF2A2F2C)
    val TextPrimary = Color(0xFFFFFFFF)
    val TextMuted = Color(0xFF6B736F)
    val TextSecondary = Color(0xFF9AA5A0)
    val ButtonLabel = Color(0xFFC8D0CC)
    val TextDisabled = Color(0xFF4D534F)

    val GreenTint = Color(0xFF0F2A20)
    val AmberTintDark = Color(0xFF23201A)
    val AmberTintDarker = Color(0xFF241A00)
    val RedTintDark = Color(0xFF2B1214)
    val RedTintDarker = Color(0xFF4A2226)
    val AlertTextLight = Color(0xFFFF8B93)
    val AlertTextLighter = Color(0xFFFF6B76)
    val AmberText = Color(0xFFF5C96A)
}

object IdentoSpacing {
    val xs = 4.dp
    val sm = 8.dp
    val md = 16.dp
    val lg = 22.dp
    val xl = 32.dp
}

object IdentoRadius {
    val buttonPrimary = 14.dp
    val buttonSecondary = 12.dp
    val card = 16.dp
    val segmentedOuter = 14.dp
    val segmentedInner = 11.dp
    val pill = 999.dp
    val scanReticle = 22.dp
}

object IdentoTypeScale {
    val verdictWord = 26.sp
    val attendeeName = 29.sp
    val kioskAttendeeName = 46.sp
    val eyebrowLabel = 11.sp
}
