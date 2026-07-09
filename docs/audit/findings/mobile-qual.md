# MOBILE-QUAL — mobile/shared/src/ + mobile/android-app/app/src/, качество кода

Проверено: полный листинг `mobile/shared/src/**` (commonMain/androidMain/iosMain,
~10 273 строк Kotlin в commonMain) и `mobile/android-app/app/src/**`
(~20 803 строк). Прочитаны Gradle-файлы (`mobile/android-app/settings.gradle.kts`,
`mobile/android-app/app/build.gradle.kts`, `mobile/shared/build.gradle.kts`),
DI-модули (Koin в shared, Hilt в android-app), основные ViewModel/Repository/Screen
файлы, модели данных, сетевой слой (Ktor в shared vs Retrofit в android-app),
принтер-сервисы (Bluetooth/Ethernet), система локализации, `docs/audit/raw/mobile-deps.md`.

Тесты проверены в первую очередь: `find mobile -iname "*Test*.kt" -not -path "*/build/*"`
и `find mobile -type d -iname "*test*" -not -path "*/build/*"` — **ноль результатов**.
Ни `commonTest`, ни `androidTest`, ни JVM `test` каталогов не существует ни в одном
из двух модулей, несмотря на то что Gradle-зависимости для тестирования объявлены
в обоих build-файлах.

---

### MOBILE-QUAL-01: Полное отсутствие тестов при задекларированной тестовой инфраструктуре
- Файл: mobile/shared/build.gradle.kts:97-100 (`commonTest.dependencies` — `kotlin("test")`,
  `kotlinx-coroutines-test`), mobile/android-app/app/build.gradle.kts:135-140
  (`testImplementation("junit:junit:4.13.2")`, `androidTestImplementation(...)` — Espresso,
  Compose UI test)
- Описание: В обоих Gradle-модулях объявлены зависимости для unit- и instrumentation-тестов
  (JUnit, kotlinx-coroutines-test, Espresso, Compose UI Test), но ни одного файла теста не
  существует ни в `mobile/shared/src/commonTest`, ни в `mobile/shared/src/androidTest`,
  ни в `mobile/android-app/app/src/test`, ни в `mobile/android-app/app/src/androidTest`
  (каталоги отсутствуют целиком). Вся бизнес-логика — ViewModel'и (CheckinViewModel,
  AuthRepository/EventRepository, генерация ZPL в BadgeTemplate, локализация,
  offline-очередь чек-инов) — не покрыта тестами вообще.
- Влияние: Любое изменение в ключевых сценариях (чек-ин, печать бейджа, авторизация,
  офлайн-очередь) не имеет автоматической защиты от регрессий; часть найденных в этом
  аудите проблем (например, фиктивная печать бейджа в shared-модуле, см. MOBILE-QUAL-04)
  осталась бы незамеченной при наличии даже базовых unit-тестов на ViewModel.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Начать с unit-тестов на чистую логику без Android-зависимостей
  (`BadgeTemplate.generateZPL`, `ApiResult`-трансформации, `AttendeeRepository`/`EventRepository`
  с фейковыми API-сервисами, `CheckinViewModel`/`LoginViewModel` через `kotlinx-coroutines-test`),
  затем добавить пару instrumentation/Compose UI тестов на критичный путь чек-ина.
- Вердикт: ПОДТВЕРЖДЕНО — `find mobile -iname "*Test*.kt" -not -path "*/build/*"` и поиск тестовых каталогов дают ноль результатов; обе `build.gradle.kts` объявляют тестовые зависимости на цитируемых строках.

### MOBILE-QUAL-02: mobile/android-app полностью дублирует mobile/shared независимой реализацией
- Файл: mobile/android-app/settings.gradle.kts:17-19 (подключает `:shared`), но
  mobile/android-app/app/build.gradle.kts (полный файл) не содержит ни одной строки
  `implementation(project(":shared"))` — `:shared` включён в сборку, но модулем `:app`
  не используется
