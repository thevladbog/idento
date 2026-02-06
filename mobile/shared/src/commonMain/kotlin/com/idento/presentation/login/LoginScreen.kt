package com.idento.presentation.login

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.data.localization.StringKey
import com.idento.data.localization.stringResource
import com.idento.presentation.components.IdentoAppIcon
import com.idento.presentation.components.IdentoGreen
import com.idento.presentation.components.IdentoTextField
import org.koin.compose.koinInject

/**
 * Login mode enum
 */
private enum class LoginMode {
    SELECTOR,    // Initial screen with two buttons
    EMAIL,       // Email/password login form
    QR_CODE      // QR code scanner
}

/**
 * Login Screen (Cross-platform Compose Multiplatform)
 * Modern, minimal iOS-inspired design with animated transitions
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoginScreen(
    viewModel: LoginViewModel = koinInject(),
    onLoginSuccess: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    var passwordVisible by remember { mutableStateOf(false) }
    var loginMode by remember { mutableStateOf(LoginMode.SELECTOR) }
    val focusManager = LocalFocusManager.current
    
    // Animate header height based on mode
    val headerHeight by animateDpAsState(
        targetValue = when (loginMode) {
            LoginMode.SELECTOR -> 400.dp  // Large header for selector
            LoginMode.EMAIL -> 160.dp     // Compact header for form
            LoginMode.QR_CODE -> 160.dp
        },
        animationSpec = tween(durationMillis = 400, easing = FastOutSlowInEasing),
        label = "headerHeight"
    )
    
    // Navigate on successful login
    LaunchedEffect(uiState.isLoggedIn) {
        if (uiState.isLoggedIn) {
            onLoginSuccess()
        }
    }
    
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        Column(
            modifier = Modifier.fillMaxSize()
        ) {
            // Animated Header with branding
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(headerHeight)
                    .background(
                        brush = Brush.verticalGradient(
                            colors = listOf(
                                IdentoGreen,
                                IdentoGreen.copy(alpha = 0.9f)
                            )
                        )
                    )
            ) {
                // Safe area padding at top
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .statusBarsPadding()
                        .padding(top = 16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    // Back button (only in form/QR mode)
                    AnimatedVisibility(
                        visible = loginMode != LoginMode.SELECTOR,
                        enter = fadeIn() + slideInVertically(),
                        exit = fadeOut() + slideOutVertically()
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 8.dp),
                            horizontalArrangement = Arrangement.Start
                        ) {
                            IconButton(
                                onClick = { 
                                    focusManager.clearFocus()
                                    loginMode = LoginMode.SELECTOR 
                                }
                            ) {
                                Icon(
                                    Icons.AutoMirrored.Filled.ArrowBack,
                                    contentDescription = "Back",
                                    tint = Color.White
                                )
                            }
                        }
                    }
                    
                    // Logo and title - centered
                    Box(
                        modifier = Modifier.weight(1f),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center
                        ) {
                            // App Icon - size depends on mode
                            val iconSize by animateDpAsState(
                                targetValue = if (loginMode == LoginMode.SELECTOR) 100.dp else 60.dp,
                                animationSpec = tween(300),
                                label = "iconSize"
                            )
                            
                            IdentoAppIcon(
                                size = iconSize,
                                cornerRadius = (iconSize.value * 0.22f).dp,
                                showFullName = false
                            )
                            
                            Spacer(modifier = Modifier.height(12.dp))
                            
                            Text(
                                text = "Idento",
                                style = MaterialTheme.typography.headlineMedium,
                                fontWeight = FontWeight.Bold,
                                color = Color.White,
                                fontSize = if (loginMode == LoginMode.SELECTOR) 36.sp else 24.sp
                            )
                            
                            // Subtitle only in selector mode
                            AnimatedVisibility(
                                visible = loginMode == LoginMode.SELECTOR,
                                enter = fadeIn() + expandVertically(),
                                exit = fadeOut() + shrinkVertically()
                            ) {
                                Column(
                                    horizontalAlignment = Alignment.CenterHorizontally
                                ) {
                                    Spacer(modifier = Modifier.height(8.dp))
                                    Text(
                                        text = "Event Check-in System",
                                        style = MaterialTheme.typography.bodyLarge,
                                        color = Color.White.copy(alpha = 0.9f)
                                    )
                                }
                            }
                        }
                    }
                }
            }
            
            // Content area
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            ) {
                when (loginMode) {
                    LoginMode.SELECTOR -> {
                        // Selector buttons
                        SelectorContent(
                            onEmailLogin = { loginMode = LoginMode.EMAIL },
                            onQRLogin = { loginMode = LoginMode.QR_CODE }
                        )
                    }
                    LoginMode.EMAIL -> {
                        // Email/Password form
                        EmailLoginContent(
                            uiState = uiState,
                            passwordVisible = passwordVisible,
                            onPasswordVisibleChange = { passwordVisible = it },
                            onEmailChange = viewModel::onEmailChanged,
                            onPasswordChange = viewModel::onPasswordChanged,
                            onLogin = { viewModel.login() }
                        )
                    }
                    LoginMode.QR_CODE -> {
                        // QR Code scanner placeholder
                        QRLoginContent(
                            onScanResult = { qrCode ->
                                viewModel.loginWithQR(qrCode)
                            }
                        )
                    }
                }
            }
        }
    }
}

/**
 * Selector content - initial screen with two buttons
 */
