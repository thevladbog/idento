package com.idento.presentation.components.redesign

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoRadius

@Composable
fun ModeSegmentedControl(options: List<String>, selectedIndex: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .background(IdentoColors.Surface, RoundedCornerShape(IdentoRadius.segmentedOuter))
            .padding(4.dp)
    ) {
        options.forEachIndexed { index, label ->
            val isSelected = index == selectedIndex
            Box(
                modifier = Modifier
                    .weight(1f)
                    .background(
                        if (isSelected) IdentoColors.Brand else androidx.compose.ui.graphics.Color.Transparent,
                        RoundedCornerShape(IdentoRadius.segmentedInner)
                    )
                    .clickable { onSelect(index) }
                    .padding(vertical = 10.dp),
                contentAlignment = androidx.compose.ui.Alignment.Center
            ) {
                Text(
                    label,
                    color = if (isSelected) androidx.compose.ui.graphics.Color.White else IdentoColors.TextSecondary,
                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.SemiBold,
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center
                )
            }
        }
    }
}
