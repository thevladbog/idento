package com.idento.presentation.qrscanner

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.koin.compose.koinInject

/**
 * QR Scanner Screen (Terminal/Kiosk mode)
 * Full-screen scanner for self-service check-in
 */
@Composable
fun QRScannerScreen(
    eventId: String,
    eventName: String,
    viewModel: QRScannerViewModel = koinInject(),
    onNavigateBack: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    
    LaunchedEffect(eventId) {
        viewModel.setEventId(eventId)
    }
    
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
    ) {
        // Camera preview placeholder
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            // Scan frame
            Box(
                modifier = Modifier
                    .size(280.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .background(Color.White.copy(alpha = 0.1f))
            ) {
                // Corner indicators
                ScanFrame()
            }
            
            // Scanning indicator
            if (!uiState.isProcessing && !uiState.showSuccess && uiState.errorTitle == null) {
                Column(
                    modifier = Modifier
                        .align(Alignment.Center)
                        .padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Icon(
                        Icons.Default.Search,
                        contentDescription = null,
                        modifier = Modifier.size(64.dp),
                        tint = Color.White.copy(alpha = 0.7f)
                    )
                    Text(
                        text = "Position QR code in frame",
                        style = MaterialTheme.typography.titleMedium,
                        color = Color.White,
                        textAlign = TextAlign.Center
                    )
                    Text(
                        text = "Camera access required",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.White.copy(alpha = 0.6f),
                        textAlign = TextAlign.Center
                    )
                }
            }
        }
        
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
                .padding(top = 32.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Back button
            IconButton(
                onClick = onNavigateBack,
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(Color.Black.copy(alpha = 0.5f))
            ) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = "Close",
                    tint = Color.White
                )
            }
            
            // Event name
            Text(
                text = eventName,
                style = MaterialTheme.typography.titleMedium,
                color = Color.White,
                fontWeight = FontWeight.Bold
            )
            
            // Placeholder for symmetry
            Spacer(modifier = Modifier.size(48.dp))
        }
        
        // Processing overlay
        AnimatedVisibility(
            visible = uiState.isProcessing,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.Center)
        ) {
            Box(
                modifier = Modifier
                    .size(200.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .background(Color.Black.copy(alpha = 0.8f)),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    CircularProgressIndicator(
                        color = Color.White,
                        modifier = Modifier.size(48.dp)
                    )
                    Text(
                        text = "Processing...",
                        style = MaterialTheme.typography.bodyLarge,
                        color = Color.White
                    )
                }
            }
        }
        
        // Success overlay
        AnimatedVisibility(
            visible = uiState.showSuccess,
            enter = fadeIn() + scaleIn(),
            exit = fadeOut() + scaleOut(),
            modifier = Modifier.align(Alignment.Center)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(32.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .background(Color(0xFF4CAF50)),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    modifier = Modifier.padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Icon(
                        Icons.Default.CheckCircle,
                        contentDescription = null,
                        modifier = Modifier.size(80.dp),
                        tint = Color.White
                    )
                    Text(
                        text = "Welcome!",
                        style = MaterialTheme.typography.headlineMedium,
                        color = Color.White,
                        fontWeight = FontWeight.Bold
                    )
                    uiState.successAttendee?.let { attendee ->
                        Text(
                            text = attendee.fullName,
                            style = MaterialTheme.typography.headlineSmall,
                            color = Color.White.copy(alpha = 0.9f),
                            textAlign = TextAlign.Center
                        )
                        attendee.company?.let { company ->
                            Text(
                                text = company,
                                style = MaterialTheme.typography.bodyLarge,
                                color = Color.White.copy(alpha = 0.8f)
                            )
                        }
                    }
                }
            }
        }
        
        // Error overlay
        AnimatedVisibility(
            visible = uiState.errorTitle != null,
            enter = fadeIn() + scaleIn(),
            exit = fadeOut() + scaleOut(),
            modifier = Modifier.align(Alignment.Center)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(32.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .background(MaterialTheme.colorScheme.error),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    modifier = Modifier.padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Icon(
                        Icons.Default.Warning,
                        contentDescription = null,
                        modifier = Modifier.size(64.dp),
                        tint = Color.White
                    )
                    Text(
                        text = uiState.errorTitle ?: "Error",
                        style = MaterialTheme.typography.headlineSmall,
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center
                    )
                    uiState.errorMessage?.let { message ->
                        Text(
                            text = message,
                            style = MaterialTheme.typography.bodyLarge,
                            color = Color.White.copy(alpha = 0.9f),
                            textAlign = TextAlign.Center
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = { viewModel.clearScreen() },
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = Color.White
                        )
                    ) {
                        Text("Tap to continue")
                    }
                }
            }
        }
        
        // Manual input button at bottom
        if (!uiState.isProcessing && !uiState.showSuccess && uiState.errorTitle == null) {
            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text(
                    text = "Scan QR code or enter code manually",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.White.copy(alpha = 0.6f)
                )
                
                // Demo button - simulate scan
                Button(
                    onClick = {
                        // Simulate scanning a code
                        viewModel.onQRScanned("DEMO-001")
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color.White.copy(alpha = 0.2f)
                    ),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(Icons.Default.Edit, contentDescription = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Test Scan (Demo)")
                }
            }
        }
    }
}

@Composable
private fun ScanFrame() {
    Box(modifier = Modifier.fillMaxSize()) {
        // Top-left corner
        Box(
            modifier = Modifier
                .align(Alignment.TopStart)
                .size(40.dp)
                .padding(8.dp)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(4.dp)
                    .background(Color.White, RoundedCornerShape(2.dp))
            )
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .width(4.dp)
                    .background(Color.White, RoundedCornerShape(2.dp))
            )
        }
        
        // Top-right corner
        Box(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .size(40.dp)
                .padding(8.dp)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(4.dp)
                    .align(Alignment.TopEnd)
                    .background(Color.White, RoundedCornerShape(2.dp))
            )
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .width(4.dp)
                    .align(Alignment.TopEnd)
                    .background(Color.White, RoundedCornerShape(2.dp))
            )
        }
        
        // Bottom-left corner
        Box(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .size(40.dp)
                .padding(8.dp)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(4.dp)
                    .align(Alignment.BottomStart)
                    .background(Color.White, RoundedCornerShape(2.dp))
            )
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .width(4.dp)
                    .align(Alignment.BottomStart)
                    .background(Color.White, RoundedCornerShape(2.dp))
            )
        }
        
        // Bottom-right corner
        Box(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .size(40.dp)
                .padding(8.dp)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(4.dp)
                    .align(Alignment.BottomEnd)
                    .background(Color.White, RoundedCornerShape(2.dp))
            )
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .width(4.dp)
                    .align(Alignment.BottomEnd)
                    .background(Color.White, RoundedCornerShape(2.dp))
            )
        }
    }
}
