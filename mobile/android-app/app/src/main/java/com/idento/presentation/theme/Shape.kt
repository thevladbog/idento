package com.idento.presentation.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

/**
 * Modern rounded shapes for a soft, friendly UI
 * Larger radii for a more modern, approachable look
 */
val IdentoShapes = Shapes(
    // Extra small - chips, small buttons, badges
    extraSmall = RoundedCornerShape(8.dp),
    
    // Small - buttons, input fields, small cards
    small = RoundedCornerShape(12.dp),
    
    // Medium - cards, dialogs, containers
    medium = RoundedCornerShape(16.dp),
    
    // Large - bottom sheets, large cards, modals
    large = RoundedCornerShape(24.dp),
    
    // Extra large - full-screen modals, feature cards
    extraLarge = RoundedCornerShape(32.dp)
)

// Custom shapes for specific use cases
val CardShape = RoundedCornerShape(20.dp)
val ButtonShape = RoundedCornerShape(14.dp)
val InputShape = RoundedCornerShape(12.dp)
val ChipShape = RoundedCornerShape(10.dp)
val AvatarShape = RoundedCornerShape(50) // Fully rounded
val BottomSheetShape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)
