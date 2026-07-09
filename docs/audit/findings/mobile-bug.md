# MOBILE-BUG — mobile/shared/src + mobile/android-app/app/src, КОРРЕКТНОСТЬ / БАГИ

### MOBILE-BUG-01: Offline-хранилище чек-инов на Android — заглушка в памяти, данные теряются
- Файл: mobile/shared/src/androidMain/kotlin/com/idento/data/storage/OfflineDatabase.android.kt:7-35
- Описание: `OfflineDatabaseImpl` (реализация `OfflineDatabase`, используемая `OfflineCheckInRepository` для очереди офлайн чек-инов) хранит `PendingZoneCheckIn` в обычном `mutableListOf()` в памяти процесса. Комментарий в коде прямо говорит: `// TODO: Implement using Room or SQLDelight`. Идентичная заглушка присутствует и в iOS-реализации (`OfflineDatabase.ios.kt:7-35`), то есть офлайн-хранилище не персистентно ни на одной платформе.
- Влияние: Любой чек-ин, сохранённый "офлайн" (нет сети, либо сбой онлайн-запроса), исчезает бесследно при завершении/перезапуске процесса приложения (уход в фон и последующая выгрузка системой по памяти, краш, принудительная остановка, перезагрузка устройства) — а это стандартная ситуация на Android. Персонал будет уверен, что чек-ин "сохранён для последующей синхронизации", а по факту запись просто исчезнет без какого-либо уведомления, то есть посетитель не будет учтён как прошедший чек-ин.
- Серьёзность: Critical
- Уверенность: высокая
- Рекомендация: Заменить in-memory список на персистентное хранилище (SQLDelight/Room-аналог для KMP), фактически реализовав заявленный TODO, до того как офлайн-функциональность будет включена в продакшен-поток.

### MOBILE-BUG-02: NetworkMonitor на Android всегда возвращает "онлайн" — офлайн-режим не определяется
- Файл: mobile/shared/src/androidMain/kotlin/com/idento/data/sync/NetworkMonitor.android.kt:10-22
- Описание: `NetworkMonitorImpl.isOnline` — это `MutableStateFlow(true)`, которое никогда не обновляется, а `checkConnectivity()` захардкожен на `return true`. Реальной интеграции с `ConnectivityManager` нет (см. TODO в коде). Тот же паттерн — в iOS-реализации (`NetworkMonitor.ios.kt:10-22`).
- Влияние: Всё, что построено на `NetworkMonitor` (например, `SyncService.startAutoSync()`, который слушает `networkMonitor.isOnline`), никогда не увидит переход в офлайн, а сам факт "нет сети" не может быть определён иначе как через прямую ошибку сетевого запроса. Любая логика, полагающаяся на проактивное определение офлайн-состояния (а не на перехват исключения после неудачного запроса), не сработает.
- Серьёзность: High
- Уверенность: высокая
- Рекомендация: Реализовать `NetworkMonitorImpl` через `ConnectivityManager.NetworkCallback` (Android) и `Network`/`NWPathMonitor` (iOS) вместо заглушки.

### MOBILE-BUG-03: Реальный сценарий чек-ина не имеет офлайн-фоллбэка — вся offline-sync подсистема не подключена к UI
- Файл: mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/IdentoNavHost.kt (весь файл); mobile/shared/src/commonMain/kotlin/com/idento/presentation/checkin/CheckinViewModel.kt:267-317; mobile/android-app/app/src/main/java/com/idento/presentation/checkin/CheckinViewModel.kt:278-315; mobile/shared/src/commonMain/kotlin/com/idento/data/sync/SyncService.kt:29-42
- Описание: `OfflineCheckInRepository`, `SyncService`, `ZoneRepository.performZoneCheckIn`, `ZoneSelectViewModel` и `ZoneQRScannerViewModel` образуют отдельную подсистему офлайн-чек-ина по зонам, но она нигде не используется в реально достижимом UI: в `IdentoNavHost` нет маршрута на экран выбора зоны (`ZoneSelectScreen`/`Screen.ZoneSelect` попросту отсутствует), а `SyncService.startAutoSync()` не вызывается ни из одного файла проекта (проверено `grep -rl "startAutoSync"` — единственное вхождение это объявление функции). Вместо этого реальный чек-ин выполняется через `CheckinViewModel.checkinAttendee()` (и в shared, и в android-app модулях), который напрямую вызывает `attendeeRepository.checkinAttendee(...)` / `eventRepository.checkinAttendee(...)` без какого-либо сохранения в локальную очередь при сетевой ошибке — при `ApiResult.Error`/`onFailure` просто выставляется `errorMessage`, и попытка чек-ина безвозвратно теряется.
- Влияние: В реально используемом потоке чек-ина (единственном, до которого можно дойти из навигации) любой сбой сети во время чек-ина участника (частая ситуация на мероприятиях с плохим Wi-Fi/LTE) приводит к потере попытки чек-ина без возможности повтора и без сохранения на устройстве — сотруднику придётся заметить ошибку и повторить сканирование вручную, а если он не заметит (плохая связь может выдать false-success или просто зависание) — участник не будет отмечен как прибывший.
- Серьёзность: High
- Уверенность: высокая
- Рекомендация: Либо подключить существующую offline-sync подсистему (зона-чек-ин) к реальному флоу `CheckinViewModel`/`EventRepository.checkinAttendee`, либо реализовать аналогичную офлайн-очередь непосредственно для сценария `checkinAttendee`, и вызывать `SyncService.startAutoSync()` при старте приложения/сессии.

