package com.idento.presentation.theme

import androidx.compose.ui.graphics.Color

// ============================================
// Modern, Light & Airy Color Palette
// ============================================

// Primary - Fresh Mint/Teal (легкий и современный)
val Primary = Color(0xFF0D9488)           // Teal 600 - основной акцент
val PrimaryLight = Color(0xFF5EEAD4)      // Teal 300 - светлый акцент
val PrimaryDark = Color(0xFF0F766E)       // Teal 700 - темный акцент
val PrimaryContainer = Color(0xFFCCFBF1)  // Teal 100 - фон контейнеров
val OnPrimaryContainer = Color(0xFF134E4A) // Teal 900 - текст на контейнере

// Secondary - Soft Purple (дополнительный акцент)
val Secondary = Color(0xFF8B5CF6)         // Violet 500
val SecondaryLight = Color(0xFFC4B5FD)    // Violet 300
val SecondaryContainer = Color(0xFFEDE9FE) // Violet 100
val OnSecondaryContainer = Color(0xFF4C1D95) // Violet 900

// Tertiary - Warm Amber (для специальных случаев)
val Tertiary = Color(0xFFF59E0B)          // Amber 500
val TertiaryContainer = Color(0xFFFEF3C7) // Amber 100

// Semantic Colors
val Success = Color(0xFF22C55E)           // Green 500 - более яркий
val SuccessLight = Color(0xFFDCFCE7)      // Green 100
val Warning = Color(0xFFF97316)           // Orange 500
val WarningLight = Color(0xFFFFEDD5)      // Orange 100
val Error = Color(0xFFEF4444)             // Red 500
val ErrorLight = Color(0xFFFEE2E2)        // Red 100
val Info = Color(0xFF3B82F6)              // Blue 500
val InfoLight = Color(0xFFDBEAFE)         // Blue 100

// Neutral Colors - очень легкие и воздушные
val Neutral50 = Color(0xFFFAFAFA)         // Почти белый
val Neutral100 = Color(0xFFF5F5F5)        // Очень светло-серый
val Neutral200 = Color(0xFFE5E5E5)        // Светло-серый
val Neutral300 = Color(0xFFD4D4D4)        // Серый
val Neutral400 = Color(0xFFA3A3A3)        // Средне-серый
val Neutral500 = Color(0xFF737373)        // Темно-серый
val Neutral600 = Color(0xFF525252)        // Еще темнее
val Neutral700 = Color(0xFF404040)        // Почти черный
val Neutral800 = Color(0xFF262626)        // Очень темный
val Neutral900 = Color(0xFF171717)        // Почти черный

// Surface colors - для карточек и фонов
val SurfaceLight = Color(0xFFFFFFFF)
val SurfaceDim = Color(0xFFFAFAFA)
val SurfaceContainer = Color(0xFFF5F5F5)
val SurfaceContainerHigh = Color(0xFFEFEFEF)

// Dark theme surfaces
val SurfaceDark = Color(0xFF121212)
val SurfaceDarkDim = Color(0xFF1E1E1E)
val SurfaceContainerDark = Color(0xFF2D2D2D)

// Legacy aliases for backwards compatibility
val ItalianGreen = Primary
val ItalianGreenDark = PrimaryDark
val ItalianGreenLight = PrimaryLight
val Gray50 = Neutral50
val Gray100 = Neutral100
val Gray200 = Neutral200
val Gray300 = Neutral300
val Gray400 = Neutral400
val Gray500 = Neutral500
val Gray600 = Neutral600
val Gray700 = Neutral700
val Gray800 = Neutral800
val Gray900 = Neutral900
