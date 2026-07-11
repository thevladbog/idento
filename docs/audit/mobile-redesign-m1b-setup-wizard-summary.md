# Фаза M1b — Mobile setup wizard: итоговая сводка (2026-07-11)

Ветка: `redesign/m1b-setup-wizard` (от `origin/main` @ `5f8586e`, план закоммичен
как `94ecf3e`). Задачи 1-9 (провижининг станции, все 6 экранов мастера
настройки, nav-graph) выполнены и слиты в эту ветку. Задача 10 (этот документ)
— финальный верификационный гейт.

**Push/PR не выполнялись** — по инструкции это финальный шаг, который делает
отдельный процесс после сквозного code review всей ветки.

`git diff --stat 5f8586e..HEAD` (12 коммитов, от `94ecf3e` до `ffbdf46`
включительно): 31 файл, +5046/-6 строк — почти целиком аддитивно (6 новых
экранов + 6 вьюмоделей + draft/preferences/i18n/nav-graph инфраструктура),
единственные удаления — точечные правки существующих `Strings.kt`/`App.kt`/
`IdentoNavHost.kt`/`Screen.kt`.

## (a) Что добавлено, по задачам

| Задача | Что добавлено | Ключевые файлы |
|---|---|---|
| **1. StationConfig persistence + draft** | `StationConfigPreferences` (DataStore, по ключу на поле, паттерн `AuthPreferences`/`AppPreferences`) + `SetupWizardDraft` (Koin single, мутируемое состояние мастера по всем шагам) + `toStationConfig(deviceNumber, staffName)` с валидацией | `data/preferences/StationConfigPreferences.kt`, `presentation/setup/SetupWizardDraft.kt` |
| **2. i18n мастера** | 43 новых `StringKey` (EN+RU, все строки 6 экранов) + `StringsCompletenessTest.kt` (гарантирует, что каждый ключ есть в обеих локалях) | `data/localization/Strings.kt`, `StringsCompletenessTest.kt` |
| **3. SetupLoginScreen (экран 1/6)** | QR-путь (`provisionStation` напрямую по токену) + путь менеджера (email/password, `AuthRepository.login`); оба пути персистят токен и ведут в `NextStep` | `presentation/setup/SetupLoginScreen.kt`, `SetupLoginViewModel.kt` |
| **4. SetupEventScreen (только путь менеджера)** | Выбор мероприятия из списка + self-mint (`createProvisioningToken`) и redeem (`provisionStation`) того же токена, которым QR-путь пользуется готовым | `presentation/setup/SetupEventScreen.kt`, `SetupEventViewModel.kt` |
| **5. SetupModeScreen (экран 3/6, шаг 2/4)** | 3 `SelectableCard` на `StationMode` (REGISTRATION/ZONE_CONTROL/KIOSK), чисто локальный выбор в `draft.mode`, без сетевых вызовов | `presentation/setup/SetupModeScreen.kt`, `SetupModeViewModel.kt` |
| **6. SetupDayZoneScreen (экран 4/6, шаг 3/4)** | День+точка работы с ветвлением по режиму: KIOSK без пилюль дней + только registration-зоны; REGISTRATION — дни + только registration-зоны; ZONE_CONTROL — дни + все зоны без фильтра + пропуск шага «Принтер» (`shouldSkipPrinterStep()`) | `presentation/setup/SetupDayZoneScreen.kt`, `SetupDayZoneViewModel.kt` |
| **7. SetupPrinterScreen (экран 5/6, шаг 4/4)** | 3 вкладки (Bluetooth/Ethernet/QR) через `ModeSegmentedControl`, autoprint-тумблер, тестовая печать; экран недостижим для ZONE_CONTROL (пропущен Задачей 6) | `presentation/setup/SetupPrinterScreen.kt`, `SetupPrinterViewModel.kt` |
| **8. SetupCompleteScreen + Exit station** | Персистит `StationConfig` (`finish()`) через `StationConfigPreferences.save`, обнуляет draft; «Выйти со станции» (`exitStation()`) чистит и `StationConfig`, и auth-сессию | `presentation/setup/SetupCompleteScreen.kt`, `SetupCompleteViewModel.kt` |
| **9. Nav-graph + восстановление сессии** | 6 новых маршрутов (`SetupLogin/Event/Mode/DayZone/Printer/Complete`) добавлены аддитивно в `Screen.kt`/`IdentoNavHost.kt`; `App.kt` резолвит стартовый экран (`resolveStartDestination`) по `StationConfigPreferences`+`AuthPreferences.isLoggedIn()` до первой композиции `NavHost` | `presentation/navigation/{Screen,IdentoNavHost}.kt`, `App.kt` |
| **10. Финальная верификация + сводка** | Полный гейт (8 команд), ручная трассировка ветвления по всем 3 режимам, этот документ | `docs/audit/mobile-redesign-m1b-setup-wizard-summary.md` |

