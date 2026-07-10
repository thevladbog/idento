package com.idento.presentation.components.redesign

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.data.localization.StringKey
import com.idento.data.localization.stringResource
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoRadius

@Composable
fun OfflineBanner(queuedCount: Int, lastSyncLabel: String, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(IdentoColors.AmberTintDark, RoundedCornerShape(12.dp))
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(modifier = Modifier.size(8.dp).background(IdentoColors.Queue, CircleShape))
        Spacer(modifier = Modifier.width(10.dp))
        Column {
            Text(
                stringResource(StringKey.OFFLINE_QUEUED_TEMPLATE).replace("{count}", queuedCount.toString()),
                color = IdentoColors.AmberText, fontSize = 12.sp, fontWeight = FontWeight.Medium
            )
            Text(
                stringResource(StringKey.OFFLINE_LAST_SYNC_TEMPLATE).replace("{time}", lastSyncLabel),
                color = IdentoColors.TextMuted, fontSize = 11.sp
            )
        }
    }
}

@Composable
fun IdentoToggle(checked: Boolean, onCheckedChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        modifier = modifier,
        colors = SwitchDefaults.colors(
            checkedTrackColor = IdentoColors.Brand,
            checkedThumbColor = Color.White,
            uncheckedTrackColor = IdentoColors.Border,
            uncheckedThumbColor = IdentoColors.TextSecondary,
        )
    )
}

@Composable
fun SelectableCard(selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(
        modifier = modifier
            .background(if (selected) IdentoColors.GreenTint else IdentoColors.Surface, RoundedCornerShape(IdentoRadius.card))
            .border(
                if (selected) 2.dp else 1.dp,
                if (selected) IdentoColors.Brand else IdentoColors.Border,
                RoundedCornerShape(IdentoRadius.card)
            )
            .clickable(onClick = onClick)
            .padding(16.dp)
    ) {
        content()
    }
}
