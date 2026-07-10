package com.idento.presentation.components.redesign

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoRadius

data class ActionButtonSpec(
    val label: String,
    val onClick: () -> Unit,
    val containerColor: Color = IdentoColors.Brand,
    val contentColor: Color = Color.White,
)

/** Bottom-pinned primary (56dp) + optional secondary outline (48dp) action buttons. */
@Composable
fun ActionStack(primary: ActionButtonSpec, secondary: ActionButtonSpec? = null, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Button(
            onClick = primary.onClick,
            modifier = Modifier.fillMaxWidth().height(56.dp),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(IdentoRadius.buttonPrimary),
            colors = ButtonDefaults.buttonColors(containerColor = primary.containerColor, contentColor = primary.contentColor)
        ) {
            Text(primary.label, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
        }
        if (secondary != null) {
            OutlinedButton(
                onClick = secondary.onClick,
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = androidx.compose.foundation.shape.RoundedCornerShape(IdentoRadius.buttonSecondary),
                border = BorderStroke(1.dp, IdentoColors.Border),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = IdentoColors.ButtonLabel)
            ) {
                Text(secondary.label)
            }
        }
    }
}
