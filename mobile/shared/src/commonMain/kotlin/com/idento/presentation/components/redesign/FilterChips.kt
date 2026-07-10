package com.idento.presentation.components.redesign

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoRadius

data class FilterChipSpec(val key: String, val label: String, val count: Int? = null)

@Composable
fun FilterChips(options: List<FilterChipSpec>, selectedKey: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { option ->
            val isSelected = option.key == selectedKey
            val label = if (option.count != null) "${option.label} · ${option.count}" else option.label
            Text(
                label,
                color = if (isSelected) Color.White else IdentoColors.TextSecondary,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .background(if (isSelected) IdentoColors.Brand else IdentoColors.Surface, RoundedCornerShape(IdentoRadius.pill))
                    .clickable { onSelect(option.key) }
                    .padding(horizontal = 14.dp, vertical = 8.dp)
            )
        }
    }
}