### MOBILE-BUG-04: `runBlocking` внутри `BroadcastReceiver.onReceive` на главном потоке — риск ANR/deadlock при сканировании
- Файл: mobile/android-app/app/src/main/java/com/idento/data/scanner/HardwareScannerService.kt:214-232; mobile/android-app/app/src/main/java/com/idento/data/scanner/BluetoothScannerService.kt:164-201 (runBlocking на строке 189)
- Описание: `HardwareScannerService.handleScanIntent()` вызывается из `onReceive()` `BroadcastReceiver`, зарегистрированного через `ContextCompat.registerReceiver(context, scannerReceiver, intentFilter, ...)` без `Handler` — то есть `onReceive` исполняется на главном потоке. Внутри него — `kotlinx.coroutines.runBlocking { _scanResults.emit(it) }`, где `_scanResults` это `MutableSharedFlow<ScanResult>(replay = 0)` без дополнительного буфера. Эмиссия читается в `CheckinViewModel`/`QRScannerViewModel` через `viewModelScope.launch { hardwareScannerService.scanResults.collect {...} }`, диспетчер по умолчанию для `viewModelScope` — `Dispatchers.Main.immediate`. Аналогичный паттерн — `discoveryReceiver.onReceive` в `BluetoothScannerService.startDiscovery()`, где `runBlocking { _discoveredScanners.emit(...) }` вызывается тоже на главном потоке (receiver зарегистрирован без Handler через `context.registerReceiver`).
- Влияние: Если `emit()` требует передачи значения активному подписчику (rendezvous) для продолжения, а подписчик должен возобновиться на том же (главном) потоке, который в этот момент заблокирован внутри `runBlocking`, — главный поток не сможет получить управление, что приводит к зависанию (ANR) приложения именно во время сканирования штрихкода/QR терминальным сканером — то есть в ключевом сценарии этого экрана.
- Серьёзность: High
- Уверенность: средняя
- Рекомендация: Не использовать `runBlocking` в `onReceive`; эмитить результат через несуспендирующий механизм (`tryEmit` с достаточным `extraBufferCapacity`, либо `CoroutineScope(Dispatchers.Default).launch { emit(...) }` вне главного потока), либо регистрировать receiver с фоновым `Handler`.

### MOBILE-BUG-05: Race condition в `SyncService.performSync()` — check-then-act без атомарности может привести к двойной отправке чек-ина
- Файл: mobile/shared/src/commonMain/kotlin/com/idento/data/sync/SyncService.kt:55-88
- Описание: Защита от параллельного запуска синхронизации реализована как неатомарная проверка `if (_syncState.value is SyncState.Syncing) { return }` с последующей отдельной записью `_syncState.value = SyncState.Syncing(...)` несколькими строками ниже (после ещё одного suspend-вызова `getPendingCheckIns()`). Между чтением и записью состояния другая корутина (например, вызов из авто-синхронизации в `startAutoSync()` и параллельный ручной вызов `performSync()`) может успеть пройти ту же проверку до того, как состояние будет выставлено в `Syncing`.
- Влияние: Два параллельных вызова `performSync()` оба увидят состояние, отличное от `Syncing`, и оба вызовут `offlineCheckInRepository.syncAll()` для одного и того же набора ещё не удалённых `PendingZoneCheckIn`, отправив дублирующие запросы чек-ина на сервер для одних и тех же посетителей/зон/дней до того, как первая успешная попытка удалит запись из очереди.
- Серьёзность: Medium
- Уверенность: средняя
- Рекомендация: Использовать `Mutex` или атомарный `compareAndSet` над состоянием синхронизации вместо раздельных чтения/записи `_syncState.value`, чтобы гарантировать, что `syncAll()` выполняется не более одного раза одновременно.