## (b) Результаты гейта (Задача 10, Шаг 1)

Все 8 команд выполнены из `mobile/android-app` на реальном окружении (Java 17).

| Команда | Результат | Детали |
|---|---|---|
| `./gradlew :shared:compileDebugKotlinAndroid` | ✅ **BUILD SUCCESSFUL** (699ms) | 17 tasks, 1 executed / 16 up-to-date |
| `./gradlew :shared:compileKotlinIosSimulatorArm64` | ✅ **BUILD SUCCESSFUL** (633ms) | 11 tasks, 2 executed / 9 up-to-date |
| `./gradlew :shared:compileKotlinIosArm64` | ✅ **BUILD SUCCESSFUL** (632ms) | 11 tasks, 2 executed / 9 up-to-date |
| `./gradlew :shared:compileTestKotlinIosSimulatorArm64` | ✅ **BUILD SUCCESSFUL** (718ms) | 18 tasks, 3 executed / 15 up-to-date |
| `./gradlew :shared:testDebugUnitTest` | ✅ **BUILD SUCCESSFUL** (647ms) | **55/55 тестов прошли**, 0 failures/errors, в 14 классах (подтверждено прямым парсингом `TEST-*.xml`): `NetworkConfigTest`(3), `StationConfigTest`(2), `StationRepositoryTest`(2), `PendingZoneCheckInTest`(2), `SqlDelightOfflineDatabaseTest`(3), `StringsCompletenessTest`(1), `SetupStartDestinationTest`(3), `SetupWizardDraftTest`(6), `SetupLoginViewModelTest`(5), `SetupEventViewModelTest`(7), `SetupModeViewModelTest`(1), `SetupDayZoneViewModelTest`(6), `SetupPrinterViewModelTest`(9), `SetupCompleteViewModelTest`(5) |
| `./gradlew :shared:lintDebug` | ✅ **BUILD SUCCESSFUL** (808ms) | **0 errors, 25 warnings** (подтверждено прямым парсингом `lint-results-debug.xml`) — эта цель не входила в гейт M1a, поэтому базового значения для сравнения нет; зафиксировано как новый базовый уровень для M1c |
| `./gradlew :app:assembleDebug` | ✅ **BUILD SUCCESSFUL** (949ms, up-to-date) | APK подтверждён на диске: `app/build/outputs/apk/debug/app-debug.apk`, 49 265 599 байт |
| `./gradlew :app:lintDebug` | ✅ **BUILD SUCCESSFUL** (1s) | **0 errors, 142 warnings** (подтверждено прямым парсингом `lint-results-debug.xml`) |

**Сравнение с базовым значением M1a** (`docs/audit/mobile-redesign-m1a-foundation-summary.md`,
раздел (b): «0 errors, 142 warnings»): **142 warnings — ровно то же число, без
единого дрейфа**. За всю фазу M1b не появилось ни одного нового
Android-lint-предупреждения в `:app`, несмотря на добавление 6 новых экранов и
6 новых вьюмоделей поверх M1a — весь новый код живёт в `:shared`, `:app`
физически не менялся в M1b (в этом гейте `:app` UP-TO-DATE-собирается ровно
на неизменных исходниках M1a).

Все 8 команд гейта — зелёные, без единого допущения «должно быть ок» — каждый
результат подтверждён либо явным `BUILD SUCCESSFUL` в выводе Gradle, либо (для
теста и линта) прямым чтением сгенерированных XML-отчётов.

Как и в M1a, полная сборка iOS-воркспейса (Xcode/CocoaPods) не входит в
обязательный гейт Задачи 10 брифа этой фазы и не переисследовалась заново;
потолок верификации для iOS остаётся на уровне компиляции Kotlin/Native
(`compileKotlinIosSimulatorArm64`/`compileKotlinIosArm64`/
`compileTestKotlinIosSimulatorArm64` — все три зелёные), как и задокументировано
в `mobile-toolchain-ceiling` (JetBrains-alpha `navigation-runtime` ломает
линковку `.framework`, не связано с кодом M1a/M1b).

## (c) Ручная трассировка ветвления (Задача 10, Шаг 2)

Compose UI-тестов в этом кодовом дереве нет (`commonTest` — только
unit/ViewModel-тесты, без Compose UI testing harness), поэтому проверка
сделана трассировкой реального шипящегося кода, а не пересказом плана.
Файл:строка ниже — точные ссылки на код на момент этого коммита.

### Общий вход (оба пути логина)

- `SetupLoginScreen.kt:53-59` — `LaunchedEffect(uiState.nextStep)`: `NextStep.Event` →
  `onNavigateToEvent()` (строка 55, только путь менеджера), `NextStep.Mode` →
  `onNavigateToMode()` (строка 56, путь QR).
