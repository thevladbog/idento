# Фаза M1a — Mobile foundation: итоговая сводка (2026-07-10)

Ветка: `redesign/m1a-foundation` (12 коммитов от `e7961a1`, включая этот
документ; локально на 12 коммитов впереди `origin/redesign/m1a-foundation`).
Задачи 1-10 (дизайн-токены, шрифт, компоненты, доменные модели, DTO/API/repo
слой для 6 backend-эндпоинтов Фазы B, SQLDelight, реальное сканирование камеры
на Android и iOS, переключение `:app` → `:shared`) выполнены и слиты в эту
ветку. Задача 11 (этот документ) — финальный верификационный гейт.

**Push/PR не выполнялись** — по инструкции это финальный шаг, который делает
отдельный процесс после сквозного code review всей ветки.

`git diff --stat e7961a1..HEAD` (до этого коммита): 81 файл, +1300/-7280 строк
— основная масса удалений (Задача 10) — это старый Hilt/Retrofit
presentation-слой `:app`, вытесненный `:shared`.

## (a) Что добавлено, по задачам

| Задача | Что добавлено | Ключевые файлы |
|---|---|---|
| **1. Design tokens** | 4 объекта токенов для тёмной UI: `IdentoColors` (20 цветов), `IdentoSpacing` (5 значений), `IdentoRadius` (7 значений), `IdentoTypeScale` (4 размера) | `shared/src/commonMain/.../theme/DesignTokens.kt` |
| **2. Шрифт Inter** | 5 начертаний (Regular/Medium/SemiBold/Bold/ExtraBold) как Compose-ресурсы + `identoFontFamily()` | `shared/src/commonMain/composeResources/font/*.ttf`, `theme/IdentoFont.kt` |
| **3. Переиспользуемые компоненты** | 11 новых Compose-компонентов для редизайна регистрации: `StatusBar`, `ModeSegmentedControl`, `VerdictBand`, `DetailTable`, `ActionStack`, `ListRow`, `FilterChips`, `ScanReticle` (анимированная рамка сканирования), `OfflineBanner`/`IdentoToggle`/`SelectableCard` | `shared/src/commonMain/.../components/redesign/*.kt` |
| **4. Доменные verdict-модели** | `StationConfig`/`StationMode`/`PrinterConfig`, `RegistrationVerdict` (sealed, 5 подтипов) + `PrintState`, `ZoneVerdict` (sealed, 3 подтипа), `VerdictAttendee` | `shared/src/commonMain/.../data/model/{StationConfig,RegistrationVerdict,ZoneVerdict}.kt` |
| **5. DTO + API-сервисы** | DTO для всех 6 backend-эндпоинтов Фазы B (`StationDtos.kt`, `CheckinDtos.kt`) + новый `StationApiService` + методы `scanZone`/`getEventStats`/`submitBatchCheckins`/`submitOverride`, добавленные в существующие `ZoneApiService`/`EventApiService`/`AttendeeApiService` | `shared/src/commonMain/.../data/{model,network}/*.kt` |
| **6. Репозитории** | `StationRepository` (новый) + аналогичные проходные методы в `ZoneRepository`/`AttendeeRepository`/`EventRepository`, регистрация в Koin (`AppModule.kt`) | `shared/src/commonMain/.../data/repository/*.kt` |
| **7. SQLDelight — офлайн-хранилище** | Реальная SQLite-персистентность взамен in-memory заглушки: схема `PendingCheckIn.sq`, `SqlDriverFactory` (expect/actual Android/iOS), `SqlDelightOfflineDatabase` за тем же интерфейсом `OfflineDatabase` | `shared/src/commonMain/sqldelight/.../PendingCheckIn.sq`, `data/storage/{SqlDriverFactory*,SqlDelightOfflineDatabase}.kt` |
| **8. Камера — Android** | Реальный CameraX (`ImageAnalysis` + `ProcessCameraProvider`, привязка к `ProcessLifecycleOwner`) + ML Kit `BarcodeScanning` (QR/Code128/Code39) взамен заглушки; `Flow<String>` для декодированных кодов | `shared/src/androidMain/.../platform/camera/CameraService.android.kt` |
| **9. Камера — iOS** | Реальный `AVCaptureSession` + `AVCaptureMetadataOutput` (те же 3 формата) взамен заглушки, тот же контракт `Flow<String>` | `shared/src/iosMain/.../platform/camera/CameraService.ios.kt` |
| **10. `:app` → `:shared`** | Android `:app` подключил `:shared` как зависимость; `MainActivity` теперь хостит `:shared`'s `App()` через Koin вместо своего Hilt-presentation-слоя; удалено 31 коллидирующий файл (24 экрана/вьюмодели `presentation/`, 2 repo, 4 модели, 1 preferences), 1 файл (`BadgeTemplate.kt`) исправлен под nullable-поля новой модели `Attendee` вместо удаления (дормантная hardware-инфра, сохраняется для Фазы M4) | `android-app/app/src/main/.../MainActivity.kt`, `IdentoApplication.kt`, `build.gradle.kts` |