### MOBILE-BUG-06: Постоянные (не сетевые) ошибки чек-ина бесконечно повторяются в офлайн-очереди без учёта количества попыток
- Файл: mobile/shared/src/commonMain/kotlin/com/idento/data/repository/OfflineCheckInRepository.kt:78-98 (syncCheckIn), 25-46 (performCheckIn); mobile/shared/src/commonMain/kotlin/com/idento/data/storage/OfflineDatabase.kt:38-47 (модель `PendingZoneCheckIn`)
- Описание: Модель `PendingZoneCheckIn` содержит поля `attemptCount`, `lastAttemptAt`, `errorMessage`, явно предназначенные для отслеживания повторных попыток, но ни `performCheckIn`, ни `syncCheckIn` их никогда не читают и не записывают. `syncCheckIn` при любой ошибке (`ApiResult.Error`) от `zoneRepository.performZoneCheckIn` просто возвращает `ApiResult.Error` и оставляет запись в очереди без изменений — независимо от того, вызвана ли ошибка временным сбоем сети или постоянной бизнес-ошибкой (например, зона недоступна, участник заблокирован, доступ запрещён — всё это backend возвращает не-2xx статусом).
- Влияние: Чек-ин, который никогда не сможет быть выполнен успешно (например, заблокированный участник), навсегда останется в офлайн-очереди и будет повторно отправляться на сервер при каждом переходе в онлайн и при каждом ручном/авто-sync, тратя сетевые запросы и никогда не показывая персоналу реальную причину невозможности чек-ина — вместо этого пользователь изначально увидел "Saved offline" (см. `performCheckIn`, строка 36), хотя проблема не в отсутствии сети.
- Серьёзность: Medium
- Уверенность: средняя
- Рекомендация: Различать сетевые/временные ошибки (стоит повторять) и постоянные бизнес-ошибки (4xx с конкретной причиной — не стоит повторять), обновлять `attemptCount`/`errorMessage` при каждой неудачной попытке и удалять/помечать как "требует внимания" записи, превысившие лимит попыток или содержащие неустранимую ошибку.

### MOBILE-BUG-07: NPE-риск от `!!` на `selectedAttendee`, гонка с автозакрытием по таймеру
- Файл: mobile/shared/src/commonMain/kotlin/com/idento/presentation/checkin/CheckinScreen.kt:124-133 (авто-дисмисс таймер), 346-357 (использование `!!` в `onPrintBadge`)
- Описание: `LaunchedEffect` (строки ~124-133) отсчитывает `dismissCountdown` от 10 до 0 и по завершении вызывает `viewModel.clearSelectedAttendee()`, которая устанавливает `selectedAttendee = null`. Кнопка печати бейджа рендерится при условии `isColoredStatus && uiState.selectedAttendee != null` (строка 346), но обработчик клика захватывает значение лениво: `onPrintBadge = { viewModel.printBadge(uiState.selectedAttendee!!) }` (строка 353) — `uiState` читается заново в момент вызова лямбды, а не на момент проверки `if`.
- Влияние: Если пользователь нажимает "Print Badge" в момент, когда таймер как раз обнулился и `clearSelectedAttendee()` уже выполнился (state обновился до обработки клика), `uiState.selectedAttendee` окажется `null`, и `!!` бросит `NullPointerException`, приводя к краху экрана чек-ина.
- Серьёзность: Medium
- Уверенность: средняя
- Рекомендация: Заменить `uiState.selectedAttendee!!` на безопасный доступ (`?.let { ... }` вокруг всего блока кнопки, либо ранний `return@Button` при `null`) вместо `!!` в обработчике клика.

### MOBILE-BUG-08: Утечка ресурсов ML Kit — новый `BarcodeScanner` создаётся на каждый кадр камеры без закрытия
- Файл: mobile/android-app/app/src/main/java/com/idento/presentation/qrscanner/QRScannerScreen.kt:575-610 (`processImageProxy`)
- Описание: `processImageProxy()` — это `Analyzer` для `ImageAnalysis` (вызывается на каждый обработанный кадр камеры, потенциально десятки раз в секунду). На каждый вызов создаётся новый инстанс `BarcodeScanning.getClient()`, который никогда не закрывается (`.close()` не вызывается ни разу в файле). По документации ML Kit клиент детектора предназначен для переиспользования в течение всей "сессии" сканирования, а не для создания на каждый кадр.
- Влияние: При длительной работе экрана самостоятельного чек-ина (self-check-in kiosk mode с включённой камерой) в памяти процесса накапливается всё больше нативных ресурсов детектора штрихкодов, что приводит к постепенной деградации производительности и потенциальному падению приложения по нехватке памяти при долгих киоск-сессиях.
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Создавать `BarcodeScanner` один раз (например, `remember { BarcodeScanning.getClient() }` на уровне composable или в `viewModel`) и переиспользовать во всех вызовах анализатора, закрывая клиент в `DisposableEffect`/`onCleared()`.

### MOBILE-BUG-09: `TokenManager.getToken()` использует `collect` на незавершающемся Flow — гарантированно зависнет при вызове
- Файл: mobile/android-app/app/src/main/java/com/idento/data/local/TokenManager.kt:50-56
- Описание: Метод реализован как `dataStore.data.collect { token = preferences[TOKEN_KEY] }` с последующим `return token`. `DataStore.data` — это "горячий" (никогда не завершающийся сам по себе) `Flow`, поэтому вызов `.collect { ... }` не вернёт управление до отмены корутины — строка `return token` никогда не будет достигнута, и вызывающая suspend-функция зависнет навсегда (что на главном потоке/во ViewModel приведёт к ANR или к "зависшему" экрану).
- Влияние: На данный момент метод нигде не вызывается (проверено `grep`), поэтому живого воздействия нет, однако это готовая "мина": любой будущий вызов (например, синхронная проверка токена перед сетевым запросом) гарантированно подвесит корутину/поток.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Заменить на `dataStore.data.map { it[TOKEN_KEY] }.first()`, как это уже корректно сделано для `authToken`/`userEmail`/`userName` в этом же файле.