- Wiring: `IdentoNavHost.kt:210-221` — `onNavigateToEvent` → `navController.navigate(Screen.SetupEvent.route)`
  (строка 213); `onNavigateToMode` → `navigate(Screen.SetupMode.route) { popUpTo(SetupLogin) { inclusive = true } }`
  (строки 215-219).

**Путь QR** (любой из 3 режимов): `SetupLoginViewModel.kt:111-121` `onQrTokenScanned()` →
`applyProvisioning()` (`SetupLoginViewModel.kt:141-154`) → `draft.eventId/eventName/deviceNumber/staffName`
проставлены из ответа, `nextStep = NextStep.Mode` (строка 153). Экран `SetupEventScreen` не
затрагивается вовсе.

**Путь менеджера** (любой из 3 режимов): `SetupLoginScreen.kt:210` (`ManagerLoginContent`)
→ `viewModel.signInAsManager()` → `SetupLoginViewModel.kt:123-139` — на успехе
`nextStep = NextStep.Event` (строка 133), без записи `draft.eventId` (мероприятие ещё не
выбрано). Далее — `SetupEventScreen.kt` (описание кода в разделе (d) ниже) → выбор
мероприятия (`SetupEventScreen.kt:106-131`, `onEventSelected` на строке 111) →
`SetupEventViewModel.kt:85-100` `onEventSelected()` → `redeemToken()` (строки 102-109) →
`applyProvisioning()` (строки 111-125) → `draft.eventId/eventName/deviceNumber/staffName`
проставлены, `provisioned = true` (строка 124). `SetupEventScreen.kt:52-54` —
`LaunchedEffect(uiState.provisioned)` → `onEventProvisioned()` (строка 53).
Wiring: `IdentoNavHost.kt:223-231` → `navigate(Screen.SetupMode.route) { popUpTo(SetupLogin) { inclusive = true } }`
(строки 225-229) — тот же `popUpTo`, что и у QR-пути, так что оба пути одинаково
не оставляют экраны логина/события в back stack.

**Оба пути сходятся** на `Screen.SetupMode` (`IdentoNavHost.kt:233-239`) с уже
известным `draft.eventId`/`eventName`/`deviceNumber`/`staffName`, но ещё не
выбранным `draft.mode` — именно это и проверяется тремя прогонами ниже.

### REGISTRATION

1. `SetupModeScreen.kt:80-101` — выбор `StationMode.REGISTRATION` через
   `SelectableCard` → `viewModel.onModeSelected(REGISTRATION)`
   (`SetupModeViewModel.kt:22-25`, пишет `draft.mode = REGISTRATION`, никаких
   сетевых вызовов). `onContinue` (строка 108) гейтится на `modeSelected`
   (строка 104) → `IdentoNavHost.kt:234-238` → `navigate(Screen.SetupDayZone.route)`.
2. `SetupDayZoneViewModel.kt:71` — `showDayPicker = draft.mode != StationMode.KIOSK`
   → `true` для REGISTRATION ⇒ `SetupDayZoneScreen.kt:92` рендерит `FilterChips`
   (пилюли дней) — **дни показаны**.
3. `SetupDayZoneViewModel.kt:104-113` — `mode != ZONE_CONTROL` ⇒
   `zonesResult.data.filter { it.isRegistrationZone }` (строка 109) — **только
   registration-зоны**.
4. Continue (`SetupDayZoneScreen.kt:158-169`) → `viewModel.shouldSkipPrinterStep()`
   (`SetupDayZoneViewModel.kt:83`: `draft.mode == StationMode.ZONE_CONTROL`) →
   `false` для REGISTRATION ⇒ `onNavigateToPrinter()` (строка 163) →
   `IdentoNavHost.kt:252-258` → `navigate(Screen.SetupPrinter.route)` (строка 254).
5. `SetupPrinterScreen.kt:166-173` — Continue гейтится на `hasPrinter`
   (`uiState.printer != null`, строка 75) → `onNavigateToDone()` (строка 169) →
   `IdentoNavHost.kt:253-257` → `navigate(Screen.SetupComplete.route)` (строка 255).
6. `SetupCompleteScreen.kt:67` — `LaunchedEffect(Unit) { viewModel.finish() }` персистит
   `StationConfig`.

**Итоговая последовательность REGISTRATION: Login → (Event, только путь
менеджера) → Mode → DayZone (дни + только registration-зоны) → Printer →
Complete — подтверждено кодом, совпадает со спецификацией §6.3.**

### ZONE_CONTROL

1. `SetupModeScreen.kt` → `viewModel.onModeSelected(ZONE_CONTROL)` → `draft.mode = ZONE_CONTROL`
   → `IdentoNavHost.kt:236` → `Screen.SetupDayZone`.
