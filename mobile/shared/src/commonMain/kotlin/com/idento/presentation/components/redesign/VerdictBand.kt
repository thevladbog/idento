package com.idento.presentation.components.redesign

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.presentation.theme.IdentoTypeScale

/**
 * Colored top band (~42% of the verdict screen's height) with an icon + the verdict word.
 * Color/icon/word are supplied by the caller per verdict (Success=green, AlreadyChecked=amber,
 * NotFound=neutral, Denied=red, PrintError=green — see RegistrationVerdict/ZoneVerdict).
 */
@Composable
fun VerdictBand(word: String, icon: ImageVector, color: Color, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.fillMaxWidth().background(color),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(56.dp))
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                word.uppercase(),
                color = Color.White,
                fontSize = IdentoTypeScale.verdictWord,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = 1.sp
            )
        }
    }
}
