package com.idento.presentation.setup

import com.idento.data.model.CreateProvisioningTokenResponseDto
import com.idento.data.model.Event
import com.idento.data.model.ProvisionStationResponseDto
import com.idento.data.model.ProvisionedStationConfigDto
import com.idento.data.network.ApiResult
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
 * `eventLister`/`provisioningTokenMinter`/`stationProvisioner`/`authTokenSaver`/
 * `currentUserIdProvider` are the narrow fun-interface seams `SetupEventViewModel` depends on
 * instead of `EventRepository`/`StationRepository`/`AuthRepository`/`AuthPreferences` directly
 * (see SetupEventViewModel.kt's kdoc) — same rationale as `SetupLoginViewModel`/
 * `SetupLoginViewModelTest`: those repositories are plain classes wrapping platform
 * `expect`/`actual` singletons (Ktor engine, SecureStore, DataStoreFactory) that cannot be
 * constructed or subclassed from commonTest. `StationProvisioner`/`AuthTokenSaver` are reused
 * as-is from `SetupLoginViewModel.kt` (same package, same shape) rather than duplicated.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SetupEventViewModelTest {

    private val testDispatcher = UnconfinedTestDispatcher()

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private class FakeEventLister(private val result: ApiResult<List<Event>>) : EventLister {
        override suspend fun getEvents(): ApiResult<List<Event>> = result
    }

    private class FakeProvisioningTokenMinter(
        private val result: ApiResult<CreateProvisioningTokenResponseDto>,
    ) : ProvisioningTokenMinter {
        override suspend fun createProvisioningToken(eventId: String, staffUserId: String): ApiResult<CreateProvisioningTokenResponseDto> = result
    }

    private class FakeStationProvisioner(private val result: ApiResult<ProvisionStationResponseDto>) : StationProvisioner {
        override suspend fun provisionStation(token: String, deviceInfo: Map<String, String>?): ApiResult<ProvisionStationResponseDto> = result
    }

    private class FakeAuthTokenSaver(private val saved: Boolean = true) : AuthTokenSaver {
        override suspend fun saveAuthToken(token: String): Boolean = saved
    }

    private class FakeCurrentUserIdProvider(private val userId: String?) : CurrentUserIdProvider {
        override suspend fun getUserId(): String? = userId
    }

    private val sampleEvents = listOf(
        Event(id = "evt-1", name = "Технопром-2026", startDate = "2026-07-10", endDate = "2026-07-12"),
    )

    private fun successfulProvisionResponse() = ProvisionStationResponseDto(
        stationConfig = ProvisionedStationConfigDto(eventId = "evt-1", eventName = "Технопром-2026", staffName = "manager@idento.app"),
        staffJwt = "jwt-2",
        deviceNumber = 9,
    )

    @Test
    fun selectingAnEventMintsAndRedeemsAProvisioningTokenForSelf() = runTest(testDispatcher) {
        val draft = SetupWizardDraft()
        val viewModel = SetupEventViewModel(
            eventLister = FakeEventLister(ApiResult.Success(sampleEvents)),
            provisioningTokenMinter = FakeProvisioningTokenMinter(
                ApiResult.Success(CreateProvisioningTokenResponseDto(token = "tok-1", expiresAt = "2026-07-10T00:10:00Z")),
            ),
            stationProvisioner = FakeStationProvisioner(ApiResult.Success(successfulProvisionResponse())),
            authTokenSaver = FakeAuthTokenSaver(),
            currentUserIdProvider = FakeCurrentUserIdProvider(userId = "user-1"),
            draft = draft,
        )

        viewModel.loadEvents()
        viewModel.onEventSelected(sampleEvents.first())

        assertEquals("evt-1", draft.eventId)
        assertEquals("Технопром-2026", draft.eventName)
        assertEquals(9, draft.deviceNumber)
        assertEquals("manager@idento.app", draft.staffName)
        assertEquals(true, viewModel.uiState.value.provisioned)
        assertNull(viewModel.uiState.value.error)
    }

    @Test
    fun loadEventsPopulatesUiStateOnSuccess() = runTest(testDispatcher) {
        val viewModel = SetupEventViewModel(
            eventLister = FakeEventLister(ApiResult.Success(sampleEvents)),
            provisioningTokenMinter = FakeProvisioningTokenMinter(ApiResult.Error(RuntimeException("not used"))),
            stationProvisioner = FakeStationProvisioner(ApiResult.Error(RuntimeException("not used"))),
            authTokenSaver = FakeAuthTokenSaver(),
            currentUserIdProvider = FakeCurrentUserIdProvider(userId = "user-1"),
            draft = SetupWizardDraft(),
        )

        viewModel.loadEvents()

        assertEquals(sampleEvents, viewModel.uiState.value.events)
        assertEquals(false, viewModel.uiState.value.isLoading)
    }

    @Test
    fun loadEventsSurfacesErrorOnFailure() = runTest(testDispatcher) {
        val viewModel = SetupEventViewModel(
            eventLister = FakeEventLister(ApiResult.Error(RuntimeException("boom"), "Could not load events")),
            provisioningTokenMinter = FakeProvisioningTokenMinter(ApiResult.Error(RuntimeException("not used"))),
            stationProvisioner = FakeStationProvisioner(ApiResult.Error(RuntimeException("not used"))),
            authTokenSaver = FakeAuthTokenSaver(),
            currentUserIdProvider = FakeCurrentUserIdProvider(userId = "user-1"),
            draft = SetupWizardDraft(),
        )

        viewModel.loadEvents()

        assertEquals("Could not load events", viewModel.uiState.value.error)
        assertTrue(viewModel.uiState.value.events.isEmpty())
    }

    @Test
    fun missingUserIdSurfacesNotSignedInErrorAndDoesNotMintAToken() = runTest(testDispatcher) {
        val draft = SetupWizardDraft()
        val viewModel = SetupEventViewModel(
            eventLister = FakeEventLister(ApiResult.Success(sampleEvents)),
            provisioningTokenMinter = FakeProvisioningTokenMinter(ApiResult.Error(RuntimeException("must not be called"))),
            stationProvisioner = FakeStationProvisioner(ApiResult.Error(RuntimeException("must not be called"))),
            authTokenSaver = FakeAuthTokenSaver(),
            currentUserIdProvider = FakeCurrentUserIdProvider(userId = null),
            draft = draft,
        )

        viewModel.onEventSelected(sampleEvents.first())

        assertEquals("Not signed in", viewModel.uiState.value.error)
        assertEquals(false, viewModel.uiState.value.provisioned)
        assertEquals("", draft.eventId)
    }

    @Test
    fun tokenMintFailureSurfacesAnErrorAndDoesNotProvision() = runTest(testDispatcher) {
        val draft = SetupWizardDraft()
        val viewModel = SetupEventViewModel(
            eventLister = FakeEventLister(ApiResult.Success(sampleEvents)),
            provisioningTokenMinter = FakeProvisioningTokenMinter(ApiResult.Error(RuntimeException("no token"), "Could not provision this station")),
            stationProvisioner = FakeStationProvisioner(ApiResult.Error(RuntimeException("must not be called"))),
            authTokenSaver = FakeAuthTokenSaver(),
            currentUserIdProvider = FakeCurrentUserIdProvider(userId = "user-1"),
            draft = draft,
        )

        viewModel.onEventSelected(sampleEvents.first())

        assertEquals("Could not provision this station", viewModel.uiState.value.error)
        assertEquals(false, viewModel.uiState.value.provisioned)
        assertEquals("", draft.eventId)
    }

    @Test
    fun provisionFailureSurfacesAnErrorAndLeavesTheDraftUntouched() = runTest(testDispatcher) {
        val draft = SetupWizardDraft()
        val viewModel = SetupEventViewModel(
            eventLister = FakeEventLister(ApiResult.Success(sampleEvents)),
            provisioningTokenMinter = FakeProvisioningTokenMinter(
                ApiResult.Success(CreateProvisioningTokenResponseDto(token = "tok-1", expiresAt = "2026-07-10T00:10:00Z")),
            ),
            stationProvisioner = FakeStationProvisioner(ApiResult.Error(RuntimeException("expired"), "Could not provision this station")),
            authTokenSaver = FakeAuthTokenSaver(),
            currentUserIdProvider = FakeCurrentUserIdProvider(userId = "user-1"),
            draft = draft,
        )

        viewModel.onEventSelected(sampleEvents.first())

        assertEquals("Could not provision this station", viewModel.uiState.value.error)
        assertEquals(false, viewModel.uiState.value.provisioned)
        assertEquals("", draft.eventId)
    }

    @Test
    fun tokenSaveFailureSurfacesAnErrorAndLeavesTheDraftUntouched() = runTest(testDispatcher) {
        val draft = SetupWizardDraft()
        val viewModel = SetupEventViewModel(
            eventLister = FakeEventLister(ApiResult.Success(sampleEvents)),
            provisioningTokenMinter = FakeProvisioningTokenMinter(
                ApiResult.Success(CreateProvisioningTokenResponseDto(token = "tok-1", expiresAt = "2026-07-10T00:10:00Z")),
            ),
            stationProvisioner = FakeStationProvisioner(ApiResult.Success(successfulProvisionResponse())),
            authTokenSaver = FakeAuthTokenSaver(saved = false),
            currentUserIdProvider = FakeCurrentUserIdProvider(userId = "user-1"),
            draft = draft,
        )

        viewModel.onEventSelected(sampleEvents.first())

        assertEquals("Could not securely store credentials", viewModel.uiState.value.error)
        assertEquals(false, viewModel.uiState.value.provisioned)
        assertEquals("", draft.eventId)
    }
}
