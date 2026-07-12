# Mobile Redesign M4 — Module Restructure & Dead Code Cleanup: дизайн-документ

Дата: 2026-07-12. Статус: одобрен пользователем (все секции).

Источник: `docs/superpowers/specs/2026-07-10-mobile-refactor-redesign-design.md`, §10, строка M4: «Удаление `mobile/android-app`, чистка мёртвого кода `:shared` (InMemoryAuthStorage, createPlatformHttpClient, старые VM), перенос CI на `:androidApp`». Это последняя фаза редизайна — фазы B, M1, M2, M3 уже смержены в main (все 3 режима станции — Регистрация / Контроль зоны / Киоск — достижимы через новый UI `:shared`, который сейчас рендерится из `mobile/android-app`'s `MainActivity` через `setContent { App() }`).

## 1. Цель и рамки

Довести физическую структуру Gradle-проекта до вида, описанного в §3 основного дизайн-документа (`mobile/` как единый корень с модулями `:shared` + `:androidApp`), удалить весь код, оставшийся мёртвым после M1–M3, и обновить CI. Дополнительно (решение пользователя, см. §4) — закрыть обнаруженный по ходу разбора пробел: у Регистрации и Контроля зоны сейчас нет входа в Настройки/выход со станции.

**Явно закреплённые решения:**

| Вопрос | Решение |
|---|---|
| Реструктуризация модуля | Полная — физический перенос под `mobile/settings.gradle.kts` + `:androidApp`, старая `mobile/android-app/` удаляется |
| Экран Настроек | Не мёртвый — реально реализует §3f; довязать вход из Регистрации и Контроля зоны в этой фазе |
| CI для iOS | Добавить новую job на `macos-latest` в этой же фазе (сейчас iOS вообще не собирается в CI) |

**Не в скоупе:** новые экраны/функциональность сверх пробела из §4; изменение содержимого `SettingsScreen`/`SettingsViewModel` (они уже реализуют дизайн); светлая тема и BT-печать на iOS (не в скоупе всего редизайна, см. основной документ).

## 2. Текущее состояние (проверено чтением кода, не по памяти)

- `mobile/android-app/` — фактический Gradle-корень (`settings.gradle.kts` здесь), `rootProject.name = "Idento"`, модули `:app` (Android-приложение) и `:shared` (подключён путём `project(":shared").projectDir = file("../shared")`).
- `:app` уже тонкий: `MainActivity` — просто `setContent { App() }`, без Hilt-инъекций (`@AndroidEntryPoint` нигде не используется). `IdentoApplication` инициализирует Koin (`doInitKoin`) и запускает best-effort `LegacySessionMigration` (миграция JWT из старого Hilt-приложения в `:shared`'s `AuthPreferences` — используется, оставляем).
- Мёртвый код в `:app` (проверено grep'ом — используется только изнутри своего же файла или Hilt-модулей, которые сами никем не потребляются): `di/NetworkModule.kt`, `di/DataStoreModule.kt` (Hilt-модули, предоставляют Retrofit/OkHttp/DataStore — не читаются нигде, `@AndroidEntryPoint` в проекте не встречается), `data/api/{IdentoApi,AuthInterceptor}.kt`, `data/scanner/{HardwareScannerService,BluetoothScannerService}.kt` (заменены `:shared`'s `ScanSource`), `data/bluetooth/{BluetoothPrinterService,ZplImageText,BadgeTemplate}.kt`, `data/ethernet/EthernetPrinterService.kt` (заменены `:shared`'s `PrinterService`), `data/preferences/{Checkin,Printer,Scanner,Template}Preferences.kt`, `data/model/{CheckinRequest,LoginRequest,UpdateAttendeeRequest,Font}.kt`. `data/local/{CryptoManager,TokenManager}.kt` — `CryptoManager` используется `LegacySessionMigration` (оставляем), `TokenManager` мёртв (потреблялся только `NetworkModule`).
- `build.gradle.kts` (`:app` и корневой) тянут Hilt 2.58 + KSP + Retrofit/OkHttp/Gson + Room (нет ни одной `@Entity`/`@Dao`/`@Database` во всём модуле — Room полностью мёртв) — все эти плагины/зависимости не нужны после удаления вышеуказанных файлов.
- `AndroidManifest.xml` уже чистый (одна `MainActivity`), но содержит неиспользуемое разрешение `RECEIVE_BOOT_COMPLETED` (не зарегистрирован ни один `BroadcastReceiver` на этот интент).
- `:shared`: `InMemoryAuthStorage.kt` (0 внешних использований, заменён `AuthPreferences`+SecureStore) и `createPlatformHttpClient` (expect в `ApiClient.kt` + actual в android/iOS `ApiClient.*.kt` — объявлены, но `ApiClient`'s собственный `HttpClient { ... }` строится напрямую, `createPlatformHttpClient` нигде не вызывается) — оба явно названы в исходном дизайн-документе.
- «Старые VM» — весь дореформенный граф навигации, унаследованный до M1a: `presentation/{login,events,checkin,attendees,dayselect,template}/*` (`LoginViewModel`+`LoginScreen`, `EventsViewModel`+`EventsScreen`, `CheckinViewModel`+`CheckinScreen`, `AttendeesListViewModel`+`AttendeesListScreen`, `DaySelectViewModel`+`DaySelectScreen`, `TemplateEditorViewModel`+`TemplateEditorScreen`, `DisplayTemplateViewModel`+`DisplayTemplateScreen` — 7 экранов, 14 файлов). Проверено: `App.kt` всегда вызывает `IdentoNavHost(startDestination = resolvedStartDestination)`, а `resolveStartDestination()` может вернуть только `SetupLogin` / `RegistrationHome` / `ZoneControlHome` / `KioskHome` / `SetupComplete` — маршрут `Screen.Login` (дефолтный параметр `IdentoNavHost`) никогда не используется реальным приложением. Соответственно, недостижимы транзитивно: `Screen.Events`, `Screen.Checkin`, `Screen.AttendeesList`, `Screen.DaySelect`, `Screen.ZoneSelect`, `Screen.TemplateEditor`, `Screen.DisplayTemplate`, `Screen.BluetoothScannerSettings` (плейсхолдер), `Screen.QRScanner` (M3 уже удалила экран под этот маршрут, оставив только само определение route — тоже удаляется).
- Единственный код, ссылающийся на этот кластер извне себя самого — регистрация фабрик в `di/ViewModelModule.kt` и `composable{}`-блоки в `IdentoNavHost.kt` (оба тоже правятся).
- `presentation/settings/{SettingsScreen,SettingsViewModel}.kt` — НЕ мёртвый код: экран реально реализует §3f (Тема/Язык/Принтер/BT-сканер только Android, «Выйти со станции»). Но единственный путь к нему — из уже мёртвого `Screen.Events`, то есть на практике недостижим ни с одного из 3 живых экранов станции. `RegistrationHomeScreen`/`ZoneControlScreen` не имеют вообще никакого параметра навигации — только `KioskScreen` получила локальный `onExitStation` в M3. Параметр `SettingsScreen`'s `onNavigateToBluetoothScanner: () -> Unit = {}` нигде внутри самого экрана не вызывается — мёртвый параметр, будет просто убран при довязке.
- CI (`.github/workflows/ci.yml`): job `lint-android` — `continue-on-error: true`, гейтится на `paths-filter` `mobile/**`, запускает только `scripts/lint-mobile.sh` (`./gradlew lint` из `mobile/android-app`), кэш-ключ Gradle тоже завязан на `mobile/android-app/**`. iOS вообще не собирается в CI ни в каком виде.
- `mobile/iosApp/` не имеет путевых зависимостей от `mobile/android-app` — использует `mobile/shared` напрямую, перенос/удаление `android-app` его не затрагивает.

## 3. Реструктуризация модуля

**Итоговая структура** (соответствует §3 основного документа):

```
mobile/
├── settings.gradle.kts          # новый корень: rootProject.name = "Idento", include(":shared", ":androidApp")
├── build.gradle.kts             # перенесён из android-app/, Hilt/KSP-плагины убраны
├── gradle.properties
├── gradlew, gradlew.bat, gradle/
├── shared/                      # без изменений по расположению
└── androidApp/                  # было android-app/app/, модуль переименован :app → :androidApp
    ├── build.gradle.kts         # без Hilt/KSP/Retrofit/Room/Gson
    └── src/
        ├── main/java/com/idento/{IdentoApplication,MainActivity,LegacySessionMigration}.kt
        ├── main/java/com/idento/data/local/CryptoManager.kt   # используется LegacySessionMigration
        ├── main/AndroidManifest.xml                            # без RECEIVE_BOOT_COMPLETED
        ├── main/res/**                                         # без изменений
        └── debug/res/xml/network_security_config.xml
```

`mobile/android-app/` удаляется целиком после переноса. Неотслеживаемые scratch-файлы (`gate-output.txt`, `test-output.txt` — не в git) не переносятся.

`IdentoApplication.kt` теряет аннотацию `@HiltAndroidApp` и import `dagger.hilt.android.HiltAndroidApp` — больше ничего в классе не меняется (Koin-инициализация и вызов миграции уже не зависят от Hilt).

## 4. Вход в Настройки из Регистрации и Контроля зоны

`RegistrationHomeScreen` и `ZoneControlScreen` получают новый необязательный параметр `onNavigateToSettings: () -> Unit = {}` и кнопку-иконку (шестерёнка, `IconButton`) в верхней части экрана — видимую напрямую (не long-press, как у Киоска: эти экраны предназначены только для персонала, а не для публичного доступа посетителей, обфускация не нужна). `IdentoNavHost` подключает оба экрана к уже существующему `composable(Screen.Settings.route) { SettingsScreen(...) }` блоку, убирая мёртвый `onNavigateToBluetoothScanner` параметр (не имел вызовов внутри `SettingsScreen`) и добавляя `onNavigateBack = { navController.popBackStack() }` (уже есть в сигнатуре `SettingsScreen`, просто не был подключён к живому графу).

`KioskScreen` не получает этот параметр — Киоск уже имеет собственный сервисный выход (long-press по логотипу, M3), и `SettingsScreen` в принципе не предназначена для публичного экрана самообслуживания.

## 5. Удаление мёртвого кода

**`:shared`:**
- `data/storage/InMemoryAuthStorage.kt` — файл целиком.
- `data/network/ApiClient.kt` — убрать строку `expect fun createPlatformHttpClient(...)`. `androidMain/kotlin/com/idento/data/network/ApiClient.android.kt` и `iosMain/kotlin/com/idento/data/network/ApiClient.ios.kt` — проверено, каждый файл целиком состоит только из `actual fun createPlatformHttpClient(...)` и его импортов — оба файла удаляются целиком.
- `presentation/{login,events,checkin,attendees,dayselect,template}/` — все 6 пакетов целиком (14 файлов).
- `presentation/navigation/Screen.kt` — убрать `Login`, `Events`, `Checkin`, `AttendeesList`, `DaySelect`, `ZoneSelect`, `TemplateEditor`, `DisplayTemplate`, `BluetoothScannerSettings`, `QRScanner`.
- `presentation/navigation/IdentoNavHost.kt` — убрать соответствующие `composable{}`-блоки, приватную `PlaceholderScreen`. Единственный вызов `IdentoNavHost(...)` во всём проекте — `App.kt:93`, `IdentoNavHost(startDestination = resolvedStartDestination)`, значение передаётся всегда явно — параметр `startDestination` теряет дефолтное значение `= Screen.Login.route` целиком (становится обязательным).
- `di/ViewModelModule.kt` — убрать `factory { LoginViewModel(...) }`, `factory { EventsViewModel(...) }`, `factory { CheckinViewModel(...) }`, `factory { AttendeesListViewModel(...) }`, `factory { TemplateEditorViewModel(...) }`, `factory { DisplayTemplateViewModel(...) }` и соответствующие `import`.

**`:androidApp`** (бывший `:app`): `di/NetworkModule.kt`, `di/DataStoreModule.kt`, `data/api/`, `data/scanner/`, `data/bluetooth/`, `data/ethernet/`, `data/preferences/{Checkin,Printer,Scanner,Template}Preferences.kt`, `data/model/{CheckinRequest,LoginRequest,UpdateAttendeeRequest,Font}.kt`, `data/local/TokenManager.kt`. `build.gradle.kts` — убрать плагины `com.google.dagger.hilt.android`, `com.google.devtools.ksp`; убрать зависимости Hilt, Retrofit/OkHttp-logging-interceptor (OkHttp сам остаётся транспортом Ktor через `:shared`, но прямая зависимость `:androidApp` на `okhttp3:logging-interceptor`/`retrofit2:*` убирается), Gson, Room (`androidx.room:*`), `com.google.dagger:hilt-android`; убрать `resolutionStrategy.force("kotlin-metadata-jvm")` (был нужен только из-за Hilt). Корневой `build.gradle.kts` — убрать `com.google.dagger.hilt.android` и `com.google.devtools.ksp` из `plugins { ... apply false }`, если после чистки `:androidApp` не использует KSP ни для чего другого (не используется — Room был единственным потребителем).
`AndroidManifest.xml` — убрать `<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />`.

## 6. CI

`.github/workflows/ci.yml`:
- `changes` job — фильтр `mobile: ['mobile/**']` не меняется (путь `mobile/` не переименовывается).
- `lint-android` → переименован в `build-android` (теперь полноценный гейт, не только lint): убрать `continue-on-error: true`; шаги — `./gradlew :androidApp:assembleDebug`, `./gradlew :androidApp:lintDebug`, `./gradlew :shared:testDebugUnitTest`, working directory `mobile` (не `mobile/android-app`); кэш-ключ Gradle — `mobile/**/*.gradle*`, `mobile/gradle/wrapper/gradle-wrapper.properties`, путь кэша `mobile/.gradle`.
- Новая job `build-ios`, `runs-on: macos-latest`, `needs: changes`, `if: needs.changes.outputs.mobile == 'true'`: `xcodebuild`/Gradle-таргеты `:shared:compileKotlinIosSimulatorArm64`, `:shared:compileKotlinIosArm64`, `:shared:compileTestKotlinIosSimulatorArm64` (компиляция common/iOS-тестов), `:shared:iosSimulatorArm64Test` (или эквивалентная Kotlin/Native test-таска — проверить точное имя таски при реализации, т.к. `:shared:testDebugUnitTest` — Android-специфичная таска и для iOS не применяется). working directory `mobile`.
- `ci-success` — добавить `build-ios` в список `needs` с той же обработкой success-or-skipped, что и остальные условные job'ы.
- `scripts/lint-mobile.sh` — обновить `cd "$ROOT/mobile"` (было `mobile/android-app`), команду на `./gradlew :androidApp:lintDebug`. `lint-mobile.bat`/`.ps1` — аналогично (Windows-обёртки того же скрипта).

## 7. Тестирование и гейты

Как и в M1–M3, задача не добавляет новых commonTest-требований (чистка + структурная миграция, не новая бизнес-логика) — за исключением §4 (новый параметр навигации у 2 экранов), для которого нужен минимальный тест: `IdentoNavHost` действительно регистрирует переход из `Screen.RegistrationHome`/`Screen.ZoneControlHome` в `Screen.Settings` (по аналогии с существующим `SetupStartDestinationTest.kt`, либо через прямую проверку сигнатур composable-параметров, если nav-graph юнит-тестами напрямую не покрывается — проверить существующий паттерн тестирования навигации при планировании).

Финальный гейт фазы: `:androidApp:assembleDebug`, `:androidApp:lintDebug`, `:shared:compileKotlinIosSimulatorArm64` + `iosArm64` + `compileTestKotlinIosSimulatorArm64`, `:shared:testDebugUnitTest`, полная сборка CI зелёная на PR (включая новую `build-ios` job).

## 8. Риски и открытые вопросы

- Физический перенос директорий Gradle-модуля — механически рискованная операция (относительные пути в `settings.gradle.kts`, `local.properties`, IDE-кэши `.idea`/`.gradle`/`.kotlin` в `android-app/` не переносятся — это генерируемые артефакты). План должен явно проговорить порядок git-операций (`git mv` там, где применимо, для сохранения истории файлов).
- Точное имя Gradle-таски для запуска `:shared`'s commonTest на iOS-таргете в CI (Kotlin/Native tests запускаются иначе, чем JVM/Android `testDebugUnitTest`) — уточняется на этапе реализации по фактическому выводу `./gradlew :shared:tasks --all` в `androidMain`/`iosMain`-конфигурации.
- macOS-раннеры GitHub Actions медленнее и дороже линуксовых — `build-ios` гейтится тем же `paths-filter` на `mobile/**`, чтобы не запускаться на несвязанных PR.