## (b) Результаты гейтов (Задача 11)

Все команды выполнены из `mobile/android-app` на реальном окружении (Java 17,
Xcode 26.2, CocoaPods 1.16.2, Kotlin/Native 2.3.21 toolchain уже установлен в
`~/.konan`).

| Команда | Результат | Детали |
|---|---|---|
| `./gradlew :shared:compileDebugKotlinAndroid` | ✅ **BUILD SUCCESSFUL** (917ms) | 17 tasks, 1 executed / 16 up-to-date |
| `./gradlew :shared:compileKotlinIosSimulatorArm64` | ✅ **BUILD SUCCESSFUL** (824ms) | 11 tasks, 2 executed / 9 up-to-date |
| `./gradlew :shared:compileKotlinIosArm64` | ✅ **BUILD SUCCESSFUL** (810ms) | 11 tasks, 2 executed / 9 up-to-date |
| `./gradlew :shared:testDebugUnitTest` | ✅ **BUILD SUCCESSFUL** (1s) | **9/9 тестов прошли**, 0 failures/errors, в 4 классах: `NetworkConfigTest` (3), `StationConfigTest` (2), `PendingZoneCheckInTest` (2), `StationRepositoryTest` (2) |
| `./gradlew :app:assembleDebug` | ✅ **BUILD SUCCESSFUL** (1s, up-to-date) | APK собран: `app/build/outputs/apk/debug/app-debug.apk` (49 077 766 байт, подтверждено на диске) |
| `./gradlew :app:lintDebug` | ✅ **BUILD SUCCESSFUL** (975ms) | **0 errors, 142 warnings** (подтверждено прямым парсингом `lint-results-debug.txt`) — 106 `UnusedResources` (осиротевшие ресурсы после удаления старого UI в Задаче 10, ожидаемо) + 36 существовавших до этой фазы (`GradleDependency`, `NewerVersionAvailable`, `UseKtx` и т.п.), 0 из них — регрессия этой фазы |

Все 6 команд гейта Шага 1 — **зелёные**, без единого допущения "должно быть
ок" — каждый результат подтверждён либо явным `BUILD SUCCESSFUL` в выводе
Gradle, либо (для теста и линта) прямым чтением сгенерированных XML/txt
отчётов.

### Шаг 2 — попытка сборки iOS-воркспейса (Xcode/CocoaPods)

Инструментарий в этом окружении **есть** (`xcodebuild` — Xcode 26.2/17C52,
`pod` — CocoaPods 1.16.2), поэтому попытка была предпринята, а не пропущена.

1. `pod install` в `mobile/iosApp/` — **успешно** (`Pod installation complete!
   There is 1 dependency from the Podfile and 1 total pod installed`), после
   того как локаль была явно выставлена в `LANG=en_US.UTF-8
   LC_ALL=en_US.UTF-8` — без этого CocoaPods 1.16.2 на этой машине падает на
   `Unicode Normalization not appropriate for ASCII-8BIT` (Ruby-окружение по
   умолчанию не UTF-8; не связано с кодом этой фазы).
2. `xcodebuild -workspace iosApp.xcworkspace -scheme iosApp -sdk
   iphonesimulator -configuration Debug build` — **упал**:
   `iOSApp.swift:2:8: error: Unable to find module dependency: 'shared'`.
   Причина: `shared.podspec` в этом проекте объявляет
   `vendored_frameworks = 'build/bin/iosSimulatorArm64/debugFramework/shared.framework'`
   — статический путь к уже собранному Gradle-фреймворку, а не
   auto-run "Run Script"-фаза (`embedAndSignAppleFrameworkForXcode`), как в
   типовом KMP-шаблоне. Значит фреймворк нужно собрать через Gradle заранее.
3. `./gradlew :shared:linkDebugFrameworkIosSimulatorArm64` (шаг, которого нет
   в списке команд брифа, но который логически необходим для Шага 2) — **упал**
   с ошибкой сборки нативного компиляторного кэша:
   ```text
   e: Failed to build cache for .../org.jetbrains.androidx.navigation/
      navigation-runtime-iossimulatorarm64/2.8.0-alpha10/.../navigation-runtime.klib.
   java.lang.IllegalStateException: Function FUN AUXILIARY_GENERATED_DECLARATION
      name:getBackStackEntry ... is not found
   ```
   Проверено, что это не побитый локальный кэш: ошибка воспроизводится
   идентично и после `-Pkotlin.native.cacheKind=none` (свойство deprecated с
   2.3.20, эффекта не даёт), и после ручной очистки соответствующей директории
   `~/.konan/kotlin-native-prebuilt-macos-aarch64-2.3.21/klib/cache/.../
   org.jetbrains.androidx.navigation:navigation-runtime` и повторной сборки
   с нуля.

