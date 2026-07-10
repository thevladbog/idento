package com.idento.presentation.components.redesign

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.presentation.theme.IdentoColors

data class StatusCell(val value: String, val label: String, val valueColor: Color = IdentoColors.TextPrimary)

/**
 * 4-column KPI status bar (e.g. ЗОНА / ПРИНТЕР / ОЧЕРЕДЬ / ОТМЕЧЕНО for registration mode,
 * or ЗОНА / ДОПУЩЕНО / ОТКАЗОВ / ОЧЕРЕДЬ for zone-control mode). Composition (which 4 cells)
 * is the caller's job — this is a pure layout component.
 */
@Composable
fun StatusBar(cells: List<StatusCell>, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceEvenly
    ) {
        cells.forEachIndexed { index, cell ->
            Column(
                modifier = Modifier.weight(1f),
                horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally
            ) {
                Text(cell.value, color = cell.valueColor, fontSize = 20.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                Text(cell.label.uppercase(), color = IdentoColors.TextMuted, fontSize = 9.5.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            }
            if (index != cells.lastIndex) {
                Box(modifier = Modifier.width(1.dp).height(28.dp).background(IdentoColors.Hairline))
            }
        }
    }
}
