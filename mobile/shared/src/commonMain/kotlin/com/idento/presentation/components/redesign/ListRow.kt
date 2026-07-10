package com.idento.presentation.components.redesign

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.presentation.theme.IdentoColors

/** Avatar-initials + title + subtitle + optional trailing status-chip slot, for search/list screens. */
@Composable
fun ListRow(
    initials: String,
    title: String,
    subtitle: String,
    statusChip: (@Composable () -> Unit)? = null,
    highlighted: Boolean = false,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(if (highlighted) IdentoColors.GreenTint else IdentoColors.Surface)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(40.dp).background(if (highlighted) IdentoColors.Brand else IdentoColors.Border, CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Text(initials, color = androidx.compose.ui.graphics.Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, color = IdentoColors.TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 1)
            Text(subtitle, color = IdentoColors.TextSecondary, fontSize = 12.sp, maxLines = 1)
        }
        if (statusChip != null) {
            statusChip()
        }
    }
}