- Описание: В репозитории одновременно существуют два полных, независимых стека для
  одного и того же продукта: `mobile/shared` (Ktor + Koin + kotlinx.serialization +
  DataStore, Compose Multiplatform, ~10 273 строк) и `mobile/android-app` (Retrofit + Gson
  + Hilt + Room, Jetpack Compose, ~20 803 строк). Оба содержат практически идентичные по
  названию и назначению файлы: `AuthRepository.kt`, `EventRepository.kt`, `LoginScreen.kt`
  / `LoginViewModel.kt`, `CheckinScreen.kt` / `CheckinViewModel.kt`, `EventsScreen.kt`,
  `QRScannerScreen.kt`, `SettingsScreen.kt`, `TemplateEditorScreen.kt`,
  `AttendeesListScreen.kt`, `presentation/theme/{Color,Theme,Type}.kt`,
  `data/model/{Attendee,Event,User,PrinterQRData}.kt`, `data/preferences/AppPreferences.kt`
  — но реализованы дважды, отдельными командными усилиями, с разными архитектурными
  решениями (см. MOBILE-QUAL-03/07). `:shared` реально используется только для iOS-таргета.
- Влияние: Двойная стоимость поддержки любого изменения бизнес-логики или API-контракта;
  два приложения уже разошлись в деталях реализации (см. ниже) и будут расходиться дальше;
  Android-приложение (production-ready по `mobile/README.md`) и iOS-приложение (на базе
  `:shared`) на практике являются разными продуктами, а не одним KMP-приложением, вопреки
  заявленной архитектуре ("85% shared code" в mobile/README.md).
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Выбрать одну целевую архитектуру — либо перевести `mobile/android-app`
  на реальное потребление `:shared` (заменить Hilt/Retrofit/Room-стек на Koin/Ktor слой
  из shared), либо явно признать shared-модуль экспериментальным/iOS-only и не поддерживать
  иллюзию единой кодовой базы для Android.
- Вердикт: ПОДТВЕРЖДЕНО — `settings.gradle.kts` подключает `:shared` (строки 18-20), но в `app/build.gradle.kts` нет ни одной строки `implementation(project(":shared"))`; `MainActivity`/`IdentoNavHost` android-app используют собственный пакет, а не shared — независимость модулей подтверждена.

### MOBILE-QUAL-03: Модели одних и тех же сущностей разошлись по полям между двумя реализациями
- Файл: mobile/shared/src/commonMain/kotlin/com/idento/data/model/Attendee.kt:1-33 vs
  mobile/android-app/app/src/main/java/com/idento/data/model/Attendee.kt:1-60;
  mobile/shared/.../data/model/Event.kt:1-26 vs
  mobile/android-app/.../data/model/Event.kt:1-59
- Описание: Модели, описывающие один и тот же ответ backend API, отличаются по составу
  и nullability полей. Пример: `Attendee.email` — nullable (`String?`) в shared, но
  non-null (`String`) в android-app; `customFields` — `Map<String, String>` в shared vs
  `Map<String, Any>?` в android-app. `Event` в shared содержит `badgeTemplate: String?` и
  вложенный `EventSettings` (allowSelfCheckin/requireQrCode/autoPrintBadge/customFields:
  List<String>), которых нет в android-app вовсе; `Event` в android-app вместо этого имеет
  `tenantId`, `fieldSchema: List<String>?`, `customFields: Map<String, Any>?` и методы
  `getBadgeTemplate()`/`getSuccessScreenTemplate()`, читающие шаблон из `customFields` —
  структурно иной подход к тем же данным. `User` в android-app дополнительно содержит
  `tenantId`/`updatedAt`, которых нет в shared.
- Влияние: Оба клиента десериализуют один и тот же backend-контракт, но по разным
  схемам, которые уже противоречат друг другу. Несовпадение nullability (`email` как
  non-null в Gson-модели android-app при реально nullable поле API) создаёт риск скрытых
  NPE или тихой порчи данных при разборе ответа; любое изменение контракта на backend
  нужно вручную и синхронно вносить в оба разошедшихся дерева моделей, что уже не
  происходит (доказано расхождением полей).
- Серьёзность: Medium
- Уверенность: средняя (расхождение схем подтверждено построчным diff, но фактическое
  падение — NPE/некорректный парсинг — не воспроизведено рантаймом в рамках этого аудита)
- Рекомендация: Свести модели данных к одному источнику истины (в идеале — сгенерировать
  из общего API-контракта/OpenAPI-схемы backend, либо оставить только shared-модели и
  использовать их из android-app через `:shared`).
- Вердикт: ПОДТВЕРЖДЕНО — построчное сравнение подтверждает все расхождения: `email` nullable в shared / non-null в android-app, `customFields` типизирован по-разному, `Event`/`User` структурно разошлись, как описано.

