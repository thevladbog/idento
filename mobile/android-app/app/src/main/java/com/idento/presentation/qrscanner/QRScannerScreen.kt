package com.idento.presentation.qrscanner

import android.Manifest
import android.util.Log
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.accompanist.permissions.*
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

@OptIn(ExperimentalMaterial3Api::class, ExperimentalPermissionsApi::class)
@Composable
fun QRScannerScreen(
    viewModel: QRScannerViewModel,
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val cameraPermissionState = rememberPermissionState(Manifest.permission.CAMERA)
    
    LaunchedEffect(Unit) {
        if (!cameraPermissionState.status.isGranted) {
            cameraPermissionState.launchPermissionRequest()
        }
    }
    
    // Автоматический возврат к сканированию после успеха
    LaunchedEffect(uiState.checkedInAttendee) {
        if (uiState.checkedInAttendee != null) {
            kotlinx.coroutines.delay(5000) // 5 секунд показываем результат
            viewModel.resetToScanning()
        }
    }
    
    Box(modifier = Modifier.fillMaxSize()) {
        when {
            // Показываем успешный check-in полноэкранно
            uiState.checkedInAttendee != null -> {
                SuccessScreen(
                    attendee = uiState.checkedInAttendee!!,
                    displayTemplate = uiState.displayTemplate,
                    onDismiss = { viewModel.resetToScanning() }
                )
            }
            
            // Основной экран сканирования
            cameraPermissionState.status.isGranted || uiState.useHardwareScanner -> {
                ScanningScreen(
                    uiState = uiState,
                    viewModel = viewModel,
                    onQRCodeScanned = { code ->
                        if (uiState.scanEnabled) {
                            viewModel.onQRCodeScanned(code)
                        }
                    },
                    onNavigateBack = onNavigateBack,
                    showCamera = cameraPermissionState.status.isGranted
                )
            }
            
            // Запрос разрешения камеры
            else -> {
                PermissionRequestScreen(
                    shouldShowRationale = cameraPermissionState.status.shouldShowRationale,
                    onRequestPermission = { cameraPermissionState.launchPermissionRequest() },
                    onNavigateBack = onNavigateBack
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ScanningScreen(
    uiState: QRScannerUiState,
    viewModel: QRScannerViewModel,
    onQRCodeScanned: (String) -> Unit,
    onNavigateBack: () -> Unit,
    showCamera: Boolean
) {
    // Регистрируем hardware scanner receiver при входе на экран если используется
    LaunchedEffect(uiState.useHardwareScanner, uiState.isHardwareScannerAvailable) {
        if (uiState.useHardwareScanner && uiState.isHardwareScannerAvailable) {
            // Регистрация происходит в ViewModel через toggleScannerMode или при инициализации
        }
    }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            "Self Check-in",
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = uiState.eventName,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                },
                actions = {
                    // Переключатель режима сканирования если доступен hardware scanner
                    if (uiState.isHardwareScannerAvailable) {
                        IconButton(onClick = { viewModel.toggleScannerMode() }) {
                            Icon(
                                imageVector = if (uiState.useHardwareScanner) 
                                    Icons.Default.QrCodeScanner 
                                else 
                                    Icons.Default.CameraAlt,
                                contentDescription = "Toggle Scanner"
                            )
                        }
                    }
                }
            )
        },
        floatingActionButton = {
            // Кнопка триггера для hardware scanner
            if (uiState.useHardwareScanner && uiState.isHardwareScannerAvailable) {
                FloatingActionButton(
                    onClick = { viewModel.triggerHardwareScan() },
                    containerColor = MaterialTheme.colorScheme.primary
                ) {
                    Icon(
                        imageVector = Icons.Default.QrCodeScanner,
                        contentDescription = "Trigger Scan"
                    )
                }
            }
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .background(MaterialTheme.colorScheme.background),
            contentAlignment = Alignment.Center
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
                modifier = Modifier.fillMaxSize()
            ) {
                // Информация о hardware scanner если используется
                if (uiState.useHardwareScanner && uiState.isHardwareScannerAvailable) {
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.primaryContainer
                        )
                    ) {
                        Row(
                            modifier = Modifier.padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Default.QrCodeScanner,
                                contentDescription = null,
                                modifier = Modifier.size(48.dp),
                                tint = MaterialTheme.colorScheme.primary
                            )
                            Spacer(modifier = Modifier.width(16.dp))
                            Column {
                                Text(
                                    text = "Hardware Scanner Active",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    text = uiState.hardwareScannerName ?: "Unknown Scanner",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Text(
                                    text = "Press scan button on device",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                    
                    Spacer(modifier = Modifier.height(32.dp))
                }
                
                // Инструкция
                Text(
                    text = if (uiState.useHardwareScanner) 
                        "Scan QR code with hardware scanner" 
                    else 
                        "Show your QR code",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center
                )
                
                Spacer(modifier = Modifier.height(32.dp))
                
                // Камера в квадрате (только если не используется hardware scanner)
                if (!uiState.useHardwareScanner && showCamera) {
                    Box(
                        modifier = Modifier
                            .size(400.dp)
                            .clip(RoundedCornerShape(32.dp))
                            .background(Color.Black)
                    ) {
                        CameraPreview(
                            onQRCodeScanned = onQRCodeScanned,
                            modifier = Modifier.fillMaxSize()
                        )
                        
                        // Рамка сканирования
                        ScannerFrame()
                    }
                } else if (uiState.useHardwareScanner) {
                    // Большая иконка сканера для hardware mode
                    Box(
                        modifier = Modifier
                            .size(400.dp)
                            .clip(RoundedCornerShape(32.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.QrCodeScanner,
                            contentDescription = null,
                            modifier = Modifier.size(200.dp),
                            tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.3f)
                        )
                    }
                }
                
                Spacer(modifier = Modifier.height(32.dp))
                
                // Статус
                AnimatedContent(
                    targetState = when {
                        uiState.isProcessing -> "processing"
                        uiState.errorMessage != null -> "error"
                        else -> "ready"
                    },
                    label = "status"
                ) { state ->
                    when (state) {
                        "processing" -> {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(48.dp),
                                    color = MaterialTheme.colorScheme.primary
                                )
                                Spacer(modifier = Modifier.height(16.dp))
                                Text(
                                    text = "Processing...",
                                    style = MaterialTheme.typography.titleLarge
                                )
                            }
                        }
                        
                        "error" -> {
                            Surface(
                                color = MaterialTheme.colorScheme.errorContainer,
                                shape = MaterialTheme.shapes.large,
                                modifier = Modifier.padding(horizontal = 32.dp)
                            ) {
                                Row(
                                    modifier = Modifier.padding(24.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Error,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.error,
                                        modifier = Modifier.size(32.dp)
                                    )
                                    Spacer(modifier = Modifier.width(16.dp))
                                    Text(
                                        text = uiState.errorMessage ?: "Error",
                                        style = MaterialTheme.typography.titleMedium,
                                        color = MaterialTheme.colorScheme.onErrorContainer
                                    )
                                }
                            }
                        }
                        
                        else -> {
                            Row(
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = Icons.Default.QrCodeScanner,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(32.dp)
                                )
                                Spacer(modifier = Modifier.width(12.dp))
                                Text(
                                    text = "Ready to scan",
                                    style = MaterialTheme.typography.titleLarge,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SuccessScreen(
    attendee: com.idento.data.model.Attendee,
    displayTemplate: String?,
    onDismiss: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF4CAF50)), // Зеленый фон
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(48.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            // Иконка успеха
            Icon(
                imageVector = Icons.Default.CheckCircle,
                contentDescription = null,
                tint = Color.White,
                modifier = Modifier.size(120.dp)
            )
            
            Spacer(modifier = Modifier.height(32.dp))
            
            // Заголовок
            Text(
                text = "Welcome!",
                style = MaterialTheme.typography.displayLarge,
                fontWeight = FontWeight.Bold,
                color = Color.White
            )
            
            Spacer(modifier = Modifier.height(48.dp))
            
            // Информация об участнике
            Surface(
                modifier = Modifier
                    .fillMaxWidth(0.8f)
                    .wrapContentHeight(),
                color = Color.White,
                shape = RoundedCornerShape(24.dp)
            ) {
                Column(
                    modifier = Modifier.padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    // Имя
                    Text(
                        text = "${attendee.firstName} ${attendee.lastName}",
                        style = MaterialTheme.typography.headlineLarge,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center
                    )
                    
                    Spacer(modifier = Modifier.height(24.dp))
                    
                    // Кастомный template или дефолтные данные
                    if (!displayTemplate.isNullOrEmpty()) {
                        // Рендерим template как простой текст с заменой переменных
                        Text(
                            text = displayTemplate
                                .replace("{{first_name}}", attendee.firstName)
                                .replace("{{last_name}}", attendee.lastName)
                                .replace("{{email}}", attendee.email)
                                .replace("{{company}}", attendee.company)
                                .replace("{{position}}", attendee.position)
                                // Удаляем Markdown форматирование для простого отображения
                                .replace(Regex("#+ "), "")
                                .replace("**", "")
                                .replace("*", ""),
                            style = MaterialTheme.typography.bodyLarge,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth()
                        )
                    } else {
                        // Дефолтный вид
                        if (attendee.company.isNotEmpty()) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.Center
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Business,
                                    contentDescription = null,
                                    modifier = Modifier.size(20.dp),
                                    tint = MaterialTheme.colorScheme.primary
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = attendee.company,
                                    style = MaterialTheme.typography.titleLarge
                                )
                            }
                            Spacer(modifier = Modifier.height(12.dp))
                        }
                        
                        if (attendee.position.isNotEmpty()) {
                            Text(
                                text = attendee.position,
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Spacer(modifier = Modifier.height(12.dp))
                        }
                        
                        if (attendee.email.isNotEmpty()) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.Center
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Email,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp),
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = attendee.email,
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                    
                    Spacer(modifier = Modifier.height(24.dp))
                    
                    HorizontalDivider()
                    
                    Spacer(modifier = Modifier.height(24.dp))
                    
                    // Checked in статус
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.CheckCircle,
                            contentDescription = null,
                            tint = Color(0xFF4CAF50),
                            modifier = Modifier.size(32.dp)
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Text(
                            text = "Successfully Checked In",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF4CAF50)
                        )
                    }
                }
            }
            
            Spacer(modifier = Modifier.height(32.dp))
            
            // Кнопка продолжить (опционально)
            OutlinedButton(
                onClick = onDismiss,
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = Color.White
                ),
                modifier = Modifier.padding(horizontal = 32.dp)
            ) {
                Text(
                    text = "Continue",
                    style = MaterialTheme.typography.titleMedium
                )
            }
        }
    }
}