@Composable
private fun SelectorContent(
    onEmailLogin: () -> Unit,
    onQRLogin: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Bottom
    ) {
        // Email/Password button
        Button(
            onClick = onEmailLogin,
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primary
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp)
        ) {
            Text(
                text = stringResource(StringKey.SIGN_IN_WITH_EMAIL),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
        }
        
        Spacer(modifier = Modifier.height(12.dp))
        
        // QR Code button
        OutlinedButton(
            onClick = onQRLogin,
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.outlinedButtonColors(
                contentColor = MaterialTheme.colorScheme.primary
            ),
            border = ButtonDefaults.outlinedButtonBorder(enabled = true),
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp)
        ) {
            Text(
                text = stringResource(StringKey.SIGN_IN_WITH_QR),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Medium
            )
        }
        
        Spacer(modifier = Modifier.height(48.dp))
    }
}

/**
 * Email login form content
 */
@Composable
private fun EmailLoginContent(
    uiState: LoginUiState,
    passwordVisible: Boolean,
    onPasswordVisibleChange: (Boolean) -> Unit,
    onEmailChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onLogin: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp)
            .imePadding(),  // Important: adds padding when keyboard appears
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(modifier = Modifier.height(16.dp))
        
        Text(
            text = "Welcome back",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground
        )
        
        Spacer(modifier = Modifier.height(4.dp))
        
        Text(
            text = stringResource(StringKey.LOGIN),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        
        Spacer(modifier = Modifier.height(32.dp))
        
        // Email Field
        IdentoTextField(
            value = uiState.email,
            onValueChange = onEmailChange,
            label = stringResource(StringKey.EMAIL),
            placeholder = "your@email.com",
            isError = uiState.emailError != null,
            errorMessage = uiState.emailError,
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Email,
                imeAction = ImeAction.Next
            ),
            modifier = Modifier.fillMaxWidth()
        )
        
        Spacer(modifier = Modifier.height(16.dp))
        
        // Password Field
        IdentoTextField(
            value = uiState.password,
            onValueChange = onPasswordChange,
            label = stringResource(StringKey.PASSWORD),
            placeholder = "",
            isError = uiState.passwordError != null,
            errorMessage = uiState.passwordError,
            visualTransformation = if (passwordVisible) 
                VisualTransformation.None 
            else 
                PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Password,
                imeAction = ImeAction.Done
            ),
            keyboardActions = KeyboardActions(
                onDone = { onLogin() }
            ),
            trailingIcon = {
                TextButton(
                    onClick = { onPasswordVisibleChange(!passwordVisible) },
                    contentPadding = PaddingValues(0.dp),
                    modifier = Modifier.height(24.dp)
                ) {
                    Text(
                        text = if (passwordVisible) "Hide" else "Show",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            },
            modifier = Modifier.fillMaxWidth()
        )
        
        // Error Message
        AnimatedVisibility(
            visible = uiState.error != null,
            enter = fadeIn() + expandVertically(),
            exit = fadeOut() + shrinkVertically()
        ) {
            Column {
                Spacer(modifier = Modifier.height(16.dp))
                
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.5f),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = uiState.error ?: "",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(16.dp),
                        textAlign = TextAlign.Center
                    )
                }
            }
        }
        
        Spacer(modifier = Modifier.height(32.dp))
        
        // Login Button
        Button(
            onClick = onLogin,
            enabled = !uiState.isLoading,
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                disabledContainerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.5f)
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
        ) {
            if (uiState.isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(22.dp),
                    color = MaterialTheme.colorScheme.onPrimary,
                    strokeWidth = 2.dp
                )
            } else {
                Text(
                    text = stringResource(StringKey.SIGN_IN),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }
        
        // Spacer to push content up from keyboard
        Spacer(modifier = Modifier.height(24.dp))
    }
}

/**
 * QR Code login content
 */
@Composable
private fun QRLoginContent(
    onScanResult: (String) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        // Placeholder for QR scanner
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(1f),
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surfaceVariant
        ) {
            Box(
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = "📷",
                        fontSize = 64.sp
                    )
                    
                    Spacer(modifier = Modifier.height(16.dp))
                    
                    Text(
                        text = "Point camera at QR code",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    
                    Spacer(modifier = Modifier.height(8.dp))
                    
                    Text(
                        text = "Scan QR code from admin panel",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                    )
                }
            }
        }
        
        Spacer(modifier = Modifier.height(24.dp))
        
        Text(
            text = "Camera access required",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}