### MOBILE-QUAL-04: Печать бейджа и настройки принтера в shared-модуле — нерабочая заглушка, выдаваемая за успех
- Файл: mobile/shared/src/commonMain/kotlin/com/idento/presentation/checkin/CheckinViewModel.kt:319-349
  (`printBadge()` — генерирует ZPL через `template.generateZPL(attendee)`, но нигде не
  передаёт результат в `BluetoothPrinterService`/`EthernetPrinterService`, сразу
  устанавливает `successMessage = "Badge sent to printer"`); аналогично
  mobile/shared/src/commonMain/kotlin/com/idento/presentation/settings/SettingsViewModel.kt:114-151
  (`selectBluetoothPrinter`, `selectEthernetPrinter`, `testPrint`, `clearPrinter` — везде
  `// TODO: Save to PrinterPreferences` / `// TODO: Platform-specific printer service`,
  но UI получает `successMessage` как будто действие выполнено)
- Описание: `BluetoothPrinterService`/`EthernetPrinterService` объявлены и
  зарегистрированы в Koin DI (mobile/shared/.../di/AppModule.kt:75-76: `single { createBluetoothPrinterService() } / single { createEthernetPrinterService() }`),
  но ни в `CheckinViewModel`, ни в `SettingsViewModel` (единственные потребители
  печати в shared-презентационном слое) они не инжектируются и не вызываются — конструктор
  `CheckinViewModel` (di/ViewModelModule.kt:20: `CheckinViewModel(get(), get(), get(), get())`)
  принимает только `AttendeeRepository`, `EventRepository`, `AppPreferences`,
  `DisplayTemplatePreferences`. Для сравнения: параллельная реализация
  `CheckinViewModel` в android-app (mobile/android-app/.../presentation/checkin/CheckinViewModel.kt:321-396)
  реально печатает через `bluetoothService.printWithAutoConnect(...)` /
  `ethernetService.printWithAutoConnect(...)` и сохраняет настройки в
  `PrinterPreferences`.
- Влияние: Так как `:shared` — единственная реализация бизнес-логики для iOS-таргета
  (mobile/README.md: iOS ⚠️ "Platform Services Needed", 90%), функция печати бейджа —
  один из ключевых сценариев продукта — на iOS-сборке из этого кода полностью
  неработоспособна, при этом пользователю показывается ложное сообщение об успехе
  ("Badge sent to printer", "Printer configured: ...", "Test print sent"), что маскирует
  проблему вместо явной ошибки.
- Серьёзность: High
- Уверенность: высокая
- Рекомендация: Либо реализовать реальный вызов `BluetoothPrinterService`/`EthernetPrinterService`
  в `printBadge()`/настройках принтера shared-модуля, либо явно пометить функцию как
  недоступную (disabled/coming soon) в UI до готовности, но не показывать фиктивный успех.
- Вердикт: ПОДТВЕРЖДЕНО — `CheckinViewModel.kt:319-349` и `SettingsViewModel.kt:114-163` подтверждены построчно (TODO-комментарии + фиктивный `successMessage`); `ViewModelModule.kt:20` инжектирует в `CheckinViewModel` ровно 4 зависимости без принтер-сервисов, тогда как android-app реально вызывает `printWithAutoConnect(...)`.

### MOBILE-QUAL-05: Базовый URL API захардкожен на dev/эмулятор без переключения окружений
- Файл: mobile/shared/src/commonMain/kotlin/com/idento/data/network/NetworkConstants.kt:8-10
  (`DEV_BASE_URL = "http://10.0.2.2:8080"`, `IOS_DEV_BASE_URL = "http://localhost:8080"`,
  `PROD_BASE_URL = "https://api.idento.app"`);
  mobile/shared/src/androidMain/kotlin/com/idento/data/network/NetworkConstants.android.kt:3
  (`actual fun getDefaultBaseUrl(): String = NetworkConstants.DEV_BASE_URL`);
  mobile/shared/src/iosMain/kotlin/com/idento/data/network/NetworkConstants.ios.kt:3
  (аналогично, всегда `IOS_DEV_BASE_URL`); mobile/android-app/app/src/main/java/com/idento/di/NetworkModule.kt:22
  (`private const val BASE_URL = "http://10.0.2.2:8080/"`, без разделения по build type)
