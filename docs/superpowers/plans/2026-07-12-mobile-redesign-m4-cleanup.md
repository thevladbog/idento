# Mobile Redesign M4 — Module Restructure & Dead Code Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the mobile Gradle project to the design's target layout (`mobile/` root with `:shared` + `:androidApp`), delete all code confirmed dead after M1–M3, wire a missing Settings entry point into Registration/Zone Control, and bring CI in line with the new module.

**Architecture:** No new architecture — this phase moves/deletes files and trims dependency graphs. The Kotlin Multiplatform boundary (`:shared` owns all UI/business logic, `:androidApp`/`:iosApp` are thin platform shells) does not change; this phase makes the physical directory layout match that boundary for the first time.

**Tech Stack:** Kotlin 2.3.21, AGP 8.13.2, Compose Multiplatform 1.11.1, Koin 4.0.0, Gradle 8.14.5. No new dependencies added; several are removed (Hilt 2.58, KSP, Retrofit/OkHttp-logging-interceptor, Gson, Room, CameraX, ML Kit, Coil, Accompanist, zxing, kotlinx-serialization-json — see Task 4).

## Global Constraints

- Exhaustive `when` with **no catch-all branch** wherever the compiler can enforce completeness (e.g. `StationMode`/`RegistrationVerdict`/`ZoneVerdict` branches) — established in M1–M3, do not introduce `else ->` where an exhaustive `when` already works.
- Platform/testability boundaries use narrow `fun interface` seams (e.g. `KioskExitGateway`, `RegistrationStationGateway`) — this phase does not add any new ViewModel logic, so this constraint is informational only (no new seams needed).
- DI is Koin only: `factory {}` for ViewModels, `single {}` for repositories/services, wired in `AppModule.kt`/`ViewModelModule.kt`. Never reintroduce Hilt.
- All file moves that preserve content use `git mv` (or `git add` + `git rm` in the same commit for cross-directory moves Git can't detect automatically) so `git log --follow` keeps working on moved files.
- Every task's gate commands run from the **module root active at the time of that task** — Tasks 1–4 run from `mobile/android-app/` (unchanged root); Tasks 5 onward run from `mobile/` (new root, created in Task 5).

---

### Task 1: Delete dead network/storage code in `:shared`

**Files:**
- Delete: `mobile/shared/src/commonMain/kotlin/com/idento/data/storage/InMemoryAuthStorage.kt`
- Delete: `mobile/shared/src/androidMain/kotlin/com/idento/data/network/ApiClient.android.kt`
- Delete: `mobile/shared/src/iosMain/kotlin/com/idento/data/network/ApiClient.ios.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/data/network/ApiClient.kt`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this is pure deletion, no later task depends on anything removed here.

Both `InMemoryAuthStorage` (superseded by `AuthPreferences` + SecureStore) and the `createPlatformHttpClient` expect/actual triple (declared but never called — `ApiClient`'s own `httpClient` field builds its `HttpClient { ... }` directly) were verified zero-reference during design (`docs/superpowers/specs/2026-07-12-mobile-redesign-m4-cleanup-design.md` §2/§5).

- [ ] **Step 1: Delete the dead files**

```bash
cd mobile/android-app
git rm ../shared/src/commonMain/kotlin/com/idento/data/storage/InMemoryAuthStorage.kt
git rm ../shared/src/androidMain/kotlin/com/idento/data/network/ApiClient.android.kt
git rm ../shared/src/iosMain/kotlin/com/idento/data/network/ApiClient.ios.kt
```

- [ ] **Step 2: Remove the dead `expect fun` from `ApiClient.kt`**

In `mobile/shared/src/commonMain/kotlin/com/idento/data/network/ApiClient.kt`, delete these two lines (they sit between the `ApiClient` class and `logLevelFor`):

```kotlin
/**
 * Platform-specific HTTP client engine configuration
 */
expect fun createPlatformHttpClient(config: HttpClientConfig<*>.() -> Unit): HttpClient
```

The file's final contents (class `ApiClient` and `logLevelFor`) are unchanged otherwise.

- [ ] **Step 3: Verify `:shared` still compiles for all targets**

Run: `cd mobile/android-app && ./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64`
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 4: Run the shared test suite**

Run: `./gradlew :shared:testDebugUnitTest`
Expected: `BUILD SUCCESSFUL`, all pre-existing tests still pass (no test referenced `InMemoryAuthStorage` or `createPlatformHttpClient` — confirmed zero matches during design).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(mobile/shared): delete InMemoryAuthStorage and unused createPlatformHttpClient"
```

---

### Task 2: Delete orphaned legacy nav cluster in `:shared`

**Files:**
- Delete: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/login/` (LoginViewModel.kt, LoginScreen.kt)
- Delete: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/events/` (EventsViewModel.kt, EventsScreen.kt)
- Delete: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/checkin/` (CheckinViewModel.kt, CheckinScreen.kt)
- Delete: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/attendees/` (AttendeesListViewModel.kt, AttendeesListScreen.kt)
- Delete: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/dayselect/` (DaySelectViewModel.kt, DaySelectScreen.kt)
- Delete: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/template/` (DisplayTemplateViewModel.kt, DisplayTemplateScreen.kt, TemplateEditorViewModel.kt, TemplateEditorScreen.kt)
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/Screen.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/IdentoNavHost.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt`

**Interfaces:**
- Consumes: nothing new.
- Produces: `IdentoNavHost`'s `startDestination` parameter becomes required (no default) — Task 3 does not call `IdentoNavHost()` directly so this doesn't affect it; the sole call site (`App.kt:93`) already passes it explicitly.

Verified during design: `App.kt` always calls `IdentoNavHost(startDestination = resolvedStartDestination)`, and `resolveStartDestination()` (in `IdentoNavHost.kt`) can only return `SetupLogin`/`RegistrationHome`/`ZoneControlHome`/`KioskHome`/`SetupComplete` — the `Screen.Login` route (the removed cluster's entry point) is unreachable from the real app. The only files referencing this cluster outside itself are `IdentoNavHost.kt` (nav registration) and `ViewModelModule.kt` (Koin factories) — both edited below.

- [ ] **Step 1: Delete the six orphaned presentation packages**

```bash
cd mobile/android-app
git rm -r ../shared/src/commonMain/kotlin/com/idento/presentation/login
git rm -r ../shared/src/commonMain/kotlin/com/idento/presentation/events
git rm -r ../shared/src/commonMain/kotlin/com/idento/presentation/checkin
git rm -r ../shared/src/commonMain/kotlin/com/idento/presentation/attendees
git rm -r ../shared/src/commonMain/kotlin/com/idento/presentation/dayselect
git rm -r ../shared/src/commonMain/kotlin/com/idento/presentation/template
```

- [ ] **Step 2: Remove the dead routes from `Screen.kt`**

In `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/Screen.kt`, delete these `data object` declarations (everything between `sealed class Screen(...)` and the `// Setup wizard (M1b)` comment):

```kotlin
    data object Login : Screen("login")
    data object Events : Screen("events")
    data object DaySelect : Screen("day_select/{eventId}/{eventName}") {
        fun createRoute(eventId: String, eventName: String) = 
            "day_select/$eventId/$eventName"
    }
    data object ZoneSelect : Screen("zone_select/{eventId}/{eventDay}") {
        fun createRoute(eventId: String, eventDay: String) = 
            "zone_select/$eventId/$eventDay"
    }
    data object Checkin : Screen("checkin/{eventId}/{eventName}") {
        fun createRoute(eventId: String, eventName: String) = 
            "checkin/$eventId/$eventName"
    }
    data object AttendeesList : Screen("attendees/{eventId}") {
        fun createRoute(eventId: String) = "attendees/$eventId"
    }
    data object Settings : Screen("settings")
    data object QRScanner : Screen("qr_scanner/{eventId}/{eventName}") {
        fun createRoute(eventId: String, eventName: String) = 
            "qr_scanner/$eventId/$eventName"
    }
    data object TemplateEditor : Screen("template_editor/{eventId}") {
        fun createRoute(eventId: String) = "template_editor/$eventId"
    }
    data object DisplayTemplate : Screen("display_template/{eventId}") {
        fun createRoute(eventId: String) = "display_template/$eventId"
    }
    data object BluetoothScannerSettings : Screen("bluetooth_scanner_settings")
```

**Keep `Settings`** — it is real, reachable code as of Task 3 (see below). The resulting file has `Settings` as the first entry, immediately followed by the existing `// Setup wizard (M1b)` section:

```kotlin
sealed class Screen(val route: String) {
    data object Settings : Screen("settings")

    // Setup wizard (M1b) — all wizard state lives in the shared SetupWizardDraft, not nav args.
    data object SetupLogin : Screen("setup_login")
    data object SetupEvent : Screen("setup_event")
    data object SetupMode : Screen("setup_mode")
    data object SetupDayZone : Screen("setup_day_zone")
    data object SetupPrinter : Screen("setup_printer")
    data object SetupComplete : Screen("setup_complete")

    // Registration mode (M1d) — screen shown on cold start when stationMode == REGISTRATION.
    data object RegistrationHome : Screen("registration_home")

    // Zone Control mode (M2) — screen shown on cold start when stationMode == ZONE_CONTROL.
    data object ZoneControlHome : Screen("zone_control_home")

    // Kiosk mode (M3) — screen shown on cold start when stationMode == KIOSK.
    data object KioskHome : Screen("kiosk_home")
}
```

- [ ] **Step 3: Remove the dead composables and imports from `IdentoNavHost.kt`**

In `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/IdentoNavHost.kt`:

1. Remove these imports:

```kotlin
import com.idento.presentation.attendees.AttendeesListScreen
import com.idento.presentation.checkin.CheckinScreen
import com.idento.presentation.events.EventsScreen
import com.idento.presentation.login.LoginScreen
import com.idento.presentation.template.DisplayTemplateScreen
import com.idento.presentation.template.TemplateEditorScreen
```

Also remove the now-unused `NavType` and `navArgument` imports (only used by the deleted `composable{}` blocks — `Setup*`/`RegistrationHome`/`ZoneControlHome`/`KioskHome` routes take no arguments):

```kotlin
import androidx.navigation.NavType
import androidx.navigation.navArgument
```

2. Change the function signature — `startDestination` loses its default value:

```kotlin
@Composable
fun IdentoNavHost(
    modifier: Modifier = Modifier,
    navController: NavHostController = rememberNavController(),
    startDestination: String
) {
```

3. Delete these `composable{}` blocks entirely (Login, Events, Checkin, AttendeesList, TemplateEditor, DisplayTemplate, BluetoothScannerSettings — `Settings` itself is not deleted, its dangling `BluetoothScannerSettings` reference is fixed immediately below):

```kotlin
        // Login Screen
        composable(Screen.Login.route) {
            LoginScreen(
                onLoginSuccess = {
                    navController.navigate(Screen.Events.route) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                }
            )
        }
        
        // Events Screen
        composable(Screen.Events.route) {
            EventsScreen(
                onNavigateToCheckin = { eventId, eventName ->
                    navController.navigate(Screen.Checkin.createRoute(eventId, eventName))
                },
                onNavigateToSettings = {
                    navController.navigate(Screen.Settings.route)
                },
                onLogout = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(Screen.Events.route) { inclusive = true }
                    }
                }
            )
        }
        
        // Checkin Screen
        composable(
            route = Screen.Checkin.route,
            arguments = listOf(
                navArgument("eventId") { type = NavType.StringType },
                navArgument("eventName") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val eventId = backStackEntry.arguments?.getString("eventId") ?: ""
            val eventName = backStackEntry.arguments?.getString("eventName") ?: ""
            
            // Get selected attendee ID from previous screen (AttendeesListScreen)
            val selectedAttendeeId = backStackEntry.savedStateHandle.get<String>("selectedAttendeeId")
            
            CheckinScreen(
                eventId = eventId,
                eventName = eventName,
                selectedAttendeeId = selectedAttendeeId,
                zoneId = null,  // Default to null for legacy mode
                eventDay = null, // Default to null for legacy mode
                onNavigateBack = { navController.popBackStack() },
                onNavigateToAttendeesList = {
                    navController.navigate(Screen.AttendeesList.createRoute(eventId))
                },
                onNavigateToQRScanner = {
                    navController.navigate(Screen.QRScanner.createRoute(eventId, eventName))
                },
                onNavigateToTemplateEditor = {
                    navController.navigate(Screen.TemplateEditor.createRoute(eventId))
                },
                onNavigateToDisplayTemplate = {
                    navController.navigate(Screen.DisplayTemplate.createRoute(eventId))
                },
                onClearSelectedAttendee = {
                    // Clear the savedStateHandle after processing
                    backStackEntry.savedStateHandle.remove<String>("selectedAttendeeId")
                }
            )
        }
        
        // Attendees List Screen
        composable(
            route = Screen.AttendeesList.route,
            arguments = listOf(
                navArgument("eventId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val eventId = backStackEntry.arguments?.getString("eventId") ?: ""
            
            AttendeesListScreen(
                eventId = eventId,
                onNavigateBack = { navController.popBackStack() },
                onSelectAttendee = { attendee ->
                    // Pass selected attendee ID back via savedStateHandle
                    navController.previousBackStackEntry?.savedStateHandle?.set("selectedAttendeeId", attendee.id)
                    navController.popBackStack()
                }
            )
        }
        
        // Template Editor Screen (ZPL Badge)
        composable(
            route = Screen.TemplateEditor.route,
            arguments = listOf(
                navArgument("eventId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val eventId = backStackEntry.arguments?.getString("eventId") ?: ""
            
            TemplateEditorScreen(
                eventId = eventId,
                onNavigateBack = { navController.popBackStack() }
            )
        }
        
        // Display Template Screen (Markdown)
        composable(
            route = Screen.DisplayTemplate.route,
            arguments = listOf(
                navArgument("eventId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val eventId = backStackEntry.arguments?.getString("eventId") ?: ""
            
            DisplayTemplateScreen(
                eventId = eventId,
                onNavigateBack = { navController.popBackStack() }
            )
        }
        
        // Bluetooth Scanner Settings
        composable(Screen.BluetoothScannerSettings.route) {
            PlaceholderScreen(
                title = "Bluetooth Scanner",
                subtitle = "Scanner settings coming soon",
                onBack = { navController.popBackStack() }
            )
        }
```

Do **not** delete the `composable(Screen.Settings.route) { SettingsScreen(...) }` block itself — but it currently passes `onNavigateToBluetoothScanner = { navController.navigate(Screen.BluetoothScannerSettings.route) }`, and `Screen.BluetoothScannerSettings` no longer exists after Step 2 above — leaving this in would break the build. Simplify that one call site in this same step (Task 3 finishes the job by dropping the parameter from `SettingsScreen`'s own signature):

```kotlin
        // Settings Screen
        composable(Screen.Settings.route) {
            SettingsScreen(
                onNavigateBack = { navController.popBackStack() },
            )
        }
```

(`SettingsScreen`'s `onNavigateToBluetoothScanner: () -> Unit = {}` parameter still exists at this point with its default value, so simply not passing it compiles cleanly.)

4. Delete the now-unused `PlaceholderScreen` private composable (only the deleted `BluetoothScannerSettings` block used it) and its now-unused import — `AppIcons` is imported at the top solely for `AppIcons.AutoMirrored.ArrowBack` inside `PlaceholderScreen`, which is its only use anywhere in this file (verified during design):

```kotlin
import com.idento.presentation.components.AppIcons
```

remove this import, then delete:

```kotlin
/**
 * Placeholder screen for features not yet implemented
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PlaceholderScreen(
    title: String,
    subtitle: String,
    onBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            AppIcons.AutoMirrored.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                    titleContentColor = MaterialTheme.colorScheme.onBackground
                )
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues),
            contentAlignment = Alignment.Center
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.headlineSmall,
                    color = MaterialTheme.colorScheme.onBackground
                )
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
```

- [ ] **Step 4: Remove the dead ViewModel factories and imports from `ViewModelModule.kt`**

In `mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt`, remove these imports:

```kotlin
import com.idento.presentation.attendees.AttendeesListViewModel
import com.idento.presentation.checkin.CheckinViewModel
import com.idento.presentation.events.EventsViewModel
import com.idento.presentation.login.LoginViewModel
import com.idento.presentation.template.DisplayTemplateViewModel
import com.idento.presentation.template.TemplateEditorViewModel
```

And remove these six `factory { ... }` lines from the `viewModelModule` block (keep `factory { SettingsViewModel(get()) }`):

```kotlin
    factory { LoginViewModel(get()) }
    factory { EventsViewModel(get(), get()) }
    factory { CheckinViewModel(get(), get(), get(), get()) }
    factory { AttendeesListViewModel(get()) }
    factory { TemplateEditorViewModel(get()) }
    factory { DisplayTemplateViewModel(get(), get(), get()) }
```

The block starts with `factory { SettingsViewModel(get()) }` immediately followed by the `factory { ... SetupLoginViewModel ... }` block that was already there.

- [ ] **Step 5: Verify `:shared` compiles and lints for all targets**

Run: `cd mobile/android-app && ./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64`
Expected: `BUILD SUCCESSFUL`. If the compiler reports unused-import warnings for `AppIcons`/other symbols in `IdentoNavHost.kt`, resolve per Step 3.4's note (remove only if genuinely unused elsewhere in the file).

- [ ] **Step 6: Run the shared test suite**

Run: `./gradlew :shared:testDebugUnitTest`
Expected: `BUILD SUCCESSFUL`. `SetupStartDestinationTest.kt` is unaffected (it only tests `resolveStartDestination()`, a pure function untouched by this task).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(mobile/shared): delete orphaned pre-redesign nav cluster (login/events/checkin/attendees/dayselect/template)"
```

---

### Task 3: Wire a Settings entry point into Registration and Zone Control

**Files:**
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/registration/RegistrationHomeScreen.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/zonecontrol/ZoneControlScreen.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/IdentoNavHost.kt`

**Interfaces:**
- Consumes: `Screen.Settings` (kept in Task 2), `SettingsScreen(viewModel, onNavigateBack, onNavigateToBluetoothScanner)` (existing signature in `mobile/shared/src/commonMain/kotlin/com/idento/presentation/settings/SettingsScreen.kt` — `onNavigateToBluetoothScanner` is dropped by this task since it's verified unused inside `SettingsScreen`'s own body), `AppIcons.Settings` (existing icon, `mobile/shared/src/commonMain/kotlin/com/idento/presentation/components/AppIcons.kt`), `StringKey.SETTINGS` (existing string, `"Settings"`/`"Настройки"`).
- Produces: `RegistrationHomeScreen(viewModel, onNavigateToSettings: () -> Unit = {})`, `ZoneControlScreen(viewModel, onNavigateToSettings: () -> Unit = {})` — new optional trailing parameter on both, default no-op so existing call sites without the param still compile.

Per design spec §4: Registration and Zone Control currently have zero navigation affordance — no way for staff to reach Settings or exit the station once configured (only Kiosk got a local exit dialog in M3). This adds a visible settings icon (not Kiosk's hidden long-press — these are staff-only screens, no need to obscure it from the public).

- [ ] **Step 1: Add the Settings icon button to `RegistrationHomeScreen`**

In `mobile/shared/src/commonMain/kotlin/com/idento/presentation/registration/RegistrationHomeScreen.kt`, add these imports:

```kotlin
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
```

Change the function signature:

```kotlin
@Composable
fun RegistrationHomeScreen(
    viewModel: RegistrationHomeViewModel = koinInject(),
    onNavigateToSettings: () -> Unit = {},
) {
```

Wrap the existing `StatusBar(...)` call in a `Box` that overlays a top-end-aligned settings `IconButton`:

```kotlin
    Column(modifier = Modifier.fillMaxSize().statusBarsPadding()) {
        Box(modifier = Modifier.fillMaxWidth()) {
            StatusBar(
                cells = listOf(
                    StatusCell(
                        value = uiState.zoneName,
                        label = stringResource(StringKey.REGISTRATION_STATUSBAR_ZONE_LABEL),
                    ),
                    StatusCell(
                        value = uiState.printerLabel,
                        label = stringResource(StringKey.REGISTRATION_STATUSBAR_PRINTER_LABEL),
                        valueColor = if (uiState.printerStatusOk) IdentoColors.Brand else IdentoColors.TextSecondary,
                    ),
                    StatusCell(
                        value = uiState.pendingQueueCount.toString(),
                        label = stringResource(StringKey.REGISTRATION_STATUSBAR_QUEUE_LABEL),
                        valueColor = if (uiState.pendingQueueCount > 0) IdentoColors.Queue else IdentoColors.TextPrimary,
                    ),
                    StatusCell(
                        value = uiState.sessionCheckedCount.toString(),
                        label = stringResource(StringKey.REGISTRATION_STATUSBAR_CHECKED_LABEL),
                    ),
                ),
            )
            IconButton(
                onClick = onNavigateToSettings,
                modifier = Modifier.align(Alignment.CenterEnd).padding(end = IdentoSpacing.md),
            ) {
                Icon(AppIcons.Settings, contentDescription = stringResource(StringKey.SETTINGS))
            }
        }
```

(Only the `StatusBar(...)` call gets wrapped — the `ModeSegmentedControl`, `OfflineBanner`, and `when (uiState.currentTab)` block right after it are unchanged, still direct children of the outer `Column`.)

- [ ] **Step 2: Add the same Settings icon button to `ZoneControlScreen`**

In `mobile/shared/src/commonMain/kotlin/com/idento/presentation/zonecontrol/ZoneControlScreen.kt`, add these imports:

```kotlin
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
```

Change the function signature:

```kotlin
@Composable
fun ZoneControlScreen(
    viewModel: ZoneControlViewModel = koinInject(),
    onNavigateToSettings: () -> Unit = {},
) {
```

Wrap the existing `StatusBar(...)` call the same way:

```kotlin
    Column(modifier = Modifier.fillMaxSize().statusBarsPadding()) {
        Box(modifier = Modifier.fillMaxWidth()) {
            StatusBar(
                cells = listOf(
                    StatusCell(
                        value = uiState.zoneName,
                        label = stringResource(StringKey.ZONE_STATUSBAR_ZONE_LABEL),
                    ),
                    StatusCell(
                        value = uiState.allowedCount.toString(),
                        label = stringResource(StringKey.ZONE_STATUSBAR_ALLOWED_LABEL),
                        valueColor = IdentoColors.Brand,
                    ),
                    StatusCell(
                        value = uiState.deniedCount.toString(),
                        label = stringResource(StringKey.ZONE_STATUSBAR_DENIED_LABEL),
                        valueColor = if (uiState.deniedCount > 0) IdentoColors.Denied else IdentoColors.TextPrimary,
                    ),
                ),
            )
            IconButton(
                onClick = onNavigateToSettings,
                modifier = Modifier.align(Alignment.CenterEnd).padding(end = IdentoSpacing.md),
            ) {
                Icon(AppIcons.Settings, contentDescription = stringResource(StringKey.SETTINGS))
            }
        }
```

(The `Box` with the print-disabled badge and `ScanBody(...)` right after remain unchanged, still direct children of the outer `Column`.)

- [ ] **Step 3: Wire both screens to Settings in `IdentoNavHost.kt`**

In `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/IdentoNavHost.kt`, the `Settings` composable block was already simplified to drop the dead `onNavigateToBluetoothScanner` wiring in Task 2 Step 3 (it now just reads `SettingsScreen(onNavigateBack = { navController.popBackStack() })`) — optionally update its comment to note the new entry points:

```kotlin
        // Settings Screen — reachable from Registration and Zone Control (M4).
        composable(Screen.Settings.route) {
            SettingsScreen(
                onNavigateBack = { navController.popBackStack() },
            )
        }
```

Then update the `RegistrationHome` and `ZoneControlHome` composables to pass the new callback:

```kotlin
        composable(Screen.RegistrationHome.route) {
            RegistrationHomeScreen(
                onNavigateToSettings = { navController.navigate(Screen.Settings.route) },
            )
        }

        composable(Screen.ZoneControlHome.route) {
            ZoneControlScreen(
                onNavigateToSettings = { navController.navigate(Screen.Settings.route) },
            )
        }
```

`KioskHome` is unchanged — Kiosk already has its own self-contained exit dialog (M3) and is not meant to expose the staff `SettingsScreen` to attendees.

- [ ] **Step 4: Drop the unused `onNavigateToBluetoothScanner` parameter from `SettingsScreen`**

In `mobile/shared/src/commonMain/kotlin/com/idento/presentation/settings/SettingsScreen.kt`, change:

```kotlin
fun SettingsScreen(
    viewModel: SettingsViewModel = koinInject(),
    onNavigateBack: () -> Unit = {},
    onNavigateToBluetoothScanner: () -> Unit = {}
) {
```

to:

```kotlin
fun SettingsScreen(
    viewModel: SettingsViewModel = koinInject(),
    onNavigateBack: () -> Unit = {},
) {
```

(Verified during design: this parameter is never invoked anywhere in `SettingsScreen`'s 637-line body — it was dead even before this task, only reachable via the now-deleted `BluetoothScannerSettings` placeholder.)

- [ ] **Step 5: Verify `:shared` compiles for all targets**

Run: `cd mobile/android-app && ./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64`
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 6: Run the shared test suite and Android lint**

Run: `./gradlew :shared:testDebugUnitTest :shared:lintDebug`
Expected: `BUILD SUCCESSFUL`, 0 lint errors.

No new automated test is added for this wiring — verified during design that no test in this codebase asserts on `IdentoNavHost`'s composable graph directly (`SetupStartDestinationTest.kt` only tests the pure `resolveStartDestination()` function); introducing a Compose UI test harness for one navigation edge would be new test infrastructure disproportionate to the change (see design spec §7). Correctness here is enforced by the compiler (parameter types) and this task's gate.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(mobile/shared): add Settings entry point to Registration and Zone Control"
```

---

### Task 4: Strip dead Hilt/Retrofit/Room/CameraX code from `:app` (pre-move)

**Files:**
- Delete: `mobile/android-app/app/src/main/java/com/idento/di/NetworkModule.kt`
- Delete: `mobile/android-app/app/src/main/java/com/idento/di/DataStoreModule.kt`
- Delete: `mobile/android-app/app/src/main/java/com/idento/data/api/` (IdentoApi.kt, AuthInterceptor.kt)
- Delete: `mobile/android-app/app/src/main/java/com/idento/data/scanner/` (HardwareScannerService.kt, BluetoothScannerService.kt)
- Delete: `mobile/android-app/app/src/main/java/com/idento/data/bluetooth/` (BluetoothPrinterService.kt, ZplImageText.kt, BadgeTemplate.kt)
- Delete: `mobile/android-app/app/src/main/java/com/idento/data/ethernet/` (EthernetPrinterService.kt)
- Delete: `mobile/android-app/app/src/main/java/com/idento/data/preferences/CheckinPreferences.kt`
- Delete: `mobile/android-app/app/src/main/java/com/idento/data/preferences/PrinterPreferences.kt`
- Delete: `mobile/android-app/app/src/main/java/com/idento/data/preferences/ScannerPreferences.kt`
- Delete: `mobile/android-app/app/src/main/java/com/idento/data/preferences/TemplatePreferences.kt`
- Delete: `mobile/android-app/app/src/main/java/com/idento/data/model/CheckinRequest.kt`
- Delete: `mobile/android-app/app/src/main/java/com/idento/data/model/LoginRequest.kt`
- Delete: `mobile/android-app/app/src/main/java/com/idento/data/model/UpdateAttendeeRequest.kt`
- Delete: `mobile/android-app/app/src/main/java/com/idento/data/model/Font.kt`
- Delete: `mobile/android-app/app/src/main/java/com/idento/data/local/TokenManager.kt`
- Modify: `mobile/android-app/app/src/main/java/com/idento/IdentoApplication.kt`
- Modify: `mobile/android-app/app/src/main/AndroidManifest.xml`
- Modify: `mobile/android-app/app/build.gradle.kts`
- Modify: `mobile/android-app/build.gradle.kts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — `:app`'s public surface (`MainActivity`, `IdentoApplication`) is unchanged in behavior, only its Hilt annotation and dependency footprint shrink.

Per design spec §2/§5, everything deleted here is reachable only from the Hilt modules being deleted alongside it (verified: `@AndroidEntryPoint`/`@Inject` appear nowhere in `MainActivity`; the app never actually uses Hilt's generated component). `data/local/CryptoManager.kt` is **kept** — it's used by `LegacySessionMigration.kt` (decrypts the pre-M1a app's stored JWT during upgrade).

This task additionally removes CameraX/ML Kit/Coil/zxing/Accompanist/`core-splashscreen`/kotlinx-serialization-json dependencies and the `kotlin("plugin.serialization")` plugin from `build.gradle.kts` — found during planning (grepping `mobile/android-app/app/src/main/java` for each library's usage returned zero matches once the files above are deleted; `BadgeTemplate.kt`, the sole zxing consumer, is itself one of the deleted files). This goes slightly beyond the design spec's explicitly-named Hilt/Retrofit/Room/Gson list but is the same category of change in the same file — leaving newly-orphaned dependencies in place would contradict this phase's own goal.

- [ ] **Step 1: Delete the dead Kotlin files**

```bash
cd mobile/android-app
git rm app/src/main/java/com/idento/di/NetworkModule.kt
git rm app/src/main/java/com/idento/di/DataStoreModule.kt
git rm -r app/src/main/java/com/idento/data/api
git rm -r app/src/main/java/com/idento/data/scanner
git rm -r app/src/main/java/com/idento/data/bluetooth
git rm -r app/src/main/java/com/idento/data/ethernet
git rm app/src/main/java/com/idento/data/preferences/CheckinPreferences.kt
git rm app/src/main/java/com/idento/data/preferences/PrinterPreferences.kt
git rm app/src/main/java/com/idento/data/preferences/ScannerPreferences.kt
git rm app/src/main/java/com/idento/data/preferences/TemplatePreferences.kt
git rm app/src/main/java/com/idento/data/model/CheckinRequest.kt
git rm app/src/main/java/com/idento/data/model/LoginRequest.kt
git rm app/src/main/java/com/idento/data/model/UpdateAttendeeRequest.kt
git rm app/src/main/java/com/idento/data/model/Font.kt
git rm app/src/main/java/com/idento/data/local/TokenManager.kt
```

- [ ] **Step 2: Drop `@HiltAndroidApp` from `IdentoApplication.kt`**

In `mobile/android-app/app/src/main/java/com/idento/IdentoApplication.kt`, remove the import and annotation:

```kotlin
import dagger.hilt.android.HiltAndroidApp
```

```kotlin
@HiltAndroidApp
class IdentoApplication : Application() {
```

becomes:

```kotlin
class IdentoApplication : Application() {
```

Nothing else in the file changes — `onCreate()`'s Koin init and best-effort legacy-migration launch are unaffected.

- [ ] **Step 3: Remove the unused `RECEIVE_BOOT_COMPLETED` permission**

In `mobile/android-app/app/src/main/AndroidManifest.xml`, delete:

```xml
    <!-- Generic scanner access -->
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
```

(No `BroadcastReceiver` in the app registers for `BOOT_COMPLETED` — verified during design.)

- [ ] **Step 4: Strip the dead plugin, dependencies, and resolution override from `app/build.gradle.kts`**

Replace the full contents of `mobile/android-app/app/build.gradle.kts` with:

```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.idento"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.idento"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            buildConfigField("String", "BASE_URL", "\"https://api.idento.app/\"")
        }
        debug {
            isDebuggable = true
            applicationIdSuffix = ".debug"
            buildConfigField("String", "BASE_URL", "\"http://10.0.2.2:8080/\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    // KMP shared module — the mobile-redesign UI (design system, wizard, registration screens)
    implementation(project(":shared"))

    // Koin (bootstraps :shared's DI graph)
    implementation("io.insert-koin:koin-android:4.0.0")

    // Core Android
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    
    // Compose BOM (2026.06.01 - latest stable)
    implementation(platform("androidx.compose:compose-bom:2026.06.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.animation:animation")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.navigation:navigation-compose:2.8.4")

    // DataStore (LegacySessionMigration reads the pre-M1a app's legacy preferences file)
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.11.0")

    // Debug
    debugImplementation("androidx.compose.ui:ui-tooling")
}
```

Removed relative to the current file: the Hilt/KSP plugins; the `kotlin("plugin.serialization")` plugin (no `@Serializable` class remains in `:app`); the `resolutionStrategy.force("kotlin-metadata-jvm:2.3.21")` block (only needed to work around Hilt's bundled `kotlin-metadata-jvm`); Hilt, Retrofit/Gson/OkHttp-logging-interceptor, Room, CameraX, ML Kit barcode-scanning, Coil, Accompanist permissions, zxing, `core-splashscreen`, and `kotlinx-serialization-json` dependencies; the `testImplementation`/`androidTestImplementation`/`debugImplementation(ui-test-manifest)` block (no `src/test` or `src/androidTest` directory exists anywhere in this module — verified during design; trivial to re-add once the module gets its first instrumented test).

- [ ] **Step 5: Strip the Hilt/KSP plugin declarations from the root `build.gradle.kts`**

In `mobile/android-app/build.gradle.kts`, remove:

```kotlin
    id("com.google.dagger.hilt.android") version "2.58" apply false
    id("com.google.devtools.ksp") version "2.3.10" apply false
```

Resulting file:

```kotlin
// Top-level build file where you can add configuration options common to all sub-projects/modules.
plugins {
    id("com.android.application") version "8.13.2" apply false
    id("com.android.library") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.3.21" apply false
    id("org.jetbrains.kotlin.multiplatform") version "2.3.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.3.21" apply false
    id("org.jetbrains.compose") version "1.11.1" apply false
    kotlin("plugin.serialization") version "2.3.21" apply false
}

tasks.register("clean", Delete::class) {
    delete(layout.buildDirectory)
}
```

(`kotlin("plugin.serialization")` stays here at `apply false` — it's declared for potential use by any subproject, unlike `app/build.gradle.kts` where it's actually applied; `:shared` may still use serialization internally through its own KMP plugin block, unaffected by this task. Leave it as-is at the root.)

- [ ] **Step 6: Verify `:app` still builds and lints from the current (pre-move) location**

Run: `cd mobile/android-app && ./gradlew :app:assembleDebug :app:lintDebug`
Expected: `BUILD SUCCESSFUL`, 0 lint errors (warning count may shift from removed files' formerly-flagged issues — that's expected, not a regression).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(mobile/android-app): strip dead Hilt/Retrofit/Room/CameraX stack from :app"
```

---

### Task 5: Physical module move — `mobile/android-app/` → `mobile/` + `mobile/androidApp/`

**Files:**
- Move: `mobile/android-app/app/src/**` → `mobile/androidApp/src/**`
- Move: `mobile/android-app/app/proguard-rules.pro` → `mobile/androidApp/proguard-rules.pro`
- Move: `mobile/android-app/app/build.gradle.kts` → `mobile/androidApp/build.gradle.kts`
- Move: `mobile/android-app/build.gradle.kts` → `mobile/build.gradle.kts`
- Move: `mobile/android-app/gradle.properties` → `mobile/gradle.properties`
- Move: `mobile/android-app/gradlew` → `mobile/gradlew`
- Move: `mobile/android-app/gradle/` → `mobile/gradle/`
- Create: `mobile/settings.gradle.kts` (replaces `mobile/android-app/settings.gradle.kts`)
- Create: `mobile/androidApp/README.md` (replaces `mobile/android-app/README.md`)
- Delete: `mobile/android-app/settings.gradle.kts`, `mobile/android-app/README.md`, `mobile/android-app/.gitignore` (superseded by root `.gitignore`, updated below)
- Delete (directory, not moved — regenerated caches): `mobile/android-app/.gradle/`, `mobile/android-app/.idea/`, `mobile/android-app/.kotlin/`, `mobile/android-app/local.properties`
- Modify: `/.gitignore` (repo root)

**Interfaces:**
- Consumes: nothing new.
- Produces: from this task onward, all Gradle commands in this plan run with working directory `mobile/` (not `mobile/android-app/`), targeting `:androidApp` (not `:app`).

`mobile/shared/` does not move — its path is unaffected by this task; only its consumer (`:app`/`:androidApp`) and the Gradle root move.

- [ ] **Step 1: Move the Android module's source tree and its own build file**

```bash
cd mobile
mkdir -p androidApp
git mv android-app/app/src androidApp/src
git mv android-app/app/proguard-rules.pro androidApp/proguard-rules.pro
git mv android-app/app/build.gradle.kts androidApp/build.gradle.kts
```

- [ ] **Step 2: Move the Gradle root files up to `mobile/`**

```bash
git mv android-app/build.gradle.kts build.gradle.kts
git mv android-app/gradle.properties gradle.properties
git mv android-app/gradlew gradlew
git mv android-app/gradle gradle
```

- [ ] **Step 3: Replace `settings.gradle.kts`**

```bash
git rm android-app/settings.gradle.kts
```

Create `mobile/settings.gradle.kts`:

```kotlin
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
        maven("https://maven.pkg.jetbrains.space/public/p/compose/dev")
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        maven("https://maven.pkg.jetbrains.space/public/p/compose/dev")
    }
}

rootProject.name = "Idento"
include(":androidApp")
include(":shared")
```

(No `project(":shared").projectDir = file(...)` override needed — `:shared` now sits directly at `mobile/shared/`, Gradle's default `include(":shared")` resolution already finds it there.)

- [ ] **Step 4: Replace the stale `README.md`**

```bash
git rm android-app/README.md
```

Create `mobile/androidApp/README.md`:

```markdown
# `:androidApp`

Thin Android shell for the Idento mobile app. All UI, business logic, and platform
abstractions live in `mobile/shared` (Kotlin Multiplatform); this module only provides:

- `MainActivity` — hosts `:shared`'s Compose UI via `setContent { App() }`.
- `IdentoApplication` — initializes Koin (`:shared`'s DI graph) and runs a best-effort
  one-time migration of any session left by the pre-M1a Hilt-based app (see
  `LegacySessionMigration.kt`).
- `AndroidManifest.xml` — permissions, `network_security_config`.

See `mobile/shared/src/androidMain` for the actual Android platform implementations
(camera scanning, Bluetooth/Ethernet printing, lock task mode, SecureStore).

## Build

From `mobile/`: `./gradlew :androidApp:assembleDebug`
```

- [ ] **Step 5: Delete the leftover `mobile/android-app/` directory**

```bash
cd mobile
rm -rf android-app
```

(`android-app/.gradle`, `.idea`, `.kotlin`, `local.properties`, `gate-output.txt`, `test-output.txt` are all untracked or gitignored — confirm nothing unexpected remains with `git status` before this step; it should show only the moves/deletes from Steps 1–4 plus these now-vanished untracked paths.)

- [ ] **Step 6: Update the repo-root `.gitignore`**

In `/.gitignore`, change:

```
# Mobile - Android
mobile/android-app/build/
mobile/android-app/.gradle/
mobile/android-app/local.properties
mobile/android-app/.externalNativeBuild
mobile/android-app/.cxx/
mobile/android-app/.kotlin/
mobile/shared/build/
```

to:

```
# Mobile - Android
mobile/androidApp/build/
mobile/.gradle/
mobile/local.properties
mobile/androidApp/.externalNativeBuild
mobile/androidApp/.cxx/
mobile/.kotlin/
mobile/shared/build/
```

- [ ] **Step 7: Regenerate `local.properties` for local builds (not committed)**

```bash
cd mobile
echo "sdk.dir=$ANDROID_HOME" > local.properties
```

(If `$ANDROID_HOME` is unset locally, use the SDK path from the old `mobile/android-app/local.properties`, e.g. `/Users/thevladbog/Library/Android/sdk`. This file is gitignored — never commit it.)

- [ ] **Step 8: Verify the build works from the new root**

Run: `cd mobile && chmod +x gradlew && ./gradlew :androidApp:assembleDebug :androidApp:lintDebug`
Expected: `BUILD SUCCESSFUL`, 0 lint errors, APK produced under `mobile/androidApp/build/`.

Run: `./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug`
Expected: `BUILD SUCCESSFUL` — confirms `:shared` (untouched by the move) still resolves correctly as a sibling module from the new root.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(mobile): move Gradle root to mobile/, rename :app to :androidApp"
```

---

### Task 6: CI — repoint and upgrade the Android job, add an iOS job

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/lint-mobile.sh`
- Modify: `scripts/lint-mobile.bat`
- Modify: `scripts/lint-mobile.ps1`

**Interfaces:**
- Consumes: `mobile/gradlew`, `:androidApp:assembleDebug`, `:androidApp:lintDebug`, `:shared:testDebugUnitTest`, `:shared:compileKotlinIosSimulatorArm64`, `:shared:compileKotlinIosArm64`, `:shared:compileTestKotlinIosSimulatorArm64`, `:shared:iosSimulatorArm64Test` (all verified to exist from Task 5's gate and from a live `./gradlew :shared:tasks --all` run during planning — `iosSimulatorArm64Test`: "Executes Kotlin/Native unit tests for target iosSimulatorArm64").
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Rename and upgrade the Android CI job**

In `.github/workflows/ci.yml`, replace the `lint-android` job:

```yaml
  # Lint Android (conditional, only for mobile changes)
  lint-android:
    name: Lint Android
    runs-on: ubuntu-latest
    needs: changes
    if: needs.changes.outputs.mobile == 'true'
    continue-on-error: true  # Don't fail entire pipeline if Android lint fails
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: "temurin"
          java-version: "17"
      
      - name: Cache Gradle
        uses: actions/cache@v4
        with:
          path: |
            ~/.gradle/caches
            mobile/android-app/.gradle
          key: gradle-${{ runner.os }}-${{ hashFiles('mobile/android-app/**/*.gradle*', 'mobile/android-app/gradle/wrapper/gradle-wrapper.properties', 'mobile/shared/**/*.gradle*') }}
          restore-keys: |
            gradle-${{ runner.os }}-
      
      - name: Grant execute permission
        run: chmod +x mobile/android-app/gradlew
      
      - name: Lint Android
        run: ./scripts/lint-mobile.sh
      
      - name: Summary
        if: always()
        run: |
          echo "## Android Lint Results" >> $GITHUB_STEP_SUMMARY
          echo "✅ Android linting completed" >> $GITHUB_STEP_SUMMARY
```

with:

```yaml
  # Build + lint Android (conditional, only for mobile changes)
  build-android:
    name: Build Android
    runs-on: ubuntu-latest
    needs: changes
    if: needs.changes.outputs.mobile == 'true'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: "temurin"
          java-version: "17"
      
      - name: Cache Gradle
        uses: actions/cache@v4
        with:
          path: |
            ~/.gradle/caches
            mobile/.gradle
          key: gradle-${{ runner.os }}-${{ hashFiles('mobile/**/*.gradle*', 'mobile/gradle/wrapper/gradle-wrapper.properties') }}
          restore-keys: |
            gradle-${{ runner.os }}-
      
      - name: Grant execute permission
        run: chmod +x mobile/gradlew
      
      - name: Build and test
        working-directory: mobile
        run: ./gradlew :androidApp:assembleDebug :androidApp:lintDebug :shared:testDebugUnitTest
      
      - name: Summary
        if: always()
        run: |
          echo "## Android Build Results" >> $GITHUB_STEP_SUMMARY
          echo "✅ :androidApp assembled, linted, :shared unit tests run" >> $GITHUB_STEP_SUMMARY
```

(`continue-on-error: true` is dropped — this job now gates the same way `lint-go`/`typecheck-web` do, matching the pattern of every other language-specific job in this workflow.)

- [ ] **Step 2: Add the iOS CI job**

Immediately after the new `build-android` job, add:

```yaml
  # Build + test :shared on iOS (conditional, only for mobile changes)
  build-ios:
    name: Build iOS
    runs-on: macos-latest
    needs: changes
    if: needs.changes.outputs.mobile == 'true'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: "temurin"
          java-version: "17"
      
      - name: Cache Gradle
        uses: actions/cache@v4
        with:
          path: |
            ~/.gradle/caches
            mobile/.gradle
          key: gradle-${{ runner.os }}-${{ hashFiles('mobile/**/*.gradle*', 'mobile/gradle/wrapper/gradle-wrapper.properties') }}
          restore-keys: |
            gradle-${{ runner.os }}-
      
      - name: Grant execute permission
        run: chmod +x mobile/gradlew
      
      - name: Compile and test :shared for iOS
        working-directory: mobile
        run: ./gradlew :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:iosSimulatorArm64Test
      
      - name: Summary
        if: always()
        run: |
          echo "## iOS Build Results" >> $GITHUB_STEP_SUMMARY
          echo "✅ :shared compiled for iosArm64/iosSimulatorArm64, commonTest run on simulator" >> $GITHUB_STEP_SUMMARY
```

- [ ] **Step 3: Add both jobs to `ci-success`'s gate**

In the `ci-success` job, change:

```yaml
    needs: [lint-go, test-go, build-go, gosec, typecheck-web, lint-web, build-web, build-desktop, dependency-review]
```

to:

```yaml
    needs: [lint-go, test-go, build-go, gosec, typecheck-web, lint-web, build-web, build-android, build-ios, build-desktop, dependency-review]
```

And add the same success-or-skipped checks used for every other conditional job, right after the `build-desktop` check:

```yaml
          if [[ "${{ needs.build-desktop.result }}" != "success" && "${{ needs.build-desktop.result }}" != "skipped" ]]; then
            echo "build-desktop failed"
            exit 1
          fi
          if [[ "${{ needs.build-android.result }}" != "success" && "${{ needs.build-android.result }}" != "skipped" ]]; then
            echo "build-android failed"
            exit 1
          fi
          if [[ "${{ needs.build-ios.result }}" != "success" && "${{ needs.build-ios.result }}" != "skipped" ]]; then
            echo "build-ios failed"
            exit 1
          fi
          if [[ "${{ needs.dependency-review.result }}" != "success" && "${{ needs.dependency-review.result }}" != "skipped" ]]; then
```

(Keep the existing `dependency-review` check that follows — only the two new blocks are inserted before it.)

- [ ] **Step 4: Update the lint-mobile wrapper scripts**

Replace `scripts/lint-mobile.sh`:

```bash
#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/mobile"
echo "Running Android Lint..."
./gradlew :androidApp:lintDebug
echo "Done."
```

In `scripts/lint-mobile.ps1`, change:

```powershell
$AndroidPath = Join-Path $ProjectRoot "mobile\android-app"
```

to:

```powershell
$AndroidPath = Join-Path $ProjectRoot "mobile"
```

and change both invocation lines:

```powershell
    .\gradlew.bat lint
```
```powershell
        bash ./gradlew lint
```

to:

```powershell
    .\gradlew.bat :androidApp:lintDebug
```
```powershell
        bash ./gradlew :androidApp:lintDebug
```

`scripts/lint-mobile.bat` is unchanged (it only forwards to `lint-mobile.ps1`, no path/module references of its own).

- [ ] **Step 5: Verify the updated shell script locally**

Run: `./scripts/lint-mobile.sh`
Expected: `Running Android Lint...` then a clean Gradle `lintDebug` run (`BUILD SUCCESSFUL`), then `Done.`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "ci(mobile): repoint Android job to mobile/androidApp, add iOS build+test job"
```

---

### Task 7: Final gate, summary doc, progress ledger update

**Files:**
- Create: `docs/audit/mobile-redesign-m4-cleanup-summary.md`
- Modify: `.superpowers/sdd/progress.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing — terminal task.

- [ ] **Step 1: Run the full gate from `mobile/`**

```bash
cd mobile
./gradlew :androidApp:assembleDebug :androidApp:lintDebug \
  :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 \
  :shared:testDebugUnitTest :shared:lintDebug
```

Expected: `BUILD SUCCESSFUL` for the whole invocation, 0 lint errors in both modules.

- [ ] **Step 2: Push the branch and confirm CI is green**

```bash
git push -u origin redesign/m4-mobile-cleanup
```

Then check the GitHub Actions run for this push: `build-android` and `build-ios` (new/renamed jobs from Task 6) and `ci-success` must all report success.

- [ ] **Step 3: Write the phase summary**

Create `docs/audit/mobile-redesign-m4-cleanup-summary.md` summarizing: the module rename (`mobile/android-app` → `mobile/` + `mobile/androidApp`), the full list of deleted files/dependencies (Tasks 1, 2, 4), the new Settings entry point (Task 3), and the CI changes (Task 6) — follow the structure of `docs/audit/mobile-redesign-m3-kiosk-mode-summary.md` (read it first for the established format: scope recap, per-task outcomes, final gate results, any accepted backlog items).

- [ ] **Step 4: Update the progress ledger**

Append a new section to `.superpowers/sdd/progress.md`, following the exact style of the existing `=== MOBILE REDESIGN M3 (Kiosk Mode) ===` section (one line per task: task number, commit hash(es), review verdict, one-sentence summary; a final line noting gate results; a closing line marking the branch ready for PR).

- [ ] **Step 5: Commit**

```bash
git add docs/audit/mobile-redesign-m4-cleanup-summary.md .superpowers/sdd/progress.md
git commit -m "docs(mobile): M4 cleanup summary + progress ledger"
git push
```

This is the last task of the mobile redesign's phase table (B → M1 → M2 → M3 → **M4**) — after this, hand off to `superpowers:finishing-a-development-branch` for the merge decision.