2. `SetupDayZoneViewModel.kt:71` — `draft.mode != KIOSK` ⇒ `showDayPicker = true` —
   **дни показаны** (как и для REGISTRATION).
3. `SetupDayZoneViewModel.kt:106-107` — `mode == ZONE_CONTROL` ⇒ `zonesResult.data`
   без фильтра — **все зоны, без фильтрации**.
4. Continue → `shouldSkipPrinterStep()` (`SetupDayZoneViewModel.kt:83`) → `draft.mode == ZONE_CONTROL`
   ⇒ **`true`** ⇒ `SetupDayZoneScreen.kt:163` вызывает `onNavigateToDone()` напрямую
   (`SetupPrinterScreen` не задействуется вообще) → `IdentoNavHost.kt:241-250` →
   `onNavigateToDone` → `navigate(Screen.SetupComplete.route)` (строка 247).
5. `SetupCompleteScreen.kt` — как выше.

**Итоговая последовательность ZONE_CONTROL: Login → (Event, только путь
менеджера) → Mode → DayZone (дни + все зоны) → Complete напрямую (Printer
пропущен) — подтверждено кодом: `SetupPrinterScreen`/`SetupPrinterViewModel`
физически не инстанцируются на этом пути ни разу, `IdentoNavHost.kt` не
содержит никакого альтернативного маршрута в `Screen.SetupPrinter` для этого
режима — совпадает со спецификацией §6.3.**

### KIOSK

1. `SetupModeScreen.kt` → `viewModel.onModeSelected(KIOSK)` → `draft.mode = KIOSK`
   → `IdentoNavHost.kt:236` → `Screen.SetupDayZone`.
2. `SetupDayZoneViewModel.kt:71` — `draft.mode != KIOSK` ⇒ `false` для KIOSK
   ⇒ `showDayPicker = false` ⇒ `SetupDayZoneScreen.kt:92` — блок `FilterChips`
   не рендерится вовсе — **дни НЕ показаны** (пилюль нет); заголовок экрана
   также переключается на `StringKey.SETUP_STEP_WORKPOINT_ONLY_TITLE`
   (`SetupDayZoneScreen.kt:82`). Также `SetupDayZoneViewModel.kt:88-89` —
   `if (draft.mode == KIOSK) emptyList()` — дни даже не запрашиваются у
   `EventDaysCalculator`.
3. `SetupDayZoneViewModel.kt:104-113` — `mode != ZONE_CONTROL` (KIOSK попадает
   в тот же `else`-филиал, что и REGISTRATION) ⇒
   `zonesResult.data.filter { it.isRegistrationZone }` — **только
   registration-зоны** (как и REGISTRATION).
4. Continue → `shouldSkipPrinterStep()` → `draft.mode == ZONE_CONTROL` ⇒ `false`
   для KIOSK ⇒ `onNavigateToPrinter()` → `Screen.SetupPrinter` (та же цепочка,
   что и REGISTRATION).
5. `SetupPrinterScreen.kt` → `onNavigateToDone()` → `Screen.SetupComplete`.

**Итоговая последовательность KIOSK: Login → (Event, только путь менеджера) →
Mode → DayZone (дней НЕТ, только registration-зоны) → Printer → Complete —
подтверждено кодом, совпадает со спецификацией §6.3.**

### Сводная таблица (для быстрой сверки)

| Режим | Дни на DayZone | Зоны на DayZone | Следующий экран после DayZone |
|---|---|---|---|
| REGISTRATION | показаны | только `isRegistrationZone` | Printer |
| ZONE_CONTROL | показаны | все, без фильтра | **Complete напрямую** |
| KIOSK | **не показаны** | только `isRegistrationZone` | Printer |

Все ветвления живут исключительно в `SetupDayZoneViewModel`/`SetupDayZoneScreen`
(единственное место, где `draft.mode` читается для навигационных решений после
`SetupModeScreen`) — `IdentoNavHost.kt` не содержит собственной ветки по
`StationMode` для маршрутов `SetupDayZone`/`SetupPrinter`/`SetupComplete`,
только по boolean-колбэкам, которые сама `SetupDayZoneScreen` вызывает
по-разному в зависимости от `shouldSkipPrinterStep()`. Дублирования логики
ветвления между экраном и nav-graph нет.

## (d) Два сходящихся пути логина — и почему они сходятся именно так

- **QR-путь** (по умолчанию на `SetupLoginScreen`): сканируется QR-код станции,
  внутри — provisioning-токен, уже привязанный к конкретному мероприятию на
  backend (`station_provisioning_tokens.event_id`, Фаза B, Задача 4). Экран
  сразу вызывает `provisionStation(token, ...)` (`SetupLoginViewModel.kt:114`,
  seam `StationProvisioner`) — мероприятие **уже зафиксировано токеном**,
  поэтому экран выбора мероприятия (`SetupEventScreen`) для этого пути не
  нужен и не показывается вовсе (`NextStep.Mode`, минуя `NextStep.Event`).