- Описание: `getDefaultBaseUrl()` в обоих platform actual-реализациях (Android, iOS)
  безусловно возвращает dev/эмуляторный адрес — нет проверки `BuildConfig.DEBUG`, build
  type/flavor или другого механизма переключения на `PROD_BASE_URL`. `PROD_BASE_URL`
  объявлена, но не используется нигде в коде (`grep -rn "PROD_BASE_URL" mobile/shared/src`
  находит только объявление). В независимой реализации android-app то же самое:
  `BASE_URL` — это буквальный `10.0.2.2:8080` без `BuildConfig`/flavor-переключения, хотя
  `mobile/README.md` заявляет Android как "✅ Production Ready, 100%". Нет ни настройки в
  UI, ни рантайм-конфигурации для смены сервера.
- Влияние: Release-сборка (Android) или сборка для реального устройства (iOS) не сможет
  обратиться к продакшн-бэкенду `https://api.idento.app` — весь сетевой функционал
  (логин, список событий, чек-ин, печать) не будет работать за пределами
  эмулятора/симулятора с локально поднятым backend на loopback-адресе.
- Серьёзность: High
- Уверенность: высокая
- Рекомендация: Завести переключение base URL по build type/flavor (BuildConfig-поле в
  android-app, KMP `expect`/`actual` с учётом release-конфигурации в shared) и удалить
  либо реально задействовать мёртвую константу `PROD_BASE_URL`.
- Вердикт: ПОДТВЕРЖДЕНО — совпадает с MOBILE-SEC-01 по фактам: `getDefaultBaseUrl()` безусловно возвращает dev-адрес на обеих платформах, `PROD_BASE_URL` не используется нигде (grep), `BuildConfig.DEBUG`-проверок нет ни в shared, ни в android-app `NetworkModule.kt:22`.

### MOBILE-QUAL-06: Офлайн-очередь чек-инов и синхронизация зарегистрированы в DI, но нигде не используются (мёртвый функционал)
- Файл: mobile/shared/src/commonMain/kotlin/com/idento/data/repository/OfflineCheckInRepository.kt
  (149 строк), mobile/shared/src/commonMain/kotlin/com/idento/data/sync/SyncService.kt
  (129 строк); регистрация — mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt:63,72
  (`single { OfflineCheckInRepository(get(), get()) }`, `single { SyncService(get(), get()) }`)
- Описание: `OfflineCheckInRepository`/`SyncService`/`NetworkMonitorImpl` реализуют
  логику постановки чек-инов в очередь при отсутствии сети и последующей синхронизации,
  но ни один экран/ViewModel их не инжектирует и не вызывает
  (`grep -rn "OfflineCheckInRepository\|SyncService" mobile/shared/src` — совпадения
  только в файле определения и в `di/AppModule.kt`; `App.kt` — единственная точка входа
  композиции — тоже их не запускает). Итого 278+ строк кода реализуют функцию, которая
  никогда не инициируется.
- Влияние: Заявленная (судя по объёму реализации) устойчивость к плохой связи на
  мероприятиях (офлайн чек-ин + отложенная синхронизация) фактически отсутствует в
  работающем приложении — пользователь при потере сети получит обычную ошибку загрузки/чек-ина
  (см. `CheckinViewModel.onCodeScanned`/`checkinAttendee`), а не постановку в очередь.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Либо довести интеграцию офлайн-очереди до `CheckinViewModel` (проверка
  `NetworkMonitor`, fallback на `OfflineCheckInRepository`, периодический вызов
  `SyncService`), либо удалить неиспользуемый код, чтобы не вводить в заблуждение
  относительно реальных возможностей приложения.
- Вердикт: ПОДТВЕРЖДЕНО — `OfflineCheckInRepository`/`SyncService`/`NetworkMonitorImpl` встречаются только в файлах определения и в `di/AppModule.kt` (строки 63, 69, 72); `ZoneSelectViewModel`/`ZoneQRScannerViewModel` не зарегистрированы даже в `di/ViewModelModule.kt`, `App.kt`/`IdentoNavHost` их не вызывают.

### MOBILE-QUAL-07: Несогласованная модель обработки ошибок между shared и android-app
- Файл: mobile/shared/src/commonMain/kotlin/com/idento/data/network/ApiResult.kt:1-11
  (`sealed class ApiResult<out T> { Success/Error/Loading }` + `onSuccess`/`onError`/`onLoading`/`toApiResult`)
  vs mobile/android-app/app/src/main/java/com/idento/data/repository/EventRepository.kt:17-30
  и AuthRepository.kt:24-43 (стандартный `kotlin.Result<T>` с `.onSuccess { }.onFailure { }`,
  ошибки — обычные `Exception("Failed to fetch events: ${response.message()}")`)
