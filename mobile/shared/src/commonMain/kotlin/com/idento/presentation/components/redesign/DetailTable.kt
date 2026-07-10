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

/** Key/value detail grid used in verdict screens (Category, Company, Time, Stamp, etc). */
@Composable
fun DetailTable(rows: List<DetailRow>, labelWidth: Dp = 110.dp, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        rows.forEach { row ->
            Row(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Text(row.label, color = IdentoColors.TextMuted, fontSize = 13.sp, modifier = Modifier.width(labelWidth))
                Text(row.value, color = IdentoColors.TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}

data class DetailRow(val label: String, val value: String)
