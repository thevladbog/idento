package com.idento.presentation.setup

import com.idento.data.model.LoginResponse
import com.idento.data.model.ProvisionStationResponseDto
import com.idento.data.model.ProvisionedStationConfigDto
import com.idento.data.model.User
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
 * `stationProvisioner`/`managerAuthenticator`/`authTokenSaver` are the narrow fun-interface
 * seams `SetupLoginViewModel` depends on instead of `StationRepository`/`AuthRepository`/
 * `AuthPreferences` directly (see SetupLoginViewModel.kt's kdoc) — those three are plain classes
 * wrapping platform `expect`/`actual` singletons (Ktor engine, SecureStore, DataStoreFactory)
 * that cannot be constructed or subclassed from commonTest, so faking them directly isn't an
 * option. `cameraService` stays untested here: `startQrScan()` is a thin wrapper around a real
 * `CameraService` (itself unconstructable from commonTest) and isn't exercised by these tests.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SetupLoginViewModelTest {

    private val testDispatcher = UnconfinedTestDispatcher()

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private class FakeStationProvisioner(private val result: ApiResult<ProvisionStationResponseDto>) : StationProvisioner {
        override suspend fun provisionStation(token: String, deviceInfo: Map<String, String>?): ApiResult<ProvisionStationResponseDto> = result
    }

    private class FakeManagerAuthenticator(
        private val result: ApiResult<LoginResponse> = ApiResult.Error(RuntimeException("not used")),
    ) : ManagerAuthenticator {
        override suspend fun login(email: String, password: String): ApiResult<LoginResponse> = result
    }

    private class FakeAuthTokenSaver(private val saved: Boolean = true) : AuthTokenSaver {
        override suspend fun saveAuthToken(token: String): Boolean = saved
    }

    @Test
    fun scanningAValidTokenProvisionsTheStationAndSkipsToModeStep() = runTest(testDispatcher) {
        val response = ProvisionStationResponseDto(
            stationConfig = ProvisionedStationConfigDto(eventId = "evt-1", eventName = "Технопром-2026", staffName = "staff@idento.app"),
            staffJwt = "jwt-token",
            deviceNumber = 3,
        )
        val draft = SetupWizardDraft()
        val viewModel = SetupLoginViewModel(
            cameraService = null,
            stationProvisioner = FakeStationProvisioner(ApiResult.Success(response)),
            managerAuthenticator = FakeManagerAuthenticator(),
            authTokenSaver = FakeAuthTokenSaver(),
            draft = draft,
        )

        viewModel.onQrTokenScanned("provisioning-token-abc")

        assertEquals("evt-1", draft.eventId)
        assertEquals("Технопром-2026", draft.eventName)
        assertEquals(3, draft.deviceNumber)
        assertEquals("staff@idento.app", draft.staffName)
        assertEquals(NextStep.Mode, viewModel.uiState.value.nextStep)
        assertNull(viewModel.uiState.value.error)
    }

    @Test
    fun invalidTokenSurfacesAnError() = runTest(testDispatcher) {
        val draft = SetupWizardDraft()
        val viewModel = SetupLoginViewModel(
            cameraService = null,
            stationProvisioner = FakeStationProvisioner(ApiResult.Error(RuntimeException("Invalid or expired token"), "Invalid or expired token")),
            managerAuthenticator = FakeManagerAuthenticator(),
            authTokenSaver = FakeAuthTokenSaver(),
            draft = draft,
        )

        viewModel.onQrTokenScanned("bad-token")

        assertTrue(viewModel.uiState.value.error != null)
        assertEquals(null, viewModel.uiState.value.nextStep)
    }

    @Test
    fun signInAsManagerAdvancesToEventStepWithoutTouchingTheDraft() = runTest(testDispatcher) {
        val loginResponse = LoginResponse(
            token = "manager-jwt",
            user = User(id = "u-1", email = "manager@idento.app", name = "Manager", role = "staff"),
        )
        val draft = SetupWizardDraft()
        val viewModel = SetupLoginViewModel(
            cameraService = null,
            stationProvisioner = FakeStationProvisioner(ApiResult.Error(RuntimeException("not used"))),
            managerAuthenticator = FakeManagerAuthenticator(ApiResult.Success(loginResponse)),
            authTokenSaver = FakeAuthTokenSaver(),
            draft = draft,
        )

        viewModel.onEmailChanged("manager@idento.app")
        viewModel.onPasswordChanged("hunter2")
        viewModel.signInAsManager()

        assertEquals(NextStep.Event, viewModel.uiState.value.nextStep)
        assertEquals("", draft.eventId)
    }

    @Test
    fun managerSignInFailureSurfacesAnErrorAndStaysPut() = runTest(testDispatcher) {
        val draft = SetupWizardDraft()
        val viewModel = SetupLoginViewModel(
            cameraService = null,
            stationProvisioner = FakeStationProvisioner(ApiResult.Error(RuntimeException("not used"))),
            managerAuthenticator = FakeManagerAuthenticator(ApiResult.Error(RuntimeException("bad creds"), "Invalid email or password")),
            authTokenSaver = FakeAuthTokenSaver(),
            draft = draft,
        )

        viewModel.onEmailChanged("manager@idento.app")
        viewModel.onPasswordChanged("wrong")
        viewModel.signInAsManager()

        assertEquals("Invalid email or password", viewModel.uiState.value.error)
        assertEquals(null, viewModel.uiState.value.nextStep)
    }

    @Test
    fun toggleManagerModeFlipsStateAndClearsError() = runTest(testDispatcher) {
        val draft = SetupWizardDraft()
        val viewModel = SetupLoginViewModel(
            cameraService = null,
            stationProvisioner = FakeStationProvisioner(ApiResult.Error(RuntimeException("not used"))),
            managerAuthenticator = FakeManagerAuthenticator(),
            authTokenSaver = FakeAuthTokenSaver(),
            draft = draft,
        )

        assertEquals(false, viewModel.uiState.value.isManagerMode)
        viewModel.toggleManagerMode()
        assertEquals(true, viewModel.uiState.value.isManagerMode)
        viewModel.toggleManagerMode()
        assertEquals(false, viewModel.uiState.value.isManagerMode)
    }
}