@Composable
private fun CameraPreview(
    onQRCodeScanned: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val cameraProviderFuture = remember { ProcessCameraProvider.getInstance(context) }
    val executor = remember { Executors.newSingleThreadExecutor() }
    
    AndroidView(
        factory = { ctx ->
            val previewView = PreviewView(ctx)
            val cameraProvider = cameraProviderFuture.get()
            
            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }
            
            val imageAnalysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also {
                    it.setAnalyzer(executor) { imageProxy ->
                        processImageProxy(imageProxy, onQRCodeScanned)
                    }
                }
            
            val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA
            
            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    lifecycleOwner,
                    cameraSelector,
                    preview,
                    imageAnalysis
                )
            } catch (e: Exception) {
                Log.e("QRScanner", "Camera binding failed", e)
            }
            
            previewView
        },
        modifier = modifier
    )
}

@androidx.annotation.OptIn(ExperimentalGetImage::class)
private fun processImageProxy(
    imageProxy: ImageProxy,
    onQRCodeScanned: (String) -> Unit
) {
    val mediaImage = imageProxy.image
    if (mediaImage != null) {
        val image = InputImage.fromMediaImage(
            mediaImage,
            imageProxy.imageInfo.rotationDegrees
        )
        
        val scanner = BarcodeScanning.getClient()
        scanner.process(image)
            .addOnSuccessListener { barcodes ->
                for (barcode in barcodes) {
                    when (barcode.valueType) {
                        Barcode.TYPE_TEXT,
                        Barcode.TYPE_URL -> {
                            barcode.rawValue?.let { value ->
                                onQRCodeScanned(value)
                            }
                        }
                    }
                }
            }
            .addOnFailureListener { e ->
                Log.e("QRScanner", "Barcode scanning failed", e)
            }
            .addOnCompleteListener {
                imageProxy.close()
            }
    } else {
        imageProxy.close()
    }
}