- Описание: Для одной и той же концепции (результат сетевого вызова: успех/ошибка/загрузка)
  в проекте существуют два независимых типа с разными API поверхностями — `ApiResult<T>`
  (shared, различает `Loading`) и `kotlin.Result<T>` (android-app, не различает
  "в процессе"/"ошибка" на уровне типа, `isLoading` реализован вручную в UI state). В
  shared-репозиториях ошибка передаётся как `ApiResult.Error(exception, message)`, в
  android-app — как текстовое сообщение внутри `Exception(...)`, создаваемого в месте
  вызова API, без общего механизма классификации ошибок (сеть/сервер/бизнес-правило).
- Влияние: Разработчику, работающему в обеих кодовых базах, приходится держать в голове
  два разных контракта обработки ошибок; типовые сценарии (нет сети, 401/403, 404,
  валидация) обрабатываются по-разному и с разной степенью детализации в разных экранах
  (см. также println-логирование ниже) — усложняет диагностику продакшн-инцидентов.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: При объединении дублирующихся реализаций (MOBILE-QUAL-02) выбрать один
  тип результата для всего мобильного кода и единый набор доменных ошибок
  (network/unauthorized/notFound/validation), а не сообщения-строки.
- Вердикт: ПОДТВЕРЖДЕНО — `ApiResult.kt:1-11` (sealed class Success/Error/Loading, подтверждено) в shared против `kotlin.Result<T>`+`.onSuccess/.onFailure` в android-app `EventRepository.kt`/`AuthRepository.kt` на цитируемых строках.

### MOBILE-QUAL-08: Магические числа в генераторе ZPL для бейджей
- Файл: mobile/android-app/app/src/main/java/com/idento/data/bluetooth/BadgeTemplate.kt:34-90+
  (пример: `appendLine("^PW812")`, `appendLine("^FO20,20^GB772,1180,4^FS")`,
  `x = 50, y = 50, fontHeight = 50, fontWidth = 50`, `x = 50, y = 160, fontHeight = 80`
  и т.д. — десятки подобных литералов по всему 516-строчному файлу)
- Описание: Весь макет бейджа (координаты полей, толщина рамки, размеры шрифтов,
  ширина метки в точках) задан необъяснёнными числовыми константами прямо в теле
  `object BadgeTemplate`, без именованных констант и без единой системы координат/отступов
  (нет `LABEL_WIDTH_DOTS`, `MARGIN`, `HEADER_FONT_SIZE` и т.п.). Похожая, но не идентичная
  проблема — в shared-модуле подход принципиально иной: `BadgeTemplate.generateZPL`
  (mobile/shared/.../data/model/BadgeTemplate.kt:21-39) просто подставляет значения в
  готовый серверный ZPL-шаблон по плейсхолдерам, то есть в двух реализациях "бейдж" —
  это два разных механизма (см. также MOBILE-QUAL-02/03).
- Влияние: Любое изменение верстки бейджа (например, другой размер этикетки, новый принтер)
  требует ручного пересчёта и правки десятков координат без единой точки настройки;
  повышенный риск визуальных регрессий (наложение полей, обрезание текста) при правках.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Вынести размеры/отступы/шрифты в именованные константы (или простую
  конфигурацию макета), особенно раз выбор архитектуры между "рендер на устройстве" и
  "шаблон с сервера" для генерации бейджа в проекте уже не единообразен.
- Вердикт: ПОДТВЕРЖДЕНО — android-app `BadgeTemplate.kt` (516 строк) содержит буквальные ZPL-координаты/размеры без именованных констант; shared `BadgeTemplate.kt` (39 строк) вместо этого лишь подставляет значения в готовый серверный ZPL-шаблон — принципиально другой механизм, как и заявлено.