- **Путь менеджера** (переключатель на том же экране): менеджер логинится
  своими email/password (`AuthRepository.login`, обычная сессия). Токен
  провижининга для конкретного мероприятия при этом ещё не существует —
  менеджер должен сначала **выбрать**, для какого мероприятия ставится эта
  станция. Поэтому путь ведёт на `SetupEventScreen`, где менеджер выбирает
  мероприятие из своего списка (`EventLister.getEvents()`), и тем же самым
  вызовом `provisionStation`, что и QR-путь, но токен для него **самомнётся
  прямо здесь** — `createProvisioningToken(eventId, staffUserId)`
  (`SetupEventViewModel.kt:37`, backend Фазы B Задача 4,
  `POST /api/stations/provisioning-tokens`), а затем немедленно редимится
  (`redeemToken`, строки 102-109). По сути менеджер **сам себе печатает** тот
  же QR-токен, который в первом пути сканируется камерой, и тут же его
  «сканирует» программно.
- После редима оба пути идентичны с точностью до байта: `staffJwt` из ответа
  `provisionStation` персистится через `AuthTokenSaver.saveAuthToken`
  (заменяя собой сессионный токен менеджера — начиная с этого момента
  приложение говорит с backend как станция, а не как вошедший менеджер),
  `draft.eventId/eventName/deviceNumber/staffName` проставлены из
  `ProvisionStationResponseDto.stationConfig`, и оба ведут на `Screen.SetupMode`
  с одним и тем же `popUpTo(SetupLogin) { inclusive = true }` — так что откуда
  бы пользователь ни зашёл, кнопка «назад» с экрана Mode никогда не вернёт его
  ни к логину, ни к выбору мероприятия.

## (e) Паттерн тестируемых швов (testability seams) — новая архитектурная практика этой фазы

Обнаружено ещё в Задаче 3 (см. `.superpowers/sdd/progress.md`, запись Task 3
секции M1b) и подтверждено на каждой последующей задаче: **ни один из классов,
на которые опираются вьюмодели мастера настройки, не тестируем напрямую из
`commonTest`** — `StationRepository`, `AuthRepository`, `EventRepository`,
`ZoneRepository`, `AuthPreferences`, `StationConfigPreferences`,
`BluetoothPrinterService`, `EthernetPrinterService` — все они простые
(не-`open`) классы, оборачивающие платформенные `expect`/`actual`-синглтоны
(`DataStoreFactory`, `SecureStore`) — и, что важнее всего, `ApiClient`
жадно (eagerly) строит настоящий живой Ktor `HttpClient` **в момент
конструирования**, без какого-либо mock-engine шва где бы то ни было в этом
кодовом дереве. Их нельзя ни сконструировать, ни унаследовать в тесте.

Решение, установившееся как стандарт по всей фазе: для каждой вьюмодели,
которой нужен доступ к такому классу, объявляется **маленький локальный шов**
прямо в файле вьюмодели — `fun interface` (для одного метода) либо обычный
`interface` (когда нужно больше одного метода, как `StationConfigGateway` в
Задаче 8 с `save`+`clear`). Продакшн-код связывает эти швы с реальными
репозиториями/preferences через method references в Koin-модуле
(`di/ViewModelModule.kt`), а юнит-тесты подставляют тривиальные локальные
фейки того же интерфейса — никакого mocking-фреймворка не требуется.

Швы, введённые за фазу (не дублируются, где форма совпадает):
- `StationProvisioner`, `ManagerAuthenticator`, `AuthTokenSaver` — введены в
  `SetupLoginViewModel.kt` (Задача 3); `StationProvisioner`/`AuthTokenSaver`
  переиспользованы как есть в `SetupEventViewModel.kt` (Задача 4) — тот же
  провижининг-раунд-трип.
- `EventLister`, `ProvisioningTokenMinter`, `CurrentUserIdProvider` — новые в
  `SetupEventViewModel.kt` (Задача 4).
- `EventLoader`, `ZoneLister`, `EventDaysCalculator` — новые в
  `SetupDayZoneViewModel.kt` (Задача 6); `EventLoader` не переиспользует
  `EventLister` из Задачи 4, потому что нужна другая сигнатура
  (`getEvent(eventId)` вместо `getEvents()`) — это два разных шва, а не
  дублирование одного. `EventDaysCalculator` нужен, даже несмотря на то что
  `ZoneRepository.getEventDays` — чистая не-suspend функция без сетевого
  вызова, просто чтобы конструктор вьюмодели не держал конкретный тип
  `ZoneRepository` (тот всё равно не собирается в `commonTest` из-за живого
  `HttpClient`).