**Вывод по Шагу 2:** это padding — известный, уже задокументированный в
проектной памяти (`mobile-toolchain-ceiling`) технический долг: `:shared`
использует JetBrains-alpha артефакт `org.jetbrains.androidx.navigation`
(2.8.0-alpha10), а не стабильный AndroidX navigation-compose, именно как
временное решение для KMP-таргетов; расхождение уже отмечено как "deferred
follow-up" до этой фазы. Ошибка возникает исключительно на шаге построения
Kotlin/Native **компиляторного кэша** для линковки готового `.framework`
(шаг, отдельный и более строгий, чем обычная компиляция) — то есть это
дефект тулчейна/альфа-зависимости, а не регрессия, внесённая задачами 1-10:
`:shared:compileKotlinIosSimulatorArm64`/`compileKotlinIosArm64` (Шаг 1)
компилируют ровно тот же код безо всяких проблем. Апгрейд этой alpha-зависимости
или отключение native-кэша через актуальный DSL — вне рамок задачи 11
(это было бы незапланированным изменением зависимости).

**Поэтому: полный iOS-app воркспейс не был верифицирован до "запускается в
симуляторе" в этом окружении.** Потолком верификации для iOS остаются
`:shared:compileKotlinIosSimulatorArm64` и `:shared:compileKotlinIosArm64`
(оба зелёные) — ровно как и предусматривает fallback-пункт брифа для Шага 2.

## (c) Что ещё должны построить M1b/M1c поверх этого фундамента

Эта фаза (M1a) — **только data+platform plumbing, ни одного нового экрана
не появилось.** Явно НЕ входит в эту фазу и остаётся для M1b/M1c:

- **M1b (setup wizard):** экраны первичной настройки станции — использование
  `StationRepository.createProvisioningToken`/`provisionStation` (Задачи 5-6)
  для UI-потока провижининга устройства; выбор режима станции
  (`StationMode.REGISTRATION`/`ZONE_CONTROL`/`KIOSK`) на экране, а не только
  в модели (Задача 4); restyle экрана настроек под новую тёмную тему/токены
  (Задача 1) — существующий `SettingsScreen` пока не переведён.
- **M1c (registration mode):** сами экраны регистрации/зон — сканирование
  (потребление `Flow<String>` из Задач 8-9 в UI), рендеринг вердиктов
  (`RegistrationVerdict`/`ZoneVerdict` из Задачи 4 через `VerdictBand`/
  `DetailTable`/`ActionStack` из Задачи 3), список/поиск участников
  (`ListRow`/`FilterChips`), офлайн-баннер (`OfflineBanner`). Также M1c должен
  **смигрировать** `OfflineCheckInRepository` с уже используемого им
  legacy-эндпоинта `performZoneCheckIn` на новый batch/scan-контракт
  (`submitBatchCheckins`/`scanZone` из Задач 5-6) — Задача 7 заменила только
  слой хранения очереди (SQLDelight), но не изменила, какой эндпоинт вызывает
  сама очередь при обработке.
- **Печать по очереди:** бизнес-логика реального использования print-queue
  таблиц/состояний (`PrintState` из Задачи 4) — сами таблицы аддитивны и не
  потребляются ничем в M1a.
- **Nav-graph:** ни один новый компонент/экран/репозиторий из этой фазы не
  подключён к навигации `:app`/`:shared` — это тоже задача M1b/M1c.

## (d) Отклонения от плана, обнаруженные в ходе реализации

План (`docs/superpowers/plans/2026-07-10-mobile-redesign-m1a-foundation.md`)
был написан заранее с несколькими явно помеченными "best-guess" местами;
большинство подтвердились как есть, но было несколько мест, которые пришлось
скорректировать по факту прогона:

1. **Задача 2 — путь внутри zip-архива Inter.** План предполагал
   `"Inter Desktop/Inter-*.ttf"` внутри `Inter-4.1.zip`; реальный релиз v4.1
   не содержит папку `Inter Desktop/` вовсе — статические TTF по начертаниям
   лежат в `extras/ttf/Inter-*.ttf`. Скорректирован путь распаковки; итоговые
   файлы (~410-422KB каждый) оказались крупнее, чем ожидавшиеся в плане
   "~300-350KB" (ожидаемо для hinted-варианта, не проблема).
