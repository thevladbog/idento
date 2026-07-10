package com.idento.presentation.components.redesign

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.presentation.theme.IdentoColors

/** Key/value detail grid used in verdict screens (Категория, Компания, Время, Печать, etc). */
@Composable
fun DetailTable(rows: List<Pair<String, String>>, labelWidth: Dp = 110.dp, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        rows.forEach { (label, value) ->
            Row(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Text(label, color = IdentoColors.TextMuted, fontSize = 13.sp, modifier = Modifier.width(labelWidth))
                Text(value, color = IdentoColors.TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}