@Composable
private fun ScannerFrame() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        contentAlignment = Alignment.Center
    ) {
        androidx.compose.foundation.Canvas(modifier = Modifier.fillMaxSize()) {
            val cornerLength = 80f
            val strokeWidth = 12f
            val color = Color.White
            
            // Top-left corner
            drawLine(
                color = color,
                start = androidx.compose.ui.geometry.Offset(0f, 0f),
                end = androidx.compose.ui.geometry.Offset(cornerLength, 0f),
                strokeWidth = strokeWidth
            )
            drawLine(
                color = color,
                start = androidx.compose.ui.geometry.Offset(0f, 0f),
                end = androidx.compose.ui.geometry.Offset(0f, cornerLength),
                strokeWidth = strokeWidth
            )
            
            // Top-right corner
            drawLine(
                color = color,
                start = androidx.compose.ui.geometry.Offset(size.width, 0f),
                end = androidx.compose.ui.geometry.Offset(size.width - cornerLength, 0f),
                strokeWidth = strokeWidth
            )
            drawLine(
                color = color,
                start = androidx.compose.ui.geometry.Offset(size.width, 0f),
                end = androidx.compose.ui.geometry.Offset(size.width, cornerLength),
                strokeWidth = strokeWidth
            )
            
            // Bottom-left corner
            drawLine(
                color = color,
                start = androidx.compose.ui.geometry.Offset(0f, size.height),
                end = androidx.compose.ui.geometry.Offset(cornerLength, size.height),
                strokeWidth = strokeWidth
            )
            drawLine(
                color = color,
                start = androidx.compose.ui.geometry.Offset(0f, size.height),
                end = androidx.compose.ui.geometry.Offset(0f, size.height - cornerLength),
                strokeWidth = strokeWidth
            )
            
            // Bottom-right corner
            drawLine(
                color = color,
                start = androidx.compose.ui.geometry.Offset(size.width, size.height),
                end = androidx.compose.ui.geometry.Offset(size.width - cornerLength, size.height),
                strokeWidth = strokeWidth
            )
            drawLine(
                color = color,
                start = androidx.compose.ui.geometry.Offset(size.width, size.height),
                end = androidx.compose.ui.geometry.Offset(size.width, size.height - cornerLength),
                strokeWidth = strokeWidth
            )
        }
    }
}

@Composable
@OptIn(ExperimentalPermissionsApi::class, ExperimentalMaterial3Api::class)
private fun PermissionRequestScreen(
    shouldShowRationale: Boolean,
    onRequestPermission: () -> Unit,
    onNavigateBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Camera Permission") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Icon(
                imageVector = Icons.Default.Camera,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.height(24.dp))
            Text(
                text = if (shouldShowRationale) "Camera Access Needed" else "Camera Permission Required",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "To scan QR codes for self check-in, we need access to your camera.",
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(32.dp))
            Button(
                onClick = onRequestPermission,
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Default.Camera, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Grant Permission")
            }
        }
    }
}