2. **Задача 2 — источник `Font(...)` для Compose-ресурсов.** Код брифа
   импортировал `androidx.compose.ui.text.font.Font`, но этот `Font` не имеет
   перегрузки, принимающей `FontResource` (Compose Multiplatform ресурсный
   тип) — только `File`/`resId`/`DeviceFontFamilyName`. Верная функция —
   отдельная `org.jetbrains.compose.resources.Font(resource: FontResource, ...)`.
   Однострочный фикс импорта, без изменения намерения кода.
3. **Задача 7 — тип возврата `QueryResult<Long>` вместо `Unit`.** В SQLDelight
   2.1.0 методы на базе `execute()` (`deleteById`, `deleteAll`) возвращают
   `QueryResult<Long>`. Expression-bodied реализации `deletePendingCheckIn`/
   `clearPendingCheckIns` из брифа не компилировались против `Unit`-сигнатур
   интерфейса `OfflineDatabase` — переписаны на block-bodied функции,
   отбрасывающие результат. Остальной API (`AndroidSqliteDriver`,
   `NativeSqliteDriver`, генерируемое имя таска `generateCommonMainIdentoDatabaseInterface`,
   имена колонок в generated row-типах) совпал с догадками брифа один в один.
4. **Задача 8 — гонка "stop-during-resolve" в CameraX (найдено на ревью).**
   `startScanning()` резолвит `ProcessCameraProvider.getInstance(context)`
   асинхронно; если `stopScanning()` успевал отработать до срабатывания
   листенера, `unbindAll()` оказывался no-op, и камера всё равно
   привязывалась после. Пофикшено добавлением guard'а
   `if (!isCurrentlyScanning) return@addListener` внутри колбэка.
5. **Задача 9 — два статических импорта `AVCaptureDevice` из трёх.** Из
   методов класса `AVCaptureDevice` брифа `defaultDeviceWithMediaType`
   оказался настоящим **членом** `AVCaptureDeviceMeta` (доступен через
   обычное наследование `AVCaptureDevice.Companion`, импорт не нужен и даже
   не резолвится как top-level символ), тогда как
   `authorizationStatusForMediaType`/`requestAccessForMediaType` — реальные
   **top-level extension-функции** с ресивером `AVCaptureDeviceMeta` (импорт
   обязателен). Диагностировано через `klib dump-metadata` на klib
   платформенного `AVFoundation`, а не методом проб и ошибок. Сама сигнатура
   делегата `captureOutput(...)` (три параметра, тот порядок) скомпилировалась
   без изменений с первой попытки — вопреки опасению брифа, что именно она
   будет капризной.
6. **Задача 10 — 31 файл на удаление вместо предполагавшихся брифом 26 (22 в
   `presentation/`).** Фактическая директория `presentation/` содержала 24
   файла (не 22), плюс 2 в `data/repository/` и 4 в `data/model/` и 1 в
   `data/preferences/`, коллидирующих по FQN с `:shared` — итого 31. Плюс один
   файл, не предусмотренный списком удаления брифа вовсе:
   `data/bluetooth/BadgeTemplate.kt` (ZPL-шаблон для Zebra-принтеров) после
   удаления старой `data/model/Attendee.kt` стал резолвиться на `:shared`'s
   `Attendee`, где `company`/`position`/`email` — nullable (`String?`), а не
   `String = ""` как раньше. Решено **исправить, а не удалить** (это
   независимая dormant hardware-инфраструктура, а не presentation-слой,
   подлежащий сносу по брифу) — заменены ~16 обращений на `.orEmpty()`/
   `?: ""`, сохранив точную прежнюю семантику "пусто по умолчанию".

Также в ходе задач 8-9 при их независимой сквозной e2e-проверке (через связанный
backend-контракт Фазы B) агент нашёл и закрыл 2 находки, не относящиеся к
самому мобильному коду фазы M1a, но блокировавшие честную e2e-проверку:
`CreateUser` не добавлял нового пользователя в `user_tenants` (backend), и
`AddUserToTenant` создавал строки с нулевым `id` при коллизии первичного
ключа (`errcheck` + PK-багфикс, коммит `f641cb8` в `pg_store.go`/`zone_scan.go`).
Оба фикса — в backend, не в mobile-коде этой фазы, задокументированы в
`.superpowers/sdd/task-8-followup-fix-report.md` и `task-9-fix-report.md`.

## Итог

Все 6 обязательных команд гейта (Шаг 1) — зелёные, с прямым подтверждением
через логи/отчёты, а не предположением. Шаг 2 (полная сборка iOS-воркспейса)
предпринят при доступном Xcode/CocoaPods-инструментарии, дошёл до реальной
причины отказа (alpha-зависимость `org.jetbrains.androidx.navigation`,
известная и уже задокументированная как технический долг), но не завершился
успешно — потолок верификации для iOS остаётся на уровне компиляции
Kotlin/Native (Шаг 1), без полной проверки запуска в симуляторе.
