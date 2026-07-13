package com.idento.presentation.server

import com.idento.data.network.ServerUrlInvalidReason
import kotlinx.coroutines.CompletableDeferred
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
        resetCount: MutableList<Unit> = mutableListOf(),
        events: MutableList<String>? = null,
    ) = ServerUrlViewModel(
        currentUrlProvider = { currentUrl },
        connectionChecker = ServerConnectionChecker(connectionCheck),
        onSave = ServerUrlSaveGateway(
            save = { url -> savedUrls.add(url); events?.add("save") },
            clearSession = { cleared.add(Unit); events?.add("clear") },
            resetToDefault = { resetCount.add(Unit); events?.add("reset") },
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

    @Test
    fun save_trimsUrlBeforePersistingAndUpdatingState() = runTest(testDispatcher) {
        val saved = mutableListOf<String>()
        val vm = viewModel(savedUrls = saved)
        vm.onUrlChanged("  http://192.168.1.10:8008  ")
        vm.save()
        assertEquals(listOf("http://192.168.1.10:8008"), saved)
        assertEquals("http://192.168.1.10:8008", vm.uiState.value.url)
    }

    @Test
    fun save_clearsSessionBeforeSaving() = runTest(testDispatcher) {
        val events = mutableListOf<String>()
        val vm = viewModel(events = events)
        vm.onUrlChanged("http://192.168.1.10:8008")
        vm.save()
        // A leaked bearer token to the new host is the failure mode if this order ever flips —
        // see ServerUrlSaveGateway.saveAndClearSession's doc.
        assertEquals(listOf("clear", "save"), events)
    }

    @Test
    fun testConnection_ignoresStaleResultIfUrlChangedMidFlight() = runTest(testDispatcher) {
        lateinit var vm: ServerUrlViewModel
        vm = viewModel(connectionCheck = { _ ->
            // Simulate the operator editing the field while this probe is still in flight.
            vm.onUrlChanged("http://10.0.0.5:8008")
            Result.success("onprem")
        })
        vm.onUrlChanged("http://192.168.1.10:8008")
        vm.testConnection()
        // The stale result for the original URL must not be applied — onUrlChanged already reset
        // this to Idle for the freshly typed URL, which was never actually checked.
        assertEquals(ConnectionCheckState.Idle, vm.uiState.value.connectionCheckState)
        assertEquals("http://10.0.0.5:8008", vm.uiState.value.url)
    }

    @Test
    fun testConnection_ignoresStaleResultAfterAbaEditSequenceToSameUrl() = runTest(testDispatcher) {
        // A URL-string comparison alone can't catch this: after A -> B -> A, the field is back to
        // the exact same string the first (now-stale) probe was launched for, so a "does the URL
        // still match" check would wrongly accept its result. Only a generation counter (bumped
        // by every onUrlChanged/testConnection call) tells the two probes apart.
        val firstProbeStarted = CompletableDeferred<Unit>()
        val releaseFirstProbe = CompletableDeferred<Result<String>>()
        var callCount = 0
        val vm = viewModel(connectionCheck = { _ ->
            callCount++
            if (callCount == 1) {
                firstProbeStarted.complete(Unit)
                releaseFirstProbe.await()
            } else {
                Result.success("second")
            }
        })

        vm.onUrlChanged("http://192.168.1.10:8008") // A
        vm.testConnection() // probe 1 for "A" — parks awaiting release
        assertTrue(firstProbeStarted.isCompleted)

        vm.onUrlChanged("http://10.0.0.5:8008") // B
        vm.onUrlChanged("http://192.168.1.10:8008") // back to A
        vm.testConnection() // probe 2 for "A" — resolves immediately with "second"

        assertEquals(ConnectionCheckState.Success("second"), vm.uiState.value.connectionCheckState)

        // Probe 1 (genuinely stale, same URL string as probe 2) must not overwrite probe 2's result.
        releaseFirstProbe.complete(Result.success("first-stale"))
        assertEquals(ConnectionCheckState.Success("second"), vm.uiState.value.connectionCheckState)
    }

    @Test
    fun resetToDefault_clearsUrlAndSessionAndFiresOnSaved() = runTest(testDispatcher) {
        val cleared = mutableListOf<Unit>()
        val resetCount = mutableListOf<Unit>()
        var savedFired = false
        val vm = viewModel(currentUrl = "http://192.168.1.10:8008", cleared = cleared, resetCount = resetCount)
        vm.resetToDefault { savedFired = true }
        assertEquals("", vm.uiState.value.url)
        assertEquals(1, cleared.size)
        assertEquals(1, resetCount.size)
        assertTrue(savedFired)
    }
}
