package com.idento.presentation.server

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.idento.data.localization.StringKey
import com.idento.data.localization.stringResource
import com.idento.data.network.ServerUrlInvalidReason
import com.idento.presentation.components.AppIcons
import org.koin.compose.koinInject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ServerUrlScreen(
    viewModel: ServerUrlViewModel = koinInject(),
    onNavigateBack: () -> Unit = {},
    onSaved: () -> Unit = {},
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        stringResource(StringKey.SERVER_URL_TITLE),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(AppIcons.AutoMirrored.ArrowBack, contentDescription = stringResource(StringKey.BACK))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                stringResource(StringKey.SERVER_URL_DESC),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            OutlinedTextField(
                value = uiState.url,
                onValueChange = viewModel::onUrlChanged,
                label = { Text(stringResource(StringKey.SERVER_URL_TITLE)) },
                placeholder = { Text(stringResource(StringKey.SERVER_URL_PLACEHOLDER)) },
                singleLine = true,
                isError = uiState.validationError != null,
                modifier = Modifier.fillMaxWidth(),
            )

            uiState.validationError?.let { error ->
                Text(
                    text = when (error) {
                        ServerUrlInvalidReason.MALFORMED -> stringResource(StringKey.SERVER_URL_ERROR_MALFORMED)
                        ServerUrlInvalidReason.HTTP_REQUIRES_PRIVATE_HOST ->
                            stringResource(StringKey.SERVER_URL_ERROR_HTTP_REQUIRES_PRIVATE_HOST)
                    },
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }

            when (val state = uiState.connectionCheckState) {
                ConnectionCheckState.Idle -> {}
                ConnectionCheckState.Checking -> {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(stringResource(StringKey.SERVER_URL_CHECKING))
                    }
                }
                is ConnectionCheckState.Success -> {
                    Text(
                        "${stringResource(StringKey.SERVER_URL_CONNECTED)} (${state.mode})",
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                is ConnectionCheckState.Failed -> {
                    Text(
                        "${stringResource(StringKey.SERVER_URL_CONNECTION_FAILED)}: ${state.message}",
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = viewModel::testConnection) {
                    Text(stringResource(StringKey.SERVER_URL_TEST_CONNECTION))
                }
                Button(
                    onClick = { viewModel.save(onSaved = onSaved) },
                    enabled = !uiState.isSaving,
                ) {
                    Text(stringResource(StringKey.SERVER_URL_SAVE))
                }
            }
        }
    }
}
