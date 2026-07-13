package com.idento.presentation.server

import com.idento.data.network.ServerUrlInvalidReason
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * UnconfinedTestDispatcher (not StandardTestDispatcher) — matches this codebase's established
 * ViewModel-test convention (see SetupLoginViewModelTest.kt): it runs launched coroutines
 * eagerly up to their first suspension point, so assertions immediately after calling a
 * ViewModel method already see the settled state inside the same `runTest(testDispatcher)`
 * block, with no separate "advance the dispatcher" call needed.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ServerUrlViewModelTest {

    private val testDispatcher = UnconfinedTestDispatcher()

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel(
        currentUrl: String? = null,
        connectionCheck: suspend (String) -> Result<String> = { Result.success("onprem") },
        savedUrls: MutableList<String> = mutableListOf(),
        cleared: MutableList<Unit> = mutableListOf(),
    ) = ServerUrlViewModel(
        currentUrlProvider = { currentUrl },
        connectionChecker = ServerConnectionChecker(connectionCheck),
        onSave = ServerUrlSaveGateway(
            save = { url -> savedUrls.add(url) },
            clearSession = { cleared.add(Unit) },
        ),
    )

    @Test
    fun initialUrl_prefillsFromCurrentUrlProvider() {
        val vm = viewModel(currentUrl = "http://192.168.1.10:8008")
        assertEquals("http://192.168.1.10:8008", vm.uiState.value.url)
    }

    @Test
    fun onUrlChanged_clearsPriorValidationError() = runTest(testDispatcher) {
        val vm = viewModel()
        vm.onUrlChanged("http://api.idento.app") // http + public host -> invalid
        vm.testConnection()
        assertTrue(vm.uiState.value.validationError != null)

        vm.onUrlChanged("https://api.idento.app")
        assertNull(vm.uiState.value.validationError)
    }

    @Test
    fun testConnection_withInvalidUrl_setsValidationErrorAndDoesNotCallChecker() = runTest(testDispatcher) {
        var called = false
        val vm = viewModel(connectionCheck = { called = true; Result.success("saas") })
        vm.onUrlChanged("http://api.idento.app")
        vm.testConnection()
        assertEquals(ServerUrlInvalidReason.HTTP_REQUIRES_PRIVATE_HOST, vm.uiState.value.validationError)
        assertTrue(!called)
    }

    @Test
    fun testConnection_success_setsConnectedMode() = runTest(testDispatcher) {
        val vm = viewModel(connectionCheck = { Result.success("onprem") })
        vm.onUrlChanged("http://192.168.1.10:8008")
        vm.testConnection()
        assertEquals(ConnectionCheckState.Success("onprem"), vm.uiState.value.connectionCheckState)
    }

    @Test
    fun testConnection_failure_setsFailedState() = runTest(testDispatcher) {
        val vm = viewModel(connectionCheck = { Result.failure(RuntimeException("timeout")) })
        vm.onUrlChanged("http://192.168.1.10:8008")
        vm.testConnection()
        assertTrue(vm.uiState.value.connectionCheckState is ConnectionCheckState.Failed)
    }

    @Test
    fun save_withInvalidUrl_doesNotCallSaveOrClear() = runTest(testDispatcher) {
        val saved = mutableListOf<String>()
        val cleared = mutableListOf<Unit>()
        val vm = viewModel(savedUrls = saved, cleared = cleared)
        vm.onUrlChanged("not a url")
        vm.save()
        assertTrue(saved.isEmpty())
        assertTrue(cleared.isEmpty())
    }

    @Test
    fun save_withValidUrl_savesAndClearsSessionAndFiresOnSaved() = runTest(testDispatcher) {
        val saved = mutableListOf<String>()
        val cleared = mutableListOf<Unit>()
        var savedFired = false
        val vm = viewModel(savedUrls = saved, cleared = cleared)
        vm.onUrlChanged("http://192.168.1.10:8008")
        vm.save { savedFired = true }
        assertEquals(listOf("http://192.168.1.10:8008"), saved)
        assertEquals(1, cleared.size)
        assertTrue(savedFired)
    }
}