### MOBILE-QUAL-09: Файлы Compose-экранов свыше 400 строк смешивают несколько ответственностей
- Файл: mobile/shared/src/commonMain/kotlin/com/idento/presentation/checkin/CheckinScreen.kt
  (867 строк) — в одном файле: главный composable `CheckinScreen` (строка 62),
  презентационные под-компоненты `AttendeeInfoCard` (375), `StatusIndicatorSection` (443),
  `SearchSuggestionsCard` (601), `TemplateRenderedContent` (689), `DefaultAttendeeInfo` (739),
  `EmptyStateCard` (770), модальный `PrintSettingsDialog` с собственным состоянием (794) и
  утилитарная функция форматирования времени `formatCheckinTime` (667); аналогично
  mobile/android-app/app/src/main/java/com/idento/presentation/qrscanner/QRScannerScreen.kt
  (742 строки) и SettingsScreen.kt (690 строк в android-app, 640 строк в shared)
- Описание: Несколько экранных файлов проекта заметно превышают 400 строк и объединяют
  разнородные обязанности — экран целиком, переиспользуемые презентационные блоки,
  модальные диалоги с собственной логикой и служебные форматтеры — без разнесения по
  отдельным файлам/пакетам (например `presentation/checkin/components/`).
- Влияние: Снижает читаемость и навигацию по коду, увеличивает риск конфликтов при
  параллельной работе нескольких разработчиков над одним экраном, затрудняет повторное
  использование под-компонентов (`AttendeeInfoCard` и т.п.) в других местах.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Вынести отдельные `@Composable` из `CheckinScreen.kt`/`QRScannerScreen.kt`/
  `SettingsScreen.kt` в отдельные файлы по под-пакетам (components/dialogs), оставив в
  основном файле только корневой composable и связывание с ViewModel.
- Вердикт: ПОДТВЕРЖДЕНО — `wc -l` подтверждает точное совпадение (`CheckinScreen.kt` 867 строк, `QRScannerScreen.kt` 742 строки), позиции названных composable-функций совпадают с точностью до 1 строки.

### MOBILE-QUAL-10: Готовая система локализации в shared обходится хардкодом строк в бизнес-коде
- Файл: mobile/shared/src/commonMain/kotlin/com/idento/presentation/settings/SettingsViewModel.kt:100,106
  (`successMessage = if (language == "ru") "Язык изменён" else "Language changed"`),
  а также строки 77-84 ("Theme changed"/"Theme applied (may not persist on restart)"),
  120,132,147,159 ("Printer selected: $name", "Printer configured: $name",
  "Test print sent", "Printer cleared"), 183,193,198 — все хардкожены на английском без
  учёта текущего языка
- Описание: В shared-модуле уже реализована полноценная система локализации
  (`LocalizationManager` + `enum StringKey` на 93 ключа, EN/RU —
  mobile/shared/.../data/localization/Strings.kt), но большинство пользовательских
  сообщений об успехе/ошибке в `SettingsViewModel` (и по аналогии в других ViewModel,
  где встречаются похожие `successMessage`/`errorMessage` литералы) заданы прямыми
  строковыми литералами на английском в коде ViewModel, а не через `StringKey`/`getString`.
  Два места (смена языка) сделаны через ad-hoc `if (language == "ru") ... else ...`,
  дублирующий логику, для которой уже существует централизованный механизм.
- Влияние: Пользователь с русской локалью видит смешанный интерфейс — постоянные
  элементы UI переведены, а всплывающие сообщения о результате операций (смена темы,
  настройка принтера, тестовая печать) — нет; при добавлении нового языка потребуется
  искать разбросанные по ViewModel строки отдельно от `Strings.kt`.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Завести соответствующие ключи в `StringKey`/`Strings.kt` для всех
  сообщений ViewModel и убрать ad-hoc `if (language == "ru")`-ветвления.
- Вердикт: ПОДТВЕРЖДЕНО — `Strings.kt` содержит ровно 93 записи `StringKey` (подсчитано), `SettingsViewModel.kt` не вызывает `getString`/`StringKey` ни разу, все указанные `successMessage`/`errorMessage` литералы подтверждены построчно, включая дублирующее `if (language == "ru")` на 100/106.

### MOBILE-QUAL-11: Каталог версий Gradle не подключён — версии дублируются вручную и уже разошлись (из docs/audit/raw/mobile-deps.md)
- Файл: mobile/android-app/gradle/libs.versions.toml (53 записи, не используется —
  подтверждено `grep -rn "libs\." mobile --include="*.kts"` → 0 совпадений);
  mobile/android-app/app/build.gradle.kts:72 (`compose-bom:2024.11.00`) и :81
  (`navigation-compose:2.8.4`) vs toml (`compose-bom = 2024.12.01`,
  `compose-navigation = 2.8.5`); mobile/shared/build.gradle.kts:78
  (`org.jetbrains.androidx.navigation:navigation-compose:2.8.0-alpha10` — другой groupId
  и alpha-версия вместо `androidx.navigation:navigation-compose`)
