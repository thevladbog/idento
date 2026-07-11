package com.idento.presentation.components.redesign

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.idento.data.localization.StringKey
import com.idento.data.localization.stringResource
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoRadius
import com.idento.presentation.theme.IdentoSpacing

/**
 * Screen 3b — shown instead of the camera preview when a hardware/BT scanner is connected
 * ([com.idento.platform.scanner.ScannerConnectionState.HardwareConnected]). Shared by
 * RegistrationHomeScreen and ZoneControlScreen — both consume the same ScanSource abstraction.
 */
@Composable
fun ScannerStatusIndicator(
    label: String,
    onSwitchToCamera: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.fillMaxSize().background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                modifier = Modifier
                    .background(IdentoColors.GreenTint, RoundedCornerShape(IdentoRadius.pill))
                    .padding(horizontal = IdentoSpacing.md, vertical = IdentoSpacing.sm),
            ) {
                Text(
                    text = "$label · ${stringResource(StringKey.SCANNER_CONNECTED_SUFFIX)}",
                    color = IdentoColors.Indicator,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                )
            }
            Spacer(Modifier.height(IdentoSpacing.lg))
            Button(
                onClick = onSwitchToCamera,
                colors = ButtonDefaults.buttonColors(
                    containerColor = IdentoColors.Surface,
                    contentColor = IdentoColors.TextPrimary,
                ),
            ) {
                Text(stringResource(StringKey.SCANNER_SWITCH_TO_CAMERA))
            }
        }
    }
}