- `BluetoothPrinterGateway` (обычный interface, 2 метода),
  `EthernetPrinterGateway` (`fun interface`) — новые в
  `SetupPrinterViewModel.kt` (Задача 7).
- `StationConfigGateway` (обычный interface, `save`+`clear`),
  `AuthLogoutGateway` (`fun interface`, `clearAuth`) — новые в
  `SetupCompleteViewModel.kt` (Задача 8).

**Заметка для будущих фаз (M1c, M2, M3):** этот паттерн, скорее всего,
понадобится снова для любых новых вьюмоделей, зависящих от тех же
непереопределяемых классов данных/платформы. Стоит рассмотреть консолидацию
(например, общий модуль `testing-seams` с переиспользуемыми интерфейсами вроде
"вызов, возвращающий `ApiResult<T>`"), но это не обязательно — текущий
локальный-по-файлу подход работает и не создаёт связности между экранами,
которым это не нужно.

## (f) `dayDate: String?` вместо `LocalDate?` спецификации — намеренное отклонение (перенесено из M1a, переподтверждено)

`StationConfig.dayDate` (`data/model/StationConfig.kt:24`) и
`SetupWizardDraft.dayDate` (`presentation/setup/SetupWizardDraft.kt:24`) —
оба `String?` (ISO `"YYYY-MM-DD"`), а не иллюстративный `LocalDate?` из
дизайн-спеки. Это то же самое отклонение, что было впервые принято и
задокументировано в фазе M1a (в доменных verdict-моделях, Задача 4 M1a) —
`kotlinx-datetime` не подключён как зависимость проекта, и вводить его ради
одного nullable-поля не оправдано; вся остальная работа с датами в мастере
(`SetupDayZoneViewModel.getEventDays`, day-пилюли) уже оперирует `String` в
том же ISO-формате без парсинга в `LocalDate`. Проверено заново в ходе этой
фазы (Задачи 1 и 6 M1b используют `dayDate`/`getEventDays` именно как строки
сквозь весь стек) — поведение не изменилось, отклонение остаётся в силе.

## (g) Явное решение убрать runtime-поле «адрес сервера» из пути менеджера

Зафиксировано **до** написания плана этой фазы (2026-07-11, см.
`.superpowers/sdd/progress.md`, секция «PHASE M1b», первая строка: «Pre-flight
decision made before plan authoring»): путь логина менеджера на
`SetupLoginScreen` — **только email+password**, без какого-либо
runtime-настраиваемого поля адреса backend-сервера. Проверено в ходе этой
фазы: ни в `SetupLoginUiState`, ни в `SetupLoginViewModel`, ни в
`ManagerLoginContent` действительно нет ни одного поля, поля ввода или
состояния, связанного с URL сервера — только `email`/`password`.

Причина: это прямое следствие MOBILE-SEC-01 harding'а, сделанного раньше в
этой же сессии (см. `.superpowers/sdd/progress.md`, секция «MOBILE BATCH»,
коммиты `41d6a94`/`c03c753`/`ecda80a`) — `network_security_config` теперь
запрещает cleartext-трафик, а базовый URL резолвится на build-time
(`BuildConfig.BASE_URL`) в prod-HTTPS, а не на runtime. Разрешить пользователю
вводить произвольный сервер прямо в UI мастера настройки заново открыло бы
именно тот класс атак, который MOBILE-SEC-01 закрывал — cleartext-подмену
адреса или редирект на подконтрольный атакующему хост. Это решение стоит
пересмотреть, когда отдельная инициатива dual-distribution (on-prem) определит,
как мобильный клиент должен таргетироваться на клиентский сервер — до тех пор
эта фаза сознательно не даёт мастеру настройки такой возможности.

## (h) Что `SetupCompleteScreen` — заглушка, и для чего именно

`SetupCompleteScreen`/`SetupCompleteViewModel` (Задача 8) — это **не**
финальный домашний экран станции ни для одного из трёх режимов. Согласно
собственному kdoc `SetupCompleteViewModel.kt:42-47`: это placeholder «станция
готова», единственная функция которого в рамках M1b — (1) реально
персистировать `StationConfig`, собранный из `draft` (`finish()`,
`SetupCompleteViewModel.kt:66-73`), и (2) дать возможность выйти со станции
(`exitStation()`, строки 75-81), сбрасывая и `StationConfig`, и auth-сессию.
Экран показывает только сводку (`StatusBar`/`DetailTable` — режим, мероприятие,
точка работы, номер устройства, день, принтер, autoprint) — никакой реальной
функциональности регистрации/контроля зоны/киоска здесь нет и не планировалось.

