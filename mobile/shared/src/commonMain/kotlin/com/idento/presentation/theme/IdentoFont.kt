package com.idento.presentation.theme

import androidx.compose.runtime.Composable
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import idento.shared.generated.resources.Res
import idento.shared.generated.resources.inter_bold
import idento.shared.generated.resources.inter_extrabold
import idento.shared.generated.resources.inter_medium
import idento.shared.generated.resources.inter_regular
import idento.shared.generated.resources.inter_semibold
import org.jetbrains.compose.resources.Font

/**
 * Bundled Inter font family (400/500/600/700/800), for the mobile-redesign dark UI.
 * Not wired into the existing `Typography` (Type.kt) — that keeps using the system font for
 * pre-redesign screens. M1b/M1c's new theme wrapper uses this instead.
 */
@Composable
fun identoFontFamily(): FontFamily = FontFamily(
    Font(Res.font.inter_regular, weight = FontWeight.Normal),
    Font(Res.font.inter_medium, weight = FontWeight.Medium),
    Font(Res.font.inter_semibold, weight = FontWeight.SemiBold),
    Font(Res.font.inter_bold, weight = FontWeight.Bold),
    Font(Res.font.inter_extrabold, weight = FontWeight.ExtraBold),
)