- Описание: Как зафиксировано в инвентаре зависимостей (docs/audit/raw/mobile-deps.md,
  разделы 1 и 7), в проекте объявлен version catalog `libs.versions.toml`, но ни один
  build.gradle.kts (`android-app`, `app`, `shared`) на него не ссылается — все версии
  библиотек и плагинов продублированы как строковые литералы в трёх местах. Каталог уже
  разошёлся с реально используемыми версиями: `compose-bom` в каталоге новее (2024.12.01),
  чем реально подключённый (2024.11.00); `navigation-compose` в android-app на патч старше
  каталога (2.8.4 vs 2.8.5); в shared-модуле для той же библиотеки используется вовсе
  другой артефакт — alpha-версия KMP-форка навигации
  (`org.jetbrains.androidx.navigation:navigation-compose:2.8.0-alpha10`), которая к тому же
  используется в сборке для iOS. Запись `compose = 1.7.6` в каталоге не используется нигде.
- Влияние: Никакой автоматической защиты от рассинхронизации версий между тремя
  build-файлами нет; расхождения уже произошли и будут продолжать накапливаться при
  обновлении зависимостей в одном месте без синхронизации остальных; поддержка версии
  каталога создаёт ложное ощущение централизованного управления зависимостями, которого
  на практике нет.
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Либо подключить `libs.versions.toml` через
  `dependencyResolutionManagement { versionCatalogs { ... } }` и заменить строковые литералы
  ссылками `libs.*` во всех трёх build.gradle.kts, либо удалить неиспользуемый каталог,
  чтобы не вводить в заблуждение. Отдельно — привести `navigation-compose` в shared к
  стабильной версии, согласованной с остальными модулями.
- Вердикт: ПОДТВЕРЖДЕНО — `grep -rn "libs\." mobile --include="*.kts"` даёт ровно 1 совпадение (само объявление в toml), версии реально разошлись: toml `compose-bom=2024.12.01`/`compose-navigation=2.8.5` против фактических `2024.11.00`/`2.8.4` в `app/build.gradle.kts`, и alpha-артефакт в `shared/build.gradle.kts:78`.

### MOBILE-QUAL-12: Избыточное использование `!!` там, где уже есть безопасные альтернативы
- Файл: mobile/android-app/app/src/main/java/com/idento/data/repository/EventRepository.kt:22,37,52,67,86
  (`response.body()!!` после ручной проверки `response.body() != null` тремя строками выше);
  mobile/android-app/app/src/main/java/com/idento/data/repository/AuthRepository.kt:29,50
  (аналогично); mobile/android-app/.../data/ethernet/EthernetPrinterService.kt:84
  (`currentSocket?.isConnected == true && !currentSocket!!.isClosed`)
- Описание: Во всех перечисленных местах `!!` технически безопасен (перед ним есть явная
  проверка на null в том же выражении/блоке), но стиль кода вместо безопасных идиом
  (`response.body()?.let { ... } ?: ...`, `?.isClosed == false`) полагается на
  повторную ручную проверку и `!!`, что делает код более хрупким к последующим правкам:
  при рефакторинге условия (например, если проверку `!= null` уберут или изменят) `!!`
  сразу же приведёт к `NullPointerException` без явного намёка в месте падения.
- Влияние: Низкий непосредственный риск (сейчас логика корректна), но при дальнейшем
  сопровождении кода это частый источник регрессионных NPE, особенно в связке с
  отсутствием тестов (MOBILE-QUAL-01).
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Заменить пары "проверка + `!!`" на `?.let { }` /
  безопасные операторы (`response.body()?.let { Result.success(it) } ?: Result.failure(...)`).
- Вердикт: ПОДТВЕРЖДЕНО — все цитируемые `!!` (`EventRepository.kt:22,37,...`, `AuthRepository.kt:29,50`, `EthernetPrinterService.kt:84`) подтверждены построчно, каждый следует сразу за проверкой на null в том же условии/выражении — технически безопасно, но стилистически хрупко, как и описано.