Последующие фазы заменят этот экран целиком:
- **M1c (Registration mode)** — реальный экран регистрации (сканирование,
  рендер `RegistrationVerdict` через `VerdictBand`/`DetailTable`/`ActionStack`
  из M1a Задачи 3, список/поиск участников).
- **M2 (Zone Control mode)** — реальный экран контроля зоны (`ZoneVerdict`,
  та же verdict-инфраструктура).
- **M3 (Kiosk mode)** — реальный киоск-экран саморегистрации.

Ни один из этих трёх домашних экранов не входит в объём M1b — этот план
собирал только сам мастер настройки (провижининг + выбор режима/дня/зоны/
принтера), а не то, что происходит после него.

**Важно — конкретное следствие, обнаруженное итоговым ревью всей ветки
(не отдельной задачей): слияние этой ветки делает уже рабочий с M1a
флоу Login→Events→Checkin недостижимым до выхода M1c.** До этой фазы
`App.kt` монтировал `IdentoNavHost()` без аргументов, что по умолчанию
стартовало с `Screen.Login.route` — именно так пользователь попадал в
полностью рабочий (хоть и на старом контракте) флоу
Login→Events→Checkin/AttendeesList/QRScanner/Settings, который до сих пор
реально грузится и работает на обеих платформах. Задача 9 заменила это на
`resolveStartDestination(hasStationConfig, isLoggedIn)`, который возвращает
**только** `Screen.SetupLogin` или `Screen.SetupComplete` — никогда
`Screen.Login`. Маршруты `Screen.Login`/`Screen.Events` и их
`composable(...)`-блоки в `IdentoNavHost.kt` физически остались (не
удалены), но с этой фазы на них никто не переходит: единственное действие
на `SetupCompleteScreen` — «Выйти со станции», которое ведёт обратно на
`SetupLogin`, не на старый флоу. Итог: после слияния этой ветки
приложение можно настроить (мастер работает целиком), но станцией нельзя
реально воспользоваться для чек-ина ни в одном режиме, пока не выйдет
M1c (Задача, которая заменит `SetupCompleteScreen` реальным экраном
режима «Регистрация»). Это **не** случайная регрессия и не пропущенный
баг — это прямое, неизбежное следствие того, что M1 был осознанно
разбит на M1a/M1b/M1c при планировании, и M1b по построению не может
оставить рабочий путь к чек-ину, потому что стартовый экран теперь один
на двоих (мастер), а не два параллельных (старый флоу + новый). Решение —
не строить временный мост к старому (Login/Events/Checkin) флоу: он на
уже выводимом из эксплуатации контракте, и мост стал бы одноразовой
работой, которую придётся выбросить сразу после M1c. Открытый пункт,
требующий срочного продолжения: **M1c должен быть следующим планом без
промедления** — до его слияния у станции физически нет пути к
использованию по назначению.

## (i) Реальные баги/пробелы, найденные и исправленные в ходе ревью задач этой фазы

Ниже — честный перечень (не «что-то было найдено и исправлено», а конкретно
что и где), взятый из `.superpowers/sdd/progress.md`, секция «PHASE M1b»:

1. **Задача 4 (`e587e63`) — не персистился `staffJwt` после провижининга.**
   Бриф Задачи 4 в примере кода не сохранял `response.staffJwt` после
   успешного `provisionStation()`, хотя собственная строка брифа «Produces»
   требовала этого. Имплементер сам нашёл это расхождение между кодом-примером
   и описанием и добавил сохранение + ветку ошибки. Ревьюер отдельно
   проверил backend-семантику JWT (`GetUserTenantRole` в момент провижининга
   == в момент логина для собственного пути менеджера) и подтвердил, что это
   исправление корректности/консистентности (свежий JWT на 72ч с теми же
   claims), а не проблема прав доступа.
2. **Задача 7 (`c9c6736` + фикс `16fc84b`) — Continue срабатывал без
   настроенного принтера + отсутствовало поле имени Ethernet-принтера.**
   Кнопка Continue на `SetupPrinterScreen` изначально срабатывала безусловно,
   несмотря на то что принтер обязателен для обоих режимов, реально
   достигающих этого экрана (REGISTRATION/KIOSK — ZONE_CONTROL его пропускает
   по Задаче 6). Исправлено гейтом `hasPrinter` (`uiState.printer != null`),
   по тому же no-op-паттерну, что уже был установлен на `SetupModeScreen`.
   Отдельно: имя Ethernet-принтера по умолчанию было просто сырым IP-адресом —
   добавлено отдельное поле имени (`SETUP_PRINTER_ETHERNET_NAME_LABEL`) плюс
   исправлена несогласованность в doc-комментарии («пятый экран» vs «шестой»).
3. **Задача 8 (`15d2092` + фикс `6a03c3d`) — отсутствовала обработка ошибок на
   реальной точке персистентности.** `finish()`/`exitStation()` изначально не
   имели вообще никакой обработки исключений: необработанное исключение при
   валидации черновика (`draft.toStationConfig`) уронило бы всё приложение;
   сбой `clear()`/`clearAuth()` тихо оставил бы пользователя в
   рассогласованном состоянии без обратной связи. Исправлено добавлением
   `CoroutineExceptionHandler` + состояния ошибки — тот же паттерн, что уже
   стандартен во всех остальных вьюмоделях этой фазы (`SetupLoginViewModel`,
   `SetupEventViewModel`, `SetupDayZoneViewModel` и т.д., все объявляют такой
   же `exceptionHandler`).

4. **Итоговое ревью всей ветки (`c6fc45e`) — необработанный QR-адрес принтера
   валил тест печати без обратной связи.** `SetupPrinterViewModel.testPrint()`
   безусловно деструктурировал `printer.address.split(":", limit=2)` для
   не-Bluetooth принтеров; вкладка Ethernet-ввода всегда строит корректный
   `"ip:port"`, но вкладка QR-скана принимает **любой** декодированный
   `PrinterConfig` без валидации — payload вида `{"address":"192.168.1.50"}`
   (без порта) проходил и затем валил `IndexOutOfBoundsException`/
   `NumberFormatException` при нажатии «Пробная печать». Исключение ловилось
   существующим `exceptionHandler` и выставляло `uiState.error`, но
   `SetupPrinterScreen.kt` нигде не отображал `error` (в отличие от всех
   остальных экранов мастера) — сбой тихо проглатывался, кнопка просто
   возвращалась в состояние ожидания. Исправлено: безопасный разбор адреса/
   порта с явным `error`-состоянием вместо необработанного исключения, плюс
   добавлен блок отображения `uiState.error` на `SetupPrinterScreen` (по
   образцу уже существующих на других экранах мастера).

Дополнительно (не баг, но зафиксированное по итогам ревью решение о
неточности отчёта имплементера, не влияющее на код): Задача 6 — имплементер
заявил 7 тестов, по факту оказалось 6; чисто отчётная неточность, кода это не
касалось.

Также подтверждено на Задаче 7 (упреждающий вопрос из брифа этой Задачи 10):
iOS-поведение вкладки Bluetooth **не потребовало специального случая** —
`BluetoothPrinterService`'s iOS `actual` уже безопасно деградирует
(`runCatching { emptyList() }`, `isBluetoothEnabled` всегда `false`, никогда
не бросает исключение) — вкладка Bluetooth на iOS просто всегда рендерит
`SETUP_PRINTER_NONE_PAIRED`, без единой ветки `if (Platform.isIOS)` в коде
экрана. Это подтверждено повторно в ходе написания этого документа прямым
чтением doc-комментария `SetupPrinterScreen.kt:61-65` — ничего не изменилось
по сравнению с тем, что было решено на самой Задаче 7.

## (j) Известные ограничения (честно, без прикрас)

- **Нет UI-test harness.** В этом кодовом дереве нет ни Compose UI testing
  (`createComposeRule` и т.п.), ни какого-либо end-to-end фреймворка для
  мобильного клиента — верификация ограничена компиляцией (4 таргета) +
  unit/ViewModel-тестами (`commonTest`, 55 тестов) + ручной трассировкой кода
  (раздел (c) выше). Ни один из шести экранов мастера ни разу не был реально
  отрендерен и провзаимодействован автоматизированным тестом в рамках этой
  фазы — только вручную прочитан и прослежен по коду.
- **Полная сборка iOS-приложения в симуляторе не проверялась** (см. конец
  раздела (b)) — потолок верификации iOS такой же, как был зафиксирован в
  M1a, регрессий в этой фазе не внесено (те же 3 Kotlin/Native-таргета
  компилируются зелёными).
- **`:shared:lintDebug`** — новая для этого гейта цель (в M1a-гейте её не
  было, только `:app:lintDebug`); 25 предупреждений зафиксированы как новый
  базовый уровень, без сравнения — сравнивать не с чем.

## Итог

Все 8 обязательных команд гейта (Шаг 1) — зелёные, `:app:lintDebug` (142
warnings, 0 errors) совпадает с базовым значением M1a один в один, без
дрейфа. Ручная трассировка ветвления (Шаг 2) подтвердила точное соответствие
спецификации §6.3 для всех трёх режимов `StationMode`, файл-в-файл, до
конкретных строк кода, включая реальную проверку `IdentoNavHost.kt`'s
wiring, а не пересказ плана. Мастер настройки станции (6 экранов, оба пути
входа, все три режима) — рабочий, готов к финальному сквозному ревью всей
ветки.
