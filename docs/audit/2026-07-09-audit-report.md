# Отчёт аудита Idento — 2026-07-09

## 1. Резюме

Аудит охватил 6 подсистем (backend, agent, web, desktop, landing, mobile) по 3 измерениям каждая
(SEC/BUG/QUAL) и два сканерных прохода (govulncheck для Go, npm audit для JS, ручная проверка Rust/Tauri
и mobile через OSV.dev — `cargo-audit` был недоступен). Из 169 находок, прошедших адверсариальную
верификацию (Задача 9), 159 подтверждены полностью (ПОДТВЕРЖДЕНО) и 10 подтверждены частично
(ЧАСТИЧНО) с уточнением деталей или серьёзности; ни одна находка не была опровергнута. После слияния
14 групп дублирующихся находок (одна и та же проблема, найденная из разных измерений — итого 33 ID
объединены в 14 строк) и применения понижений серьёзности из вердиктов ЧАСТИЧНО (4 находки по
офлайн-подсистеме mobile) получаем **150 уникальных проблем**: **6 Critical, 34 High, 55 Medium,
55 Low**.

Самые опасные проблемы: (1) агент печати/сканирования (`agent/`) не имеет аутентификации ни на одном
эндпоинте и слушает на всех сетевых интерфейсах — любое устройство в той же Wi-Fi-сети может печатать,
менять конфигурацию принтеров и открывать порты сканера без каких-либо учётных данных
(AGENT-SEC-01/02/03); (2) backend имеет захардкоженный fallback-секрет для проверки JWT
(BACKEND-SEC-01) и системное отсутствие проверки принадлежности tenant в ключевых чек-ин-эндпоинтах
(объединено BACKEND-SEC-03/SEC-05/QUAL-04/QUAL-05) — любой аутентифицированный пользователь любой
организации может читать/подделывать чек-ины и данные участников чужого мероприятия; (3) web-клиент
рендерит 30-дневный passwordless QR-токен входа персонала через сторонний сервис `api.qrserver.com`
как GET-параметр (WEB-SEC-01), утекая токен третьей стороне при каждом открытии диалога.

Сканеры дополнительно нашли: достижимую SQL-инъекцию в `pgx` (GO-2026-5004) и два бага стандартной
библиотеки Go (`crypto/tls`, `os`), закрываемые одним патч-апдейтом тулчейна go1.26.4→go1.26.5; 16
уязвимых npm-пакетов на web/desktop и 11 на landing (vite, axios, next, react-router и 13 транзитивных
пакетов инструментов сборки); достижимую через IPC уязвимость Origin Confusion в Rust-крейте `tauri`
(CVE-2026-42184). План обновления зависимостей (Раздел 5) организован в 16 партий по 5 подсистемам —
почти все обновления minor/patch; ни один пакет не требует мажора по причине прекращения поддержки
(единственный риск сопровождения без CVE — `github.com/skip2/go-qrcode`, не тегирован с 2020 года).
Во всех 6 подсистемах отсутствует автоматизированное тестовое покрытие (0 тестовых файлов везде, кроме
одного сломанного Playwright-теста в landing) — это сквозная системная проблема, отражённая отдельными
QUAL-находками в каждой подсистеме.

## 2. Сводная таблица находок

Отсортировано: Critical → High → Medium → Low; внутри серьёзности — по подсистеме (Agent, Backend,
Desktop, Landing, Mobile, Web). Объединённые дубликаты перечисляют все исходные ID через запятую;
серьёзность объединённой строки — максимум из объединяемых находок. Полные детали — в Разделе 3.

### Critical (6)

| ID | Подсистема | Серьёзность | Заголовок | Файл |
|---|---|---|---|---|
| AGENT-SEC-01 | Agent | Critical | Полное отсутствие аутентификации на всех эндпоинтах агента | agent/main.go (весь `http.NewServeMux()`) |
| AGENT-SEC-02 | Agent | Critical | HTTP-сервер слушает на всех интерфейсах (0.0.0.0), а не только localhost | agent/main.go:1045,1052 |
| AGENT-SEC-03 | Agent | Critical | CORS не является реальной защитой — CSRF на печать/изменение конфигурации | agent/main.go:1020-1028 |
| BACKEND-SEC-01 | Backend | Critical | Fallback на захардкоженный JWT-секрет в middleware валидации токенов | backend/internal/middleware/jwt.go:29-33 |
| BACKEND-SEC-03, BACKEND-SEC-05, BACKEND-QUAL-04, BACKEND-QUAL-05 | Backend | Critical | Системное отсутствие проверки tenant в GetAttendees / UpdateAttendeeHandler / ZoneCheckIn | backend/internal/handler/attendees.go:97-110,182-246; zones.go:327-466 |
| WEB-SEC-01 | Web | Critical | Долгоживущий (30 дней) QR-токен входа персонала утекает на сторонний api.qrserver.com | web/src/pages/Users.tsx:233-237 |

### High (34)

| ID | Подсистема | Серьёзность | Заголовок | Файл |
|---|---|---|---|---|
| AGENT-BUG-01, AGENT-QUAL-02 | Agent | High | scanner.Manager не защищён мьютексом — гонка/паника на конкурентных map-операциях | agent/internal/scanner/scanner.go:225-269 |
| AGENT-SEC-04 | Agent | High | Агента можно превратить в прокси произвольных TCP-соединений (SSRF-подобный примитив) | agent/main.go:354-426; internal/printer/serial.go:86-103 |
| AGENT-BUG-02 | Agent | High | TOCTOU-гонка в /scanners/add + молчаливая перезапись — двойное открытие порта, утечка | agent/main.go:829-913 |
| AGENT-BUG-03 | Agent | High | NetworkPrinter.SendRaw не имеет write-deadline — запись может зависнуть навсегда | agent/internal/printer/serial.go:86-103 |
| BACKEND-SEC-02, BACKEND-QUAL-07 | Backend | High | Захардкоженный секрет `"your-secret-key"` в подписи JWT для QR-логина персонала | backend/internal/handler/qr_auth.go:36-46 |
| BACKEND-SEC-04 | Backend | High | GetAttendeeQR отдаёт чек-ин QR-код участника без проверки владения | backend/internal/handler/qr.go:12-38 |
| BACKEND-SEC-06 | Backend | High | Системное отсутствие проверки tenant во всех остальных обработчиках zones.go (18 хендлеров) | backend/internal/handler/zones.go |
| BACKEND-SEC-07 | Backend | High | API-ключи можно создавать/просматривать/отзывать для чужих мероприятий | backend/internal/handler/api_keys.go:17-91 |
| BACKEND-SEC-08 | Backend | High | QR-токен персонала хранится и отдаётся в открытом виде через GET /api/users | backend/internal/models/models.go:43; store/pg_store.go:226-244; handler/users.go:17-36 |
| BACKEND-BUG-01 | Backend | High | Состояние регистрации на зоне никогда не сохраняется в БД — чек-ин навсегда блокируется | backend/internal/handler/zones.go:372-386; store/pg_store.go |
| BACKEND-BUG-02 | Backend | High | Слепая перезапись всей строки attendee без блокировки — потерянные обновления | backend/internal/store/pg_store.go:503-523 |
| BACKEND-BUG-03 | Backend | High | UpdateAttendee никогда не сохраняет колонку `code` — правка кода тихо не применяется | backend/internal/store/pg_store.go:511-522 |
| BACKEND-BUG-04 | Backend | High | Загрузка шрифта мероприятия никогда не проходит аутентификацию (неверный type assertion) | backend/internal/handler/fonts.go:51-70 |
| BACKEND-QUAL-01 | Backend | High | Нулевое покрытие тестами всего backend (36 файлов, 7297 строк) | backend/internal/**, backend/cmd/** |
| DESKTOP-SEC-05, DESKTOP-BUG-01, DESKTOP-QUAL-02 | Desktop | High | CSP `connect-src` жёстко ограничен localhost:8008, но UI даёт настраивать произвольный backend URL | desktop/src-tauri/tauri.conf.json:18; src/lib/config.ts; src/pages/Connection.tsx |
| DESKTOP-SEC-01 | Desktop | High | IPC-команда `agent_request` строит URL без валидации пути → SSRF из доверенного Rust-процесса | desktop/src-tauri/src/commands.rs:11-44 |
| DESKTOP-BUG-02 | Desktop | High | Список участников грузится один раз без синхронизации — двойной чек-ин при нескольких киосках | desktop/src/pages/CheckinEvent.tsx:84-128,224-233,251-283 |
| DESKTOP-BUG-03 | Desktop | High | Проверка доступности агента выполняется один раз при монтировании — нет переподключения | desktop/src/pages/CheckinEvent.tsx:130-132; Equipment.tsx:123-154; src-tauri/src/lib.rs:15-29 |
| LANDING-BUG-01, LANDING-QUAL-17 | Landing | High | Кнопки скачивания на странице Download и "View Full Changelog" ничего не делают | landing/src/components/sections/Download.tsx:54-57,84-86 |
| LANDING-BUG-02, LANDING-BUG-07, LANDING-QUAL-05 | Landing | High | Главные CTA ("начать", "купить", demo) ведут на несуществующие якоря #signup/#demo | landing/src/components/sections/Pricing.tsx:113; FinalCTA.tsx:68; Hero.tsx:73-78 |
| MOBILE-SEC-01, MOBILE-QUAL-05 | Mobile | High | Cleartext-трафик разрешён глобально, приложение всегда обращается к dev HTTP-адресу, prod URL не используется | mobile/android-app/.../AndroidManifest.xml:39; shared/.../NetworkConstants*.kt |
| MOBILE-BUG-03, MOBILE-QUAL-06 | Mobile | High | Вся offline-sync подсистема не подключена к UI — реальный чек-ин не имеет офлайн-фоллбэка | mobile/shared/.../navigation/IdentoNavHost.kt; presentation/checkin/CheckinViewModel.kt |
| MOBILE-SEC-02 | Mobile | High | Полное логирование тела/заголовков HTTP (включая JWT и пароль) без отключения в релизе | mobile/android-app/.../NetworkModule.kt:33-35; shared/.../ApiClient.kt:40-43 |
| MOBILE-SEC-03 | Mobile | High | JWT и данные пользователя хранятся незашифрованными на диске (без Keystore/Keychain) | mobile/shared/.../DataStoreFactory.android.kt/.ios.kt |
| MOBILE-BUG-04 | Mobile | High | `runBlocking` в `BroadcastReceiver.onReceive` на главном потоке — риск ANR/deadlock при сканировании | mobile/android-app/.../HardwareScannerService.kt:214-232; BluetoothScannerService.kt:164-201 |
| MOBILE-QUAL-04 | Mobile | High | Печать бейджа и настройки принтера в shared-модуле — нерабочая заглушка, выдаваемая за успех | mobile/shared/.../CheckinViewModel.kt:319-349; SettingsViewModel.kt:114-151 |
| WEB-SEC-02 | Web | High | ZPL-инъекция через незаэкранированные данные QR-кода/штрихкода в шаблоне бейджа | web/src/utils/zpl.ts:180-231 |
| WEB-SEC-03 | Web | High | Данные участника рендерятся как Markdown без санитизации ссылок (потенциальный stored XSS) | web/src/pages/CheckinFullscreen.tsx:729-745; utils/markdownTemplate.ts:5-24 |
| WEB-SEC-04 | Web | High | JWT и профиль пользователя хранятся в localStorage без защиты от XSS-эксфильтрации | web/src/lib/api.ts:9-20; pages/Login.tsx и др. |
| WEB-BUG-01 | Web | High | Гонка при polling сканера может привести к повторной обработке одного скана | web/src/hooks/useScanner.ts:18-43,54 |
| WEB-BUG-02 | Web | High | `isFirstCheckin` вычисляется по устаревшему локальному состоянию, а не по ответу сервера | web/src/pages/CheckinFullscreen.tsx:267-325 |
| WEB-BUG-03 | Web | High | Редактор бейджей не предупреждает о потере несохранённых изменений | web/src/pages/BadgeTemplateEditorV2.tsx |
| WEB-QUAL-02 | Web | High | Настройка check-in киоска для конкретного события не долетает до CheckinFullscreen | web/src/pages/event/EventCheckin.tsx:13; CheckinFullscreen.tsx:83-87,244-254 |
| WEB-QUAL-03 | Web | High | «Поле типа бейджа» — два независимых несинхронизированных источника правды | web/src/pages/event/EventSettings.tsx; CheckinFullscreen.tsx |

### Medium (55)

| ID | Подсистема | Серьёзность | Заголовок | Файл |
|---|---|---|---|---|
| AGENT-SEC-05 | Agent | Medium | Содержимое печати (zpl/template) передаётся на принтер без валидации | agent/main.go:488-539 |
| AGENT-BUG-04 | Agent | Medium | SystemPrinter.SendRaw/PrintPDF/Status запускают lp/lpstat без таймаута | agent/internal/printer/system.go:189-287 |
| AGENT-BUG-05 | Agent | Medium | Конкурентные /print-запросы к одному сетевому принтеру не сериализуются | agent/internal/printer/serial.go:86-103 |
| AGENT-BUG-06 | Agent | Medium | Отключение сканера не детектируется — бесконечный цикл ошибок чтения | agent/internal/scanner/scanner.go:152-179 |
| AGENT-QUAL-01 | Agent | Medium | Полное отсутствие автотестов во всём модуле agent | agent/ (весь модуль) |
| AGENT-QUAL-03 | Agent | Medium | Мёртвый код SerialPrinter — задокументированная в README функция недостижима | agent/internal/printer/serial.go:12-65,117-136 |
| AGENT-QUAL-05 | Agent | Medium | Непоследовательная обработка ошибок сохранения конфигурации между похожими хендлерами | agent/main.go:404-471,846-911 |
| AGENT-QUAL-10 | Agent | Medium | Отсутствие абстракции возможностей принтера — PDF-поддержка определяется приведением типа | agent/main.go:566-576; internal/printer/printer.go:11-15 |
| BACKEND-SEC-09 | Backend | Medium | Отсутствие проверки tenant в управлении шрифтами мероприятия | backend/internal/handler/fonts.go |
| BACKEND-SEC-10 | Backend | Medium | Разрешающий CORS для всех источников на API с Bearer-токенами | backend/main.go:430-433 |
| BACKEND-SEC-11 | Backend | Medium | CSV-экспорт участников уязвим к формула-инъекции (CSV/Excel injection) | backend/internal/handler/attendee_codes.go:116-171 |
| BACKEND-SEC-12 | Backend | Medium | Отсутствие rate limiting на аутентификацию и чек-ин по короткому коду | backend/internal/handler/auth.go, zones.go |
| BACKEND-BUG-05 | Backend | Medium | Гонка при повторном сканировании в ZoneCheckIn возвращает 500 вместо идемпотентного ответа | backend/internal/handler/zones.go:404-439 |
| BACKEND-BUG-06 | Backend | Medium | `time.Truncate(24h)` как граница календарного дня — смещённые сутки для не-UTC мероприятий | backend/internal/store/pg_store_zones.go:133,414,472 |
| BACKEND-BUG-07 | Backend | Medium | SyncPush слепо принимает изменения клиента и глотает ошибки; SyncPull не сообщает об удалениях | backend/internal/handler/sync.go |
| BACKEND-BUG-08 | Backend | Medium | Диапазон дат в статистике использования тенанта исключает последний день периода | backend/internal/handler/super_admin.go:251-264; store/pg_store.go:1178-1201 |
| BACKEND-QUAL-02 | Backend | Medium | Три независимые несовместимые реализации генерации кода участника | backend/internal/handler/attendee_codes.go,bulk_import.go,attendees.go |
| BACKEND-QUAL-03 | Backend | Medium | Проверка tenant дублируется вручную в каждом хендлере и местами отсутствует | backend/internal/handler/*.go (10+ мест) |
| BACKEND-QUAL-06 | Backend | Medium | Несогласованная обработка "не найдено" в store — часть методов даёт (nil,nil), часть — ошибку | backend/internal/store/pg_store.go |
| BACKEND-QUAL-08 | Backend | Medium | CheckTenantLimit не реализован для "attendees_per_event" — заглушка current=0 | backend/internal/store/pg_store.go:1239-1258 |
| BACKEND-QUAL-09 | Backend | Medium | Несогласованный формат тела ошибки API — {"error"} vs {"message"} | backend/internal/handler/*.go |
| BACKEND-QUAL-10 | Backend | Medium | api_keys.go использует context.Background() вместо контекста запроса | backend/internal/handler/api_keys.go:51,71,86,111,179,188 |
| DESKTOP-SEC-06, DESKTOP-BUG-06 | Desktop | Medium | Окно киоска не защищено от выхода в ОС (нет fullscreen/kiosk-lock) | desktop/src-tauri/tauri.conf.json:23-32; src/pages/CheckinEvent.tsx:311-321 |
| DESKTOP-SEC-02 | Desktop | Medium | JWT и сессионные данные хранятся в localStorage без шифрования | desktop/src/lib/api.ts:4-19; pages/Login.tsx,QRLogin.tsx |
| DESKTOP-SEC-03 | Desktop | Medium | Разрешение shell:allow-open выдано без scope и не используется | desktop/src-tauri/capabilities/default.json:5-10 |
| DESKTOP-BUG-04 | Desktop | Medium | Отсутствие таймаута HTTP-клиента и авто-ретрая — риск зависания киоска | desktop/src/lib/api.ts:12-16; pages/CheckinEvent.tsx:84-128,494-505 |
| DESKTOP-BUG-05 | Desktop | Medium | Несогласованная валидация пустого/невалидного QR между режимами камеры и сканера | desktop/src/pages/CheckinEvent.tsx:188-233 |
| LANDING-BUG-06, LANDING-QUAL-07 | Landing | Medium | Footer ссылается на несуществующие страницы /privacy и /terms | landing/src/components/layout/Footer.tsx:36-47 |
| LANDING-BUG-03, LANDING-BUG-04, LANDING-QUAL-08 | Landing | Medium | Дефолтная локаль захардкожена трижды и разошлась с логикой next-intl | landing/proxy.ts:10-13; src/app/not-found.tsx:1-5; i18n/routing.ts:9 |
| LANDING-BUG-05, LANDING-QUAL-01 | Landing | Medium | Footer полностью не локализован — хардкод на английском в обеих локалях | landing/src/components/layout/Footer.tsx:6-33 |
| LANDING-BUG-09, LANDING-QUAL-06 | Landing | Medium | Якорные ссылки шапки (#features/#pricing/#faq) ломаются на /download и /pricing | landing/src/components/layout/Header.tsx:16-21 |
| LANDING-BUG-08, LANDING-QUAL-03 | Landing | Medium | Страница /pricing содержит хардкод-текст на английском в обход next-intl | landing/src/app/[locale]/pricing/page.tsx:6-14 |
| LANDING-SEC-01 | Landing | Medium | В next.config.mjs не заданы security-заголовки (CSP, X-Frame-Options, HSTS) | landing/next.config.mjs:5-8 |
| LANDING-QUAL-10 | Landing | Medium | Playwright-тест не соответствует реальной разметке LanguageSwitcher | landing/tests/landing.spec.ts:91-93 |
| LANDING-QUAL-11 | Landing | Medium | Тесты landing не подключены ни к npm-скриптам, ни к CI | landing/package.json; .github/workflows/ci.yml |
| MOBILE-SEC-06 | Mobile | Medium | Logout — только локальная очистка, серверная инвалидация токена не выполняется | mobile/shared/.../AuthRepository.kt:84-91; AuthApiService.kt:92-98 |
| MOBILE-BUG-01 | Mobile | Medium (понижено с Critical) | Offline-хранилище чек-инов на Android — заглушка в памяти, данные теряются | mobile/shared/.../OfflineDatabase.android.kt:7-35 |
| MOBILE-BUG-07 | Mobile | Medium | NPE-риск от `!!` на selectedAttendee, гонка с автозакрытием по таймеру | mobile/shared/.../CheckinScreen.kt:124-133,346-357 |
| MOBILE-BUG-08 | Mobile | Medium | Утечка ресурсов ML Kit — новый BarcodeScanner создаётся на каждый кадр без закрытия | mobile/android-app/.../QRScannerScreen.kt:575-610 |
| MOBILE-QUAL-02 | Mobile | Medium | mobile/android-app полностью дублирует mobile/shared независимой реализацией | mobile/android-app/settings.gradle.kts:17-19; app/build.gradle.kts |
| MOBILE-QUAL-03 | Mobile | Medium | Модели одних и тех же сущностей разошлись по полям между двумя реализациями | mobile/shared vs android-app: Attendee.kt, Event.kt |
| MOBILE-QUAL-11 | Mobile | Medium | Каталог версий Gradle не подключён — версии дублируются вручную и уже разошлись | mobile/android-app/gradle/libs.versions.toml |
| WEB-SEC-05 | Web | Medium | Доступ к super-admin разделу проверяется только на клиенте по localStorage | web/src/App.tsx:31-45; components/Layout.tsx:76 |
| WEB-BUG-04 | Web | Medium | Сохранение шаблона бейджа перезаписывает событие устаревшим снимком | web/src/pages/BadgeTemplateEditorV2.tsx:208-247; event/EventSettings.tsx:90-116 |
| WEB-BUG-05 | Web | Medium | Импорт CSV не учитывает кодировку файла — кириллица может стать "кракозябрами" | web/src/components/CSVImportEnhanced.tsx:68-90 |
| WEB-BUG-06 | Web | Medium | Гонка состояний при быстрой смене CSV-файла | web/src/components/CSVImportEnhanced.tsx:60-90,165-177 |
| WEB-BUG-07 | Web | Medium | Нет ограничения размера/строк CSV, парсинг не в worker — риск зависания вкладки | web/src/components/CSVImportEnhanced.tsx:60-118 |
| WEB-BUG-08 | Web | Medium | Форматтеры дат падают на невалидной дате, ErrorBoundary в приложении нет | web/src/utils/dateFormat.ts:6-83 |
| WEB-BUG-09 | Web | Medium | Falsy-проверка данных для полей бейджа отбрасывает валидные нулевые значения | web/src/utils/zpl.ts:91,190,219 |
| WEB-QUAL-01 | Web | Medium | Полное отсутствие тестового покрытия веб-приложения | web/package.json; web/src/ (74 файла) |
| WEB-QUAL-04 | Web | Medium | Восстановление сетевых принтеров из localStorage не срабатывает (устаревшее замыкание) | web/src/pages/EquipmentSettings.tsx:109-137 |
| WEB-QUAL-05 | Web | Medium | Логика выбора принтера по умолчанию продублирована в трёх местах с разным приоритетом | web/src/pages/BadgeTemplateEditorV2.tsx,EquipmentSettings.tsx,CheckinFullscreen.tsx |
| WEB-QUAL-06 | Web | Medium | BadgeTemplateEditorV2.tsx — 1135 строк со смешанными ответственностями | web/src/pages/BadgeTemplateEditorV2.tsx:1-1135 |
| WEB-QUAL-07 | Web | Medium | EquipmentSettings.tsx — 1002 строки, объединяющие принтеры/сканеры/камеру/COM-порты | web/src/pages/EquipmentSettings.tsx:1-1003 |
| WEB-QUAL-09 | Web | Medium | Ключи localStorage и парсинг auth-данных продублированы без единого модуля | web/src/ (9 файлов) |

### Low (55)

| ID | Подсистема | Серьёзность | Заголовок | Файл |
|---|---|---|---|---|
| AGENT-BUG-07 | Agent | Low | printer.Manager никогда не вызывает Close() у заменяемых/удаляемых принтеров | agent/internal/printer/printer.go:59-63,89-95 |
| AGENT-BUG-08 | Agent | Low | Пустое PDF-задание печати не отклоняется на /print-pdf | agent/main.go:542-598 |
| AGENT-QUAL-04 | Agent | Low | main.go — "god file" на 1069 строк с несколькими не связанными ответственностями | agent/main.go:1-1069 |
| AGENT-QUAL-06 | Agent | Low | scanner.Manager.RemoveScanner всегда возвращает nil — фиктивная сигнатура ошибки | agent/internal/scanner/scanner.go:260-269 |
| AGENT-QUAL-07 | Agent | Low | Дублирование скелета exec-команды между SendRaw и PrintPDF | agent/internal/printer/system.go:189-253 |
| AGENT-QUAL-08 | Agent | Low | Паттерн "загрузить конфиг → изменить срез → сохранить" дублируется в 4 хендлерах | agent/main.go:385-972 |
| AGENT-QUAL-09 | Agent | Low | Магические числа (baud rate, порт, таймауты) без именованных констант | agent/internal/printer/serial.go:21; scanner.go; main.go |
| BACKEND-SEC-13 | Backend | Low | Пароль передаётся как аргумент командной строки в утилите reset_password | backend/cmd/reset_password/main.go:19-24 |
| BACKEND-BUG-09 | Backend | Low | Register создаёт tenant/user/членство в трёх нетранзакционных шагах | backend/internal/handler/auth.go:39-115 |
| BACKEND-BUG-10 | Backend | Low | CheckZoneAccess разыменовывает attendee без проверки на nil | backend/internal/store/pg_store_zones.go:578-590 |
| BACKEND-BUG-11 | Backend | Low | GenerateAttendeeCodes тихо пропускает участников при коллизии кода | backend/internal/handler/attendee_codes.go:35-46 |
| BACKEND-QUAL-11 | Backend | Low | pg_store.go — 1320 строк, смешаны ~10 доменов в одном файле | backend/internal/store/pg_store.go |
| BACKEND-QUAL-12 | Backend | Low | zones.go (handler) — 676 строк, смешаны 6 разных зон ответственности | backend/internal/handler/zones.go |
| BACKEND-QUAL-13 | Backend | Low | Непроверяемое приведение типа c.Get("user") повторено 32 раза в 11 файлах | backend/internal/handler/*.go |
| BACKEND-QUAL-14 | Backend | Low | main.go встраивает устаревшую неполную копию OpenAPI-спецификации | backend/main.go:16-386; backend/openapi.yaml |
| BACKEND-QUAL-15 | Backend | Low | Мёртвые пустые директории backend/handlers и backend/models | backend/handlers/, backend/models/ |
| DESKTOP-SEC-04 | Desktop | Low | withGlobalTauri:true без необходимости расширяет глобальную поверхность IPC | desktop/src-tauri/tauri.conf.json:13 |
| DESKTOP-QUAL-01 | Desktop | Low | Полное отсутствие автотестов для критичных сценариев | desktop/package.json; src/, src-tauri/src |
| DESKTOP-QUAL-03 | Desktop | Low | CheckinEvent.tsx — 582 строки со смешением ответственностей | desktop/src/pages/CheckinEvent.tsx:1-583 |
| DESKTOP-QUAL-04 | Desktop | Low | Equipment.tsx — 576 строк со смешением ответственностей | desktop/src/pages/Equipment.tsx:1-577 |
| DESKTOP-QUAL-05 | Desktop | Low | Дублирование бизнес-логики между desktop и web без переиспользования | desktop/src/lib/api.ts,markdownTemplate.ts vs web/ |
| DESKTOP-QUAL-06 | Desktop | Low | Порт агента (12345) захардкожен независимо в трёх местах | desktop/src-tauri/src/commands.rs:5-6; src/lib/agent.ts:6; i18n.ts |
| DESKTOP-QUAL-07 | Desktop | Low | Несогласованная обработка ошибок по всему приложению | desktop/src/pages/*.tsx; src-tauri/src/commands.rs |
| DESKTOP-QUAL-08 | Desktop | Low | Отсутствует конфигурация ESLint — скрипт lint в desktop нерабочий | desktop/package.json:7 |
| DESKTOP-QUAL-09 | Desktop | Low | Мёртвый код — присвоение api.defaults.baseURL не имеет эффекта | desktop/src/pages/Connection.tsx:45-50; lib/api.ts:17-24 |
| LANDING-SEC-02 | Landing | Low | Внешняя ссылка с target="_blank" без rel="noopener noreferrer" | landing/src/components/layout/Header.tsx:44-99 |
| LANDING-BUG-10 | Landing | Low | Метаданные (title/description/og:url) не переопределяются для /pricing и /download | landing/src/app/[locale]/layout.tsx:11-66 |
| LANDING-QUAL-02 | Landing | Low | ThemeToggle — подписи пунктов меню темы захардкожены на английском | landing/src/components/ThemeToggle.tsx:24-35 |
| LANDING-QUAL-04 | Landing | Low | SEO-метаданные дублируют контент отдельно от общего i18n-каталога | landing/src/app/[locale]/layout.tsx:18-26 |
| LANDING-QUAL-09 | Landing | Low | Мёртвый компонент — весь select.tsx (161 строка) нигде не используется | landing/src/components/ui/select.tsx:1-161 |
| LANDING-QUAL-12 | Landing | Low | Заголовок секции скопирован почти дословно в 7 файлах | landing/src/components/sections/*.tsx |
| LANDING-QUAL-13 | Landing | Low | Магические числовые диапазоны жёстко привязывают код к длине массивов в i18n | landing/src/components/sections/UseCases.tsx:56,Pricing.tsx:94 |
| LANDING-QUAL-14 | Landing | Low | Ключи сравнительной таблицы Comparison продублированы в трёх местах | landing/src/components/sections/Comparison.tsx:7-83 |
| LANDING-QUAL-15 | Landing | Low | Мёртвые CSS-переменные для градиентов | landing/src/styles/globals.css:52-53 |
| LANDING-QUAL-16 | Landing | Low | Неиспользуемый неймспейс "HomePage" в обоих i18n-каталогах | landing/messages/en.json,ru.json:2-19 |
| MOBILE-SEC-04 | Mobile | Low | Правила бэкапа Android не приведены в соответствие с реальным расположением данных | mobile/android-app/.../AndroidManifest.xml:32-34; backup_rules.xml |
| MOBILE-SEC-05 | Mobile | Low | Избыточное разрешение RECEIVE_BOOT_COMPLETED без соответствующего получателя | mobile/android-app/.../AndroidManifest.xml:28 |
| MOBILE-BUG-02 | Mobile | Low (понижено с High) | NetworkMonitor на Android всегда возвращает "онлайн" | mobile/shared/.../NetworkMonitor.android.kt:10-22 |
| MOBILE-BUG-05 | Mobile | Low (понижено с Medium) | Race condition в SyncService.performSync() — возможна двойная отправка чек-ина | mobile/shared/.../SyncService.kt:55-88 |
| MOBILE-BUG-06 | Mobile | Low (понижено с Medium) | Постоянные ошибки чек-ина бесконечно повторяются в офлайн-очереди без учёта попыток | mobile/shared/.../OfflineCheckInRepository.kt:78-98 |
| MOBILE-BUG-09 | Mobile | Low | TokenManager.getToken() использует collect на незавершающемся Flow — гарантированно зависнет | mobile/android-app/.../TokenManager.kt:50-56 |
| MOBILE-QUAL-01 | Mobile | Low | Полное отсутствие тестов при задекларированной тестовой инфраструктуре | mobile/shared,android-app build.gradle.kts |
| MOBILE-QUAL-07 | Mobile | Low | Несогласованная модель обработки ошибок между shared и android-app | mobile/shared/.../ApiResult.kt vs android-app/.../EventRepository.kt |
| MOBILE-QUAL-08 | Mobile | Low | Магические числа в генераторе ZPL для бейджей | mobile/android-app/.../BadgeTemplate.kt:34-90+ |
| MOBILE-QUAL-09 | Mobile | Low | Файлы Compose-экранов свыше 400 строк смешивают несколько ответственностей | mobile/shared/.../CheckinScreen.kt (867); android-app/.../QRScannerScreen.kt (742) |
| MOBILE-QUAL-10 | Mobile | Low | Готовая система локализации в shared обходится хардкодом строк в бизнес-коде | mobile/shared/.../SettingsViewModel.kt |
| MOBILE-QUAL-12 | Mobile | Low | Избыточное использование `!!` там, где уже есть безопасные альтернативы | mobile/android-app/.../EventRepository.kt,AuthRepository.kt |
| WEB-SEC-06 | Web | Low | Слабая политика длины пароля на клиенте (только 6 символов) | web/src/pages/Register.tsx:19; Users.tsx:40 |
| WEB-BUG-10 | Web | Low | Таймер тестирования сканера не останавливается при размонтировании компонента | web/src/pages/EquipmentSettings.tsx:92,358-422 |
| WEB-BUG-11 | Web | Low | Поток чек-ина не имеет обработки офлайн-режима и повторной синхронизации | web/src/pages/CheckinFullscreen.tsx:267-325; hooks/useScanner.ts |
| WEB-QUAL-08 | Web | Low | Дублирование ~110 строк JSX между диалогами создания и редактирования зоны | web/src/pages/event/EventZones.tsx:356-581 |
| WEB-QUAL-10 | Web | Low | Несогласованная обработка подтверждения удаления — confirm() vs кастомный Dialog | web/src/components/FontManager.tsx,APIKeysManager.tsx и др. |
| WEB-QUAL-11 | Web | Low | Отладочные console.log оставлены в продовых путях кода | web/src/components/PrintBadgeDialog.tsx,pages/EventLayout.tsx и др. |
| WEB-QUAL-12 | Web | Low | Несогласованное форматирование дат — часть экранов игнорирует локаль приложения | web/src/components/AttendeeMovementTimeline.tsx и др. (6 файлов) |
| WEB-QUAL-13 | Web | Low | Неработающая кнопка «Delete Event» в Danger Zone | web/src/pages/event/EventSettings.tsx:408-421 |

## 3. Детали находок

Блоки сгруппированы по серьёзности (Critical → High → Medium → Low), внутри — по подсистеме. Для
объединённых находок указаны все исходные ID и обоснование объединения; серьёзность — максимум из
объединяемых находок. Для находок с вердиктом ЧАСТИЧНО указана внесённая коррекция.

### 3.1 Critical

#### AGENT-SEC-01 — Полное отсутствие аутентификации на всех эндпоинтах агента
**Файл:** agent/main.go:234-997 (весь `http.NewServeMux()`, включая `/print`, `/print-pdf`,
`/printers/add`, `/printers/remove`, `/scanners/add`, `/scanners/remove`)
Ни один обработчик агента печати/сканирования не проверяет токен/ключ/сессию; ни кодовая база, ни
web/desktop-клиенты не отправляют auth-заголовки — аутентификация отсутствует архитектурно. Любое
устройство, способное достучаться до порта агента, может печатать, добавлять/удалять принтеры, менять
принтер по умолчанию или открывать/закрывать порты сканера. Усугубляется AGENT-SEC-02 (бинд на все
интерфейсы) и AGENT-SEC-03 (обход CORS). **Рекомендация:** обязательная аутентификация (например,
случайный локальный токен, выдаваемый при старте по доверенному каналу) на каждом мутирующем/
раскрывающем данные эндпоинте.

#### AGENT-SEC-02 — HTTP-сервер слушает на всех интерфейсах (0.0.0.0), а не только localhost
**Файл:** agent/main.go:1045 (`Addr: ":" + *port`), :1052 (`server.ListenAndServe()`)
Пустой host в `Addr` заставляет сервер слушать все интерфейсы, флага для ограничения на loopback нет.
Любое устройство в той же Wi-Fi/LAN-сети (кафе, площадка мероприятия, коворкинг) может напрямую
обратиться к API по IP, минуя браузер/CORS полностью; в сочетании с AGENT-SEC-01 — полный
неаутентифицированный контроль по LAN. **Рекомендация:** биндиться на 127.0.0.1 по умолчанию, требуя
явного opt-in флага и аутентификации для более широкой доступности.

#### AGENT-SEC-03 — CORS не является реальной защитой — сайт-злоумышленник может вызвать печать/изменение конфигурации (CSRF)
**Файл:** agent/main.go:1020-1028 (`cors.New`), плюс отсутствие проверки `Content-Type` во всех
хендлерах, декодирующих JSON
README прямо полагается на CORS как production-границу безопасности, но `rs/cors` всегда выполняет
реальный хендлер для не-preflight запросов независимо от Origin — CORS влияет только на то, может ли
JS атакующего прочитать ответ. Ни один хендлер не проверяет `Content-Type` перед декодированием JSON,
поэтому простые кросс-доменные запросы обходят preflight и достигают хендлеров беспрепятственно —
вредоносная веб-страница может вызвать реальную печать/изменение конфигурации (CSRF).
**Рекомендация:** не полагаться на CORS как на контроль доступа; добавить серверную аутентификацию
(естественно устраняет CSRF) и/или строгие проверки `Content-Type`/`Sec-Fetch-Site`.

#### BACKEND-SEC-01 — Fallback на захардкоженный JWT-секрет в middleware валидации токенов
**Файл:** backend/internal/middleware/jwt.go:29-33
`middleware.JWT()` при отсутствии `JWT_SECRET` тихо подставляет захардкоженную строку
`"idento_secret_key_change_me"`, тогда как выпуск токена (`generateTokenForTenant`, auth.go:204-208)
жёстко требует `JWT_SECRET` и фейлится без него — асимметричное поведение "fail open" на проверке.
main.go не проверяет наличие `JWT_SECRET` при старте. Если на каком-либо окружении секрет не задан,
сервер всё равно запускается и принимает как валидные JWT, подписанные HS256 известной всем (из
исходников) строкой — любой внешний атакующий может сгенерировать токен с произвольными `user_id`/
`tenant_id`/`role` (включая admin для любого чужого tenant) — полный обход аутентификации для всей
мульти-тенантной системы. **Рекомендация:** убрать дефолт полностью, фейлиться при пустом секрете и
проверять его наличие при старте (`log.Fatal`).

#### BACKEND-SEC-03, BACKEND-SEC-05, BACKEND-QUAL-04, BACKEND-QUAL-05 — Системное отсутствие проверки tenant в GetAttendees / UpdateAttendeeHandler / ZoneCheckIn
**Файл:** backend/internal/handler/attendees.go:97-110 (GetAttendees), :182-246 (UpdateAttendeeHandler);
backend/internal/handler/zones.go:327-466 (ZoneCheckIn)
**Обоснование объединения:** четыре независимые находки указывают на один и тот же код с одним и тем
же дефектом (отсутствие сверки `event.TenantID` с tenant вызывающего), найденным из разных измерений:
BACKEND-SEC-03 (Critical) описывает оба хендлера `attendees.go`; BACKEND-QUAL-04 (High) независимо
описывает только `UpdateAttendeeHandler`; BACKEND-QUAL-05 (High) независимо описывает `GetAttendees` и
`ZoneCheckIn`; BACKEND-SEC-05 (Critical) описывает `ZoneCheckIn`, дополнительно отмечая отсутствие
проверки назначения персонала на зону (`staff_zone_assignments`), которого нет в QUAL-05. Максимальная
серьёзность объединения — Critical.
Ни `GetAttendees` (список участников мероприятия), ни `UpdateAttendeeHandler` (обновление статуса
чек-ина/расчекина), ни `ZoneCheckIn` (чек-ин по зоне, POST /api/zones/checkin) не сверяют tenant
вызывающего с владельцем event/zone — единственная проверка в `ZoneCheckIn` это бизнес-правила (зона
активна, время работы, категория доступа), но не авторизация. Любой аутентифицированный пользователь
любой организации (включая самостоятельно зарегистрированного в trial-организации) может: прочитать
полный список участников (ФИО, email, компания, custom_fields) чужого мероприятия; отметить
чек-ин/расчекин произвольного участника чужого мероприятия; выполнить чек-ин произвольного участника в
произвольной зоне чужого мероприятия, создавая поддельные записи `zone_checkins`. Это прямое нарушение
горизонтальной изоляции арендаторов для самого чувствительного сценария — чек-ина.
**Рекомендация:** получить `event`/`tenant_id` из JWT и явно сверить `event.TenantID == tenantID` во
всех трёх хендлерах, по образцу уже существующих проверок в `BlockAttendee`/`DeleteAttendee`; в
`ZoneCheckIn` дополнительно проверять назначение персонала на зону (`GetZoneStaffAssignments`).

#### WEB-SEC-01 — Долгоживущий QR-токен для входа staff отправляется на сторонний публичный сервис api.qrserver.com
**Файл:** web/src/pages/Users.tsx:233-237
QR-токен персонала (действителен 30 дней, `qr_auth.go` — обладание токеном = полная аутентификация без
пароля) рендерится через `<img src="https://api.qrserver.com/...&data=${qrToken}">` — токен передаётся
как GET-параметр третьей стороне при каждом открытии диалога, а также любым сетевым наблюдателям и
логам CDN/прокси. Любой перехвативший токен может войти под этим сотрудником на срок до 30 дней без
пароля. **Рекомендация:** генерировать QR локально (например, уже используемой библиотекой `qrcode`)
или отдавать его через аутентифицированный собственный эндпоинт; пересмотреть TTL/ротацию/отзыв токена.

### 3.2 High

#### AGENT-BUG-01, AGENT-QUAL-02 — scanner.Manager не защищён мьютексом — гонка/паника на конкурентных map-операциях
**Файл:** agent/internal/scanner/scanner.go:225-269
**Обоснование объединения:** QUAL-02 явным текстом вердикта указывает "идентично AGENT-BUG-01" — это
одна и та же находка, описанная дважды из разных измерений.
Карта `Manager.scanners` не защищена мьютексом (в отличие от `printer.Manager`, явно защищённого
`sync.RWMutex`). Поскольку каждый HTTP-запрос выполняется в своей горутине, конкурентные GET /scanners
вместе с add/remove гонятся за картой, обычно приводя к фатальному "concurrent map read/write" и
падению всего процесса — вместе со сканированием падает и печать. **Рекомендация:** добавить
`sync.RWMutex` в `scanner.Manager`, покрыть тестами с `-race`.

#### AGENT-SEC-04 — Агента можно превратить в прокси для отправки произвольных TCP-данных на любой IP:port (SSRF-подобный примитив)
**Файл:** agent/main.go:354-426 (`/printers/add`); agent/internal/printer/serial.go:86-103
(`NetworkPrinter.SendRaw`)
`/printers/add` принимает произвольные `ip`/`port` без allow-list; `/print` затем заставляет агента
открыть сырой TCP-сокет и записать туда контролируемые атакующим байты. В сочетании с отсутствием
аутентификации (SEC-01/03) это превращает агента в SSRF-подобное реле для произвольных внутренних
адресов сети мероприятия/офиса. **Рекомендация:** ограничить `/printers/add` allow-list диапазонов и
требовать аутентификацию перед регистрацией новых устройств.

#### AGENT-BUG-02 — TOCTOU-гонка в /scanners/add + молчаливая перезапись в AddScanner — двойное открытие физического порта
**Файл:** agent/main.go:829-913; agent/internal/scanner/scanner.go:235-237 (`AddScanner`)
Серийный порт открывается вне `configMu` (намеренно, чтобы не блокировать конфиг), создавая TOCTOU-окно
между проверкой существования и регистрацией; два конкурентных `/scanners/add` для одного порта могут
оба открыть физический порт и оба зарегистрироваться, при этом проигравший молча перезаписывается (без
`Close()`). Итог — испорченные/расщеплённые чтения скана по двум живым инстансам и утечка
горутины/файлового дескриптора до перезапуска. **Рекомендация:** сериализовать
check-open-register одним мьютексом/локом на порт; `AddScanner` должен закрывать существующий инстанс
вместо перезаписи.

#### AGENT-BUG-03 — NetworkPrinter.SendRaw не устанавливает write-deadline — запись может зависнуть навсегда
**Файл:** agent/internal/printer/serial.go:86-103
Таймаут задан только для `Dial`; `conn.Write` не имеет никакого дедлайна, поэтому неотвечающий принтер
может заблокировать запись навсегда, а `WriteTimeout` HTTP-сервера обрывает только клиентское
соединение, но не саму зависшую горутину-обработчик. Повторные попытки против застрявшего принтера
накапливают утечку горутин/сокетов до исчерпания. **Рекомендация:** установить
`conn.SetWriteDeadline` перед `Write` и возвращать ошибку по таймауту.

#### BACKEND-SEC-02, BACKEND-QUAL-07 — Захардкоженный секрет подписи JWT в обработчике QR-логина персонала
**Файл:** backend/internal/handler/qr_auth.go:36-46
**Обоснование объединения:** обе находки описывают один и тот же дефект на одних и тех же строках
(подпись JWT литералом `"your-secret-key"` вместо `JWT_SECRET`/`generateTokenForTenant`); явно
перечислены как исключаемое дублирование в шапке backend-bug.md.
`LoginWithQR` (публичный, без аутентификации маршрут) дублирует логику построения claims вместо
переиспользования `generateTokenForTenant`, подписывая токен литералом `"your-secret-key"` — с
комментарием `// TODO: use env var`. Помимо хардкода секрета (CWE-798), на практике это ломает сам
сценарий QR-логина персонала: в любой корректно настроенной инсталляции (где `JWT_SECRET` задан, как
требуется для обычного логина) токены QR-логина не проходят валидацию `middleware.JWT()` — staff
получает 200 OK с нерабочим токеном. **Рекомендация:** заменить ручное построение JWT вызовом
`generateTokenForTenant`.

#### BACKEND-SEC-04 — GetAttendeeQR отдаёт QR-код (чек-ин код) участника без проверки владения
**Файл:** backend/internal/handler/qr.go:12-38
Хендлер получает участника по ID из любой организации и кодирует его реальный чек-ин код в PNG без
проверки принадлежности tenant (в отличие от `BadgeZPL`, где такая проверка есть). Пользователь другой
организации может получить действующий чек-ин QR-код любого участника чужого мероприятия по его ID и
потенциально использовать/распечатать его для несанкционированного прохода. **Рекомендация:** добавить
проверку `event.TenantID == tenantID`, аналогично `BadgeZPL`.

#### BACKEND-SEC-06 — Системное отсутствие проверки tenant во всех остальных обработчиках zones.go
**Файл:** backend/internal/handler/zones.go (18 хендлеров: CRUD зон, правил доступа, staff-назначений,
истории перемещений — не пересекается с ZoneCheckIn, который выделен в BACKEND-SEC-05/BACKEND-QUAL-05)
Ни один из 18 перечисленных хендлеров не сверяет tenant, и store-слой (`pg_store_zones.go`) тоже не
фильтрует по tenant_id ни в одном из соответствующих методов. Любой аутентифицированный пользователь
любой организации может читать/менять зоны, правила доступа, индивидуальные overrides, историю
перемещений участника, создавать/удалять зоны и назначать/снимать произвольных пользователей на зоны
чужой организации, зная/подобрав UUID. **Рекомендация:** единая проверка владения (event/zone →
tenant_id), применённая последовательно ко всем перечисленным маршрутам.

#### BACKEND-SEC-07 — API-ключи можно создавать, просматривать и отзывать для чужих мероприятий
**Файл:** backend/internal/handler/api_keys.go:17-91 (CreateAPIKey, GetAPIKeys, RevokeAPIKey)
Все три обработчика берут `event_id`/`key_id` из URL и вызывают Store без проверки принадлежности
tenant. Атакующий может создать API-ключ для чужого `event_id` и через публичный `/api/public/import`
внедрить произвольных «участников» в чужое мероприятие, просмотреть метаданные чужих ключей или отозвать
(DoS) действующий ключ чужой интеграции. **Рекомендация:** сверять `event.TenantID` с tenant из JWT
перед каждой операцией.

#### BACKEND-SEC-08 — QR-токен для быстрого входа персонала хранится и отдаётся в открытом виде через GET /api/users
**Файл:** backend/internal/models/models.go:43; store/pg_store.go:226-244 (GetUsersByTenantID);
handler/users.go:17-36 (GetUsers)
`qr_token` (фактически второй пароль — обладание = полная аутентификация через `LoginWithQR`)
сериализуется в JSON (`omitempty`, не `-` как у `PasswordHash`) и возвращается через `GET /api/users`,
доступный ролям admin и manager; в БД хранится и сравнивается как открытый текст (в отличие от bcrypt
для паролей/API-ключей). Пользователь с ролью manager может получить открытые QR-токены админов и войти
под их учётной записью — горизонтальная эскалация привилегий. **Рекомендация:** не включать `qr_token`
в ответы списочных эндпоинтов, хранить хеш токена в БД.

#### BACKEND-BUG-01 — Состояние регистрации на зоне никогда не сохраняется в БД — чек-ин с обязательной регистрацией не проходит навсегда
**Файл:** backend/internal/handler/zones.go:372-386 (ZoneCheckIn); backend/internal/store/pg_store.go
(CreateAttendee, GetAttendeesByEventID, GetAttendeeByCode, GetAttendeeByID, UpdateAttendee)
`ZoneCheckIn` выставляет `RegisteredAt`/`RegistrationZoneID`/`PacketDelivered` в памяти для зон
регистрации, но ни один SQL-запрос в store не упоминает эти три колонки — при том что миграция их
добавила. Любая зона, требующая регистрации (`requires_registration` по умолчанию TRUE), навсегда
блокирует чек-ин участника с 403 — весь сценарий мультизонального мероприятия с обязательной
регистрацией нерабочий. **Рекомендация:** добавить эти колонки в соответствующие
SELECT/INSERT/UPDATE-запросы, покрыть интеграционным тестом.

#### BACKEND-BUG-02 — Слепая перезапись всей строки attendee без блокировки — потерянные обновления при параллельном чек-ине/редактировании
**Файл:** backend/internal/store/pg_store.go:503-523 (UpdateAttendee); handler/attendees.go (5
хендлеров read-modify-write)
Все 5 хендлеров делают read-modify-write без версионирования/блокировки; `UpdateAttendee` одним
`UPDATE` перезаписывает весь отслеживаемый набор полей. Два конкурентных запроса на одного участника
(например, одновременное сканирование бейджа) молча теряют одно из обновлений без сигнала конфликта.
**Рекомендация:** частичный `UPDATE ... SET col=$1` по операции, оптимистичная блокировка или
атомарные `COALESCE`-обновления для чек-ина.

#### BACKEND-BUG-03 — UpdateAttendee никогда не сохраняет колонку code — исправление билетного кода тихо не применяется
**Файл:** backend/internal/store/pg_store.go:511-522 (SET-список UpdateAttendee); handler/attendees.go:
162-164 (UpdateAttendeeInfo)
`UpdateAttendeeInfo` меняет `attendee.Code` в памяти и возвращает клиенту 200 с "новым" кодом, но
SET-список `UpdateAttendee` не содержит `code` — БД сохраняет старое значение. Оператор, пытающийся
исправить дублирующийся/ошибочно отсканированный код, видит ложный успех. **Рекомендация:** добавить
`code = $N` в SET-список с обработкой уникального ограничения `(event_id, code)`.

#### BACKEND-BUG-04 — Загрузка шрифта мероприятия никогда не проходит аутентификацию — неверное приведение типа контекста
**Файл:** backend/internal/handler/fonts.go:51-70 (UploadEventFont); middleware/jwt.go:28-45
В отличие от 32 остальных мест, корректно делающих `c.Get("user").(*models.JWTCustomClaims)`,
`UploadEventFont` уникально приводит к `*jwt.Token`, хотя middleware кладёт в контекст
`*models.JWTCustomClaims` — приведение гарантированно проваливается для любого валидного токена, и
`POST /api/events/:event_id/fonts` всегда возвращает 401, даже с полностью валидным admin-токеном.
Как побочный эффект, это маскирует отсутствие проверки tenant из BACKEND-SEC-09 на пути загрузки.
**Рекомендация:** исправить приведение типа по стандартному паттерну, используемому везде.

#### BACKEND-QUAL-01 — Нулевое покрытие тестами всего backend
**Файл:** backend/internal/**, backend/cmd/** (36 файлов, 7297 строк)
Ноль файлов `*_test.go` во всём `internal`/`cmd` — не покрыты генерация/валидация JWT, чек-ин,
генерация кодов, проверка лимитов тенанта, генерация ZPL-этикеток, авторизация/мульти-тенантность.
Устаревший `coverage.out` подтверждает нулевое покрытие (все счётчики — 0). **Рекомендация:** начать с
юнит-тестов на модулях высокого риска (генерация/валидация токена, `ZoneCheckIn`, `CheckTenantLimit`,
генерация кодов) и добавить store-тесты через testcontainers.

#### DESKTOP-SEC-05, DESKTOP-BUG-01, DESKTOP-QUAL-02 — CSP connect-src жёстко ограничен plaintext HTTP-эндпоинтами, но UI предлагает настраивать произвольный backend URL
**Файл:** desktop/src-tauri/tauri.conf.json:18 (connect-src); desktop/src/lib/config.ts:1-21;
desktop/src/pages/Connection.tsx
**Обоснование объединения:** три находки описывают один и тот же дефект (CSP разрешает только
`localhost:8008`/`127.0.0.1:8008`, но `Connection.tsx`/`config.ts` реализуют настройку произвольного —
в том числе сетевого — backend URL); QUAL-02 своим текстом вердикта прямо ссылается "то же, что
DESKTOP-BUG-01/DESKTOP-SEC-05" (её ЧАСТИЧНО — только из-за ошибочной строки CSP в цитате, 12 вместо 18).
Максимальная серьёзность — High (из BUG-01/QUAL-02; SEC-05 — Medium).
`connect-src` жёстко перечисляет только два localhost-хоста; на любом реальном киоске, где backend не
на `localhost:8008` того же устройства (типичный случай для централизованного backend), WebView молча
блокирует все сетевые запросы политикой CSP — логин, чек-ин, загрузка участников перестают работать, при
этом ошибка выглядит как «сервер недоступен», а не как блокировка CSP. Если же в будущем CSP ослабят до
широкого списка, JWT и PII участников пойдут по сети открытым HTTP. **Рекомендация:** либо генерировать
`connect-src` динамически по сохранённому `idento_backend_url` (требуя HTTPS для нелокальных адресов),
либо проксировать все обращения к backend через Rust-команду (аналогично `agent_request`), обходя CSP
браузера.

#### DESKTOP-SEC-01 — IPC-команда agent_request строит URL без валидации пути → SSRF из доверенного Rust-процесса
**Файл:** desktop/src-tauri/src/commands.rs:11-44; lib.rs:11-14; src/lib/agent.ts:12-34
Команда строит URL наивной конкатенацией строк без парсинга; `path` полностью контролируется JS без
allow-list. Путь, содержащий `@` (например, `@evil.example.com/x`), заставляет WHATWG-парсер URL
трактовать `127.0.0.1:port` как userinfo и направить запрос на произвольный внешний хост — полноценный
SSRF из доверенного нативного процесса, в обход CSP `connect-src`. **Рекомендация:** строить URL через
`Url::parse(base).join(path)`, проверять итоговые host/port и дополнительно ограничить `path` явным
allow-list эндпоинтов агента.

#### DESKTOP-BUG-02 — Список участников загружается один раз и не синхронизируется — двойной чек-ин при нескольких киосках на одно событие
**Файл:** desktop/src/pages/CheckinEvent.tsx:84-128,224-233,251-283
`attendees` грузится один раз в `useEffect`, без поллинга/пересинхронизации; логика "первый/повторный
чек-ин" опирается полностью на устаревший локальный снимок. При нескольких киосках на одном мероприятии
один и тот же участник может быть отмечен «первым чек-ином» (с автопечатью) сразу на нескольких
станциях. **Рекомендация:** периодически опрашивать участников (10-30с) или перепроверять статус
чек-ина у сервера перед показом результата.

#### DESKTOP-BUG-03 — Проверка доступности локального агента выполняется один раз при монтировании — нет переподключения при сбое/гонке запуска
**Файл:** desktop/src/pages/CheckinEvent.tsx:130-132; Equipment.tsx:123-154; src-tauri/src/lib.rs:15-29
`agentConnected` выставляется одним вызовом `checkAgentHealth()` в `useEffect([])` без периодического
ретрая; Rust-сторона запускает sidecar единожды в `setup()` и только логирует ошибку без ретрая. Это
создаёт гонку запуска (фронтенд проверяет до поднятия HTTP-сервера сайдкара) и отсутствие восстановления
при падении/перезапуске агента во время долгой сессии киоска — сканер и печать бейджей молча перестают
работать. **Рекомендация:** периодический опрос здоровья (5-15с) и мониторинг/авто-рестарт процесса
sidecar на Rust-стороне.

#### LANDING-BUG-01, LANDING-QUAL-17 — Кнопки скачивания на странице Download и "View Full Changelog" ничего не делают
**Файл:** landing/src/components/sections/Download.tsx:54-57,84-86
**Обоснование объединения:** QUAL-17 своим текстом вердикта прямо указывает, что дублирует BUG-01 "один
в один (тот же файл/строки/влияние)". Максимальная серьёзность — High (из BUG-01; QUAL-17 — Medium).
Кнопки платформ (Windows/macOS/Linux/Android) и кнопка "View Full Changelog" — обычные `<Button>` без
`asChild`, `href` или `onClick`. Главный сценарий страницы `/download` (собственно скачивание
приложения и переход к changelog) полностью нерабочий на проде. **Рекомендация:** обернуть кнопки в
`asChild` + `<a href={downloadUrl} download>` с реальными URL артефактов сборки для каждой платформы.

#### LANDING-BUG-02, LANDING-BUG-07, LANDING-QUAL-05 — Все основные CTA "начать/купить/связаться" и "Watch Demo" ведут на несуществующие якоря #signup/#demo
**Файл:** landing/src/components/sections/Pricing.tsx:113; FinalCTA.tsx:68; Hero.tsx:73-78
**Обоснование объединения:** QUAL-05 своим текстом вердикта прямо указывает, что дублирует
"LANDING-BUG-02/07" — тот же набор `#signup`/`#demo` CTA. Максимальная серьёзность — High (из BUG-02;
BUG-07/QUAL-05 — Medium).
Все три CTA плана Pricing и кнопка FinalCTA ссылаются на `href="#signup"`, кнопка "Watch Demo" в Hero —
на `href="#demo"`; ни один элемент с таким `id` не существует нигде в проекте. Клик по любой из главных
конверсионных кнопок сайта (Pricing ×3, FinalCTA, Hero demo) не делает ничего, кроме изменения хеша
URL — основной сценарий конверсии сайта полностью нерабочий. **Рекомендация:** добавить реальные
signup/demo-секции или временно указать на существующий якорь.

#### MOBILE-SEC-01, MOBILE-QUAL-05 — Cleartext-трафик разрешён глобально, приложение всегда обращается к dev HTTP-адресу, production HTTPS URL не используется нигде
**Файл:** mobile/android-app/app/src/main/AndroidManifest.xml:39; mobile/shared/.../NetworkConstants.kt,
NetworkConstants.android.kt, NetworkConstants.ios.kt; android-app/.../NetworkModule.kt:22
**Обоснование объединения:** QUAL-05 своим текстом вердикта прямо указывает "совпадает с
MOBILE-SEC-01 по фактам" — один и тот же дефект, описанный из двух измерений. Обе High.
`usesCleartextTraffic="true"` задан без `network_security_config.xml`; `getDefaultBaseUrl()` жёстко
возвращает dev HTTP URL на обеих платформах, `PROD_BASE_URL` объявлен, но нигде не используется — нет
build-flavor/env переключения на HTTPS. Если приложение будет отгружено как есть, JWT/учётные
данные/PII участников пойдут в открытом виде, что эксплуатируется через MITM.
**Рекомендация:** убрать `usesCleartextTraffic`, добавить network security config, ограничивающий
cleartext только dev-хостами, подключить реальные build flavors, переключающие на `PROD_BASE_URL` в
релизе.

#### MOBILE-BUG-03, MOBILE-QUAL-06 — Вся offline-sync подсистема не подключена к UI — реальный сценарий чек-ина не имеет офлайн-фоллбэка
**Файл:** mobile/shared/.../navigation/IdentoNavHost.kt; presentation/checkin/CheckinViewModel.kt
(shared и android-app); data/sync/SyncService.kt
**Обоснование объединения:** обе находки описывают одну и ту же зону мёртвого кода (весь
zone-based offline-sync стек: `OfflineCheckInRepository`, `SyncService`, `ZoneSelectViewModel`,
`ZoneQRScannerViewModel`) — BUG-03 с точки зрения "нет офлайн-фоллбэка в реальном потоке", QUAL-06 с
точки зрения "мёртвый код, зарегистрированный в DI". Обе High.
`IdentoNavHost` не содержит маршрута на `ZoneSelectScreen`; `ZoneSelectViewModel`/
`ZoneQRScannerViewModel` не зарегистрированы даже в Koin `ViewModelModule`; `startAutoSync()` нигде не
вызывается. Реально достижимый `CheckinViewModel.checkinAttendee()` (и shared, и android-app) на
сетевой ошибке просто выставляет `errorMessage` без обращения к офлайн-очереди — реальные сбои чек-ина
на плохом Wi-Fi мероприятия теряются полностью, вопреки заявленной устойчивости к офлайну.
**Рекомендация:** подключить существующую offline-подсистему к реальному потоку чек-ина, либо построить
эквивалентную очередь непосредственно для него. Именно эта находка объясняет понижение серьёзности
MOBILE-BUG-01/02/05/06 (см. Раздел 3.4/Раздел 7) — они находятся в том же недостижимом коде.

#### MOBILE-SEC-02 — Полное логирование тела и заголовков HTTP-запросов/ответов (включая JWT и пароль при логине) без отключения в релизе
**Файл:** mobile/android-app/.../NetworkModule.kt:33-35; mobile/shared/.../ApiClient.kt:40-43;
android-app/.../AuthInterceptor.kt:29-32; LoginRequest.kt
`HttpLoggingInterceptor.Level.BODY` (android-app) и Ktor `LogLevel.BODY` (shared) включены безусловно,
без гейтинга через debug/release, логируя полные заголовки (включая `Authorization: Bearer <token>`) и
тела запроса/ответа логина (пароль, JWT) даже в релизных сборках — доступно через `adb logcat`, отчёты
об ошибках или вредоносные приложения на старом Android. **Рекомендация:** гейтить уровень логирования
через `BuildConfig.DEBUG`, никогда не логировать сырые пароли/токены даже в debug.

#### MOBILE-SEC-03 — JWT-токен и данные пользователя хранятся в незашифрованном виде на диске, без Keystore/Keychain
**Файл:** mobile/shared/.../DataStoreFactory.android.kt:14-20, DataStoreFactory.ios.kt:17-36;
AuthPreferences.kt:76-83; android-app/.../TokenManager.kt:34-40
JWT и данные пользователя хранятся через обычный Jetpack Preference DataStore поверх обычного файла (не
`EncryptedSharedPreferences`/Keystore на Android, не Keychain на iOS). Это раскрывает токены на
root-устройствах, через `adb backup` или незашифрованные бэкапы iTunes/Finder, либо при криминалистическом
извлечении — полный доступ к аккаунту до истечения токена. **Рекомендация:** использовать
EncryptedSharedPreferences/Security Crypto на Android и Keychain на iOS как минимум для токена.

#### MOBILE-BUG-04 — runBlocking внутри BroadcastReceiver.onReceive на главном потоке — риск ANR/deadlock при сканировании
**Файл:** mobile/android-app/.../HardwareScannerService.kt:214-232; BluetoothScannerService.kt:164-201
`BroadcastReceiver`, зарегистрированный без фонового `Handler`, выполняет `onReceive` на главном потоке
и вызывает `runBlocking { _scanResults.emit(it) }` на `MutableSharedFlow` с нулевым буфером; если
подписчик должен возобновиться на том же (заблокированном) главном потоке, это может привести к
deadlock/ANR во время сканирования штрихкода — реальный, достижимый путь сканера.
**Рекомендация:** избегать `runBlocking` в `onReceive`, использовать `tryEmit`/фоновую диспетчеризацию.

#### MOBILE-QUAL-04 — Печать бейджа и настройки принтера в shared-модуле — нерабочая заглушка, выдаваемая за успех
**Файл:** mobile/shared/.../CheckinViewModel.kt:319-349 (printBadge); SettingsViewModel.kt:114-151
`printBadge()` генерирует ZPL, но никогда не передаёт его в `BluetoothPrinterService`/
`EthernetPrinterService` — просто выставляет `successMessage = "Badge sent to printer"`; тот же паттерн
TODO-заглушки в настройках принтера. Поскольку `:shared` — единственная бизнес-логика для iOS-таргета,
печать бейджа (ключевая функция продукта) полностью нерабочая на iOS, при этом показывая ложное
сообщение об успехе. **Рекомендация:** реализовать реальные вызовы принтер-сервисов либо явно
скрыть/отключить функцию в UI до готовности.

#### WEB-SEC-02 — ZPL-инъекция через незаэкранированные данные QR-кода и штрихкода в шаблоне бейджа
**Файл:** web/src/utils/zpl.ts:180-205 (generateQRCodeZPL), :210-231 (generateBarcodeZPL)
В отличие от `generateTextZPL` (экранирует `\`, `^`, `~`), генераторы QR/штрихкода подставляют
контролируемые участником `qrData`/`barcodeData` напрямую в `^FD` без экранирования. Данные из
CSV-импорта или публичного API импорта могут внедрить сырые ZPL-команды (перенастройка/сброс принтера),
исполняемые в момент печати. **Рекомендация:** применить то же экранирование ко всем точкам вставки
`^FD`, централизованно в одной функции.

#### WEB-SEC-03 — Данные участника рендерятся как Markdown без санитизации ссылок (потенциальный stored XSS)
**Файл:** web/src/pages/CheckinFullscreen.tsx:729-745; event/EventSettings.tsx:377-382;
utils/markdownTemplate.ts:5-24
`renderMarkdownTemplate` подставляет значения полей участника (включая произвольные CSV/custom-поля) в
шаблон, рендерящийся через `<ReactMarkdown>` без `rehype-sanitize` где-либо в проекте и без фильтрации
URL-схем. Markdown-ссылка со схемой `javascript:` в поле участника (достижимо через CSV-импорт или
публичный API импорта) исполняет JS в сессии просматривающего сотрудника/админа — stored XSS,
усугубляемый WEB-SEC-04 до полного захвата аккаунта. **Рекомендация:** добавить rehype-sanitize или
переопределить рендереры `a`/`img`, блокируя небезопасные схемы.

#### WEB-SEC-04 — JWT и профиль пользователя хранятся в localStorage без защиты от XSS-эксфильтрации
**Файл:** web/src/lib/api.ts:9-20; pages/Login.tsx, Register.tsx, QRLogin.tsx;
components/OrganizationSwitcher.tsx; App.tsx
`token`/`user`/`tenants`/`current_tenant` хранятся в обычном (не httpOnly) localStorage, читаемом axios
interceptor'ом на каждый запрос. Любое выполнение JS на странице (например, из WEB-SEC-03) получает
полный доступ на чтение, позволяя эксфильтрацию долгоживущего bearer-токена и полный захват аккаунта,
включая флаг `is_super_admin`. **Рекомендация:** перейти на httpOnly+Secure+SameSite cookies, если
возможно; иначе — исправить WEB-SEC-03, сократить TTL, добавить CSP.

#### WEB-BUG-01 — Гонка при polling сканера может привести к повторной обработке одного скана
**Файл:** web/src/hooks/useScanner.ts:18-43 (pollScanner), :54 (setInterval(pollScanner, 200))
`pollScanner` не имеет флага "запрос в процессе"; `setInterval(..., 200)` не ждёт завершения
предыдущего вызова. Если цикл getLastScan+clearLastScan превышает 200мс, накладывающиеся вызовы могут
оба увидеть один и тот же неочищенный скан и оба сработать `setLastScan`, вызывая двойную обработку
одного физического скана — двойную печать бейджа (см. WEB-BUG-02). **Рекомендация:** флаг in-flight на
`useRef` или последовательный await-based цикл.

#### WEB-BUG-02 — isFirstCheckin вычисляется по устаревшему локальному состоянию, а не по ответу сервера
**Файл:** web/src/pages/CheckinFullscreen.tsx:267-325 (handleCheckin), строка 282
"Первый чек-ин" вычисляется из локального `attendee.checkin_status`, а не из ответа PUT; обновление
списка (`fetchAttendees`) выполняется без `await` уже после показа результата и печати. Быстрый
повторный чек-ин (или гонка из WEB-BUG-01) снова трактуется как «первый», перезаписывая
`checked_in_at` и повторно печатая бейдж. **Рекомендация:** определять "первый чек-ин" по флагу из
ответа сервера или блокировать повторный ввод до завершения запроса.

#### WEB-BUG-03 — Редактор бейджей не предупреждает о потере несохранённых изменений
**Файл:** web/src/pages/BadgeTemplateEditorV2.tsx (весь компонент)
Все правки макета бейджа живут только в локальном состоянии и сохраняются только по явному Save; нет
`onbeforeunload`, router-блокировщика или отслеживания "грязного" состояния. Переход со страницы или
закрытие вкладки молча уничтожает несохранённую работу. **Рекомендация:** отслеживать dirty-состояние и
добавить guard на переход/закрытие.

#### WEB-QUAL-02 — Настройка check-in киоска для конкретного события не долетает до CheckinFullscreen
**Файл:** web/src/pages/event/EventCheckin.tsx:13; CheckinFullscreen.tsx:83-87,244-254
Кнопка "Fullscreen Checkin" передаёт `?event=eventId`, но `CheckinFullscreenPage` нигде не читает
`useSearchParams`/`location.search`, вместо этого безусловно выбирая `response.data[0]` из
`/api/events`. При более чем одном активном мероприятии открывается чек-ин не того события — staff
чекинит/печатает бейджи под чужим мероприятием. **Рекомендация:** читать `event` из `useSearchParams()`
и выбирать это событие, если оно валидно.

#### WEB-QUAL-03 — «Поле типа бейджа» — два независимых несинхронизированных источника правды
**Файл:** web/src/pages/event/EventSettings.tsx:44,65,104; CheckinFullscreen.tsx:72,138-177
Настроенное админом "Badge Type Field" (сохраняется на сервере в `event.custom_fields`) не влияет на
реальный экран чек-ина, который использует собственную настройку из
`localStorage["checkin_settings"]` для конкретного браузера. Каждый киоск нужно настраивать отдельно, и
разные киоски одного мероприятия могут показывать разные поля типа бейджа. **Рекомендация:** убрать
дублирующее локальное состояние и читать из `event.custom_fields` в CheckinFullscreen, либо явно
разделить/задокументировать две настройки.

### 3.3 Medium

#### AGENT-SEC-05 — Содержимое печати (zpl/template) передаётся на принтер без валидации
**Файл:** agent/main.go:488-539
Сырой ZPL пересылается в `SendRaw` без проверки размера/формата или фильтрации опасных команд принтера
(сброс к заводским настройкам, перезапись flash); legacy-путь Template использует неэкранированную
подстановку, допуская ZPL-инъекцию через пользовательские данные. Любой, кто достигнет `/print`
(тривиально при SEC-01/03), может сбросить настройки принтера, перезаписать шаблоны/шрифты, повредить
оборудование или исчерпать расходники. **Рекомендация:** валидировать содержимое и экранировать
подставляемые значения `data`.

#### AGENT-BUG-04 — SystemPrinter.SendRaw/PrintPDF/Status запускают lp/lpstat без таймаута
**Файл:** agent/internal/printer/system.go:189-287
В отличие от discovery-вызовов (явно обёрнутых в `context.WithTimeout`), реальные операции
печати/статуса используют обычный `exec.Command` без таймаута; зависший CUPS-демон или офлайн-бэкенд
может заблокировать обработчик навсегда (тот же класс, что AGENT-BUG-03). **Рекомендация:**
`exec.CommandContext` с разумным таймаутом.

#### AGENT-BUG-05 — Конкурентные /print-запросы к одному сетевому принтеру не сериализуются
**Файл:** agent/internal/printer/serial.go:86-103
`GetPrinter` возвращает общий указатель на один инстанс для конкурентных запросов с одинаковым именем,
но `SendRaw` открывает независимый сокет на каждый вызов без очереди. Несколько одновременных `/print`
на один принтер (реалистично при нескольких операторах чек-ина) рискуют не выдержать соединения или
дать перемешанные/испорченные данные этикетки. **Рекомендация:** сериализовать отправку на принтер
(мьютекс или очередь заданий на уровне Manager).

#### AGENT-BUG-06 — Отключение сканера не детектируется — бесконечный цикл ошибок чтения без изменения состояния
**Файл:** agent/internal/scanner/scanner.go:152-179
При физическом отключении `ReadByte` возвращает устойчивую ошибку, которая только логируется и
повторяется каждые 100мс бесконечно, без авто-детекции, маркировки статуса или удаления — `GET
/scanners` продолжает показывать сканер как исправный. Спам логов и утечка горутины сохраняются до
ручного удаления. **Рекомендация:** трактовать N подряд не-таймаут ошибок как отключение,
авто-закрывать/удалять или выставлять поле статуса.

#### AGENT-QUAL-01 — Полное отсутствие автотестов во всём модуле agent
**Файл:** agent/ (весь модуль)
Ноль `*_test.go` файлов — не покрыты парсинг discovery, санитизация имён, буферизация сканера,
загрузка/сохранение конфига, подстановка шаблонов, вся HTTP-логика и конкурентность. Устаревший
`agent/coverage.out` подтверждает нулевое покрытие. **Рекомендация:** юнит-тесты (включая `-race`) для
Managers, парсинга discovery, персистентности конфига, рендеринга шаблонов; подключить `go test
./... -race` в CI.

#### AGENT-QUAL-03 — Мёртвый код SerialPrinter — задокументированная в README функция недостижима
**Файл:** agent/internal/printer/serial.go:12-65,117-136
`SerialPrinter`/`NewSerialPrinter`/`DiscoverSerialPrinters()` нигде не вызываются вне своего файла, при
этом README прямо заявляет о поддержке serial/USB-принтеров. Реальная инициализация подключает только
system/network/mock принтеры — вводящее в заблуждение заявление плюс неиспользуемый код.
**Рекомендация:** удалить мёртвый код либо реально подключить его и исправить README.

#### AGENT-QUAL-05 — Непоследовательная обработка ошибок сохранения конфигурации между похожими хендлерами
**Файл:** agent/main.go:404-471,846-911
`/printers/add` при ошибке `saveConfig` только логирует и всё равно возвращает 201, тогда как
`/printers/remove`/`/scanners/add`/`/scanners/remove` при той же ошибке корректно возвращают 500. Это
рассинхронизирует состояние в памяти с сохранённым конфигом незаметно для вызывающего — принтер молча
исчезает при следующем рестарте. **Рекомендация:** унифицировать поведение `/printers/add`, откатывать
добавление в память при ошибке сохранения.

#### AGENT-QUAL-10 — Отсутствие абстракции возможностей принтера — определение PDF-поддержки через приведение типа
**Файл:** agent/main.go:566-576; internal/printer/printer.go:11-15
`PrinterInterface` объявляет только `SendRaw`/`Status`, поэтому `/print-pdf` проверяет поддержку PDF
приведением к конкретному типу `*printer.SystemPrinter`, а не через интерфейсный метод — HTTP-слой
жёстко привязан к конкретной реализации. **Рекомендация:** добавить опциональный интерфейс
`PDFCapable` и проверять через него.

#### BACKEND-SEC-09 — Отсутствие проверки tenant в управлении шрифтами мероприятия
**Файл:** backend/internal/handler/fonts.go
`GetEventFonts`/`UploadEventFont`/`GetEventFontCSS` не сверяют tenant (и загрузки не защищены
`CheckLimits`), позволяя пользователю чужой организации просматривать шрифты/CSS или загружать файлы в
чужое мероприятие. **Вердикт ЧАСТИЧНО:** сценарий чтения (`GetEventFonts`/`GetEventFontCSS`) подтверждён
полностью эксплуатируемым; сценарий загрузки сейчас на практике недостижим из-за отдельного бага
BACKEND-BUG-04 (неверное приведение типа контекста даёт 401 раньше, чем код дойдёт до отсутствующей
проверки tenant) — риск по загрузке вернётся сразу после исправления BACKEND-BUG-04.
**Рекомендация:** добавить проверку `event.TenantID == tenantID` во всех трёх хендлерах и применить
`CheckLimits` к загрузке.

#### BACKEND-SEC-10 — Разрешающий CORS для всех источников на API с Bearer-токенами
**Файл:** backend/main.go:430-433
`AllowOrigins: []string{"*"}` вместе с разрешённым заголовком `Authorization` (комментарий в коде
признаёт "configure properly for production"). Расширяет поверхность атаки в сочетании с любым будущим
XSS на клиентах. **Рекомендация:** ограничить `AllowOrigins` конкретным списком доменов фронтенда через
переменную окружения.

#### BACKEND-SEC-11 — CSV-экспорт участников уязвим к формула-инъекции (CSV/Excel injection)
**Файл:** backend/internal/handler/attendee_codes.go:116-171
Поля участников (включая custom_fields из bulk/внешнего импорта) записываются в CSV без экранирования
ведущих `=`, `+`, `-`, `@`. Вредоносная формула, открытая сотрудником в Excel/Sheets, может выполнить
формулу/DDE-инъекцию на рабочей станции. **Рекомендация:** экранировать ячейки с такими ведущими
символами по рекомендациям OWASP.

#### BACKEND-SEC-12 — Отсутствие rate limiting на аутентификацию и чек-ин по короткому коду
**Файл:** backend/internal/handler/auth.go (Login, LoginWithQR), zones.go (ZoneCheckIn)
Пароль, QR-токен и attendee_code (~32 бита энтропии) не защищены ограничением частоты запросов нигде в
стеке — возможен онлайн-перебор паролей, кодов участников (усиливает объединённую находку
Critical-tenant-check) и QR-токенов персонала. **Рекомендация:** rate limiting по IP/email/zone_id на
`/auth/login`, `/auth/login-qr`, `/api/zones/checkin`.

#### BACKEND-BUG-05 — Гонка при повторном сканировании в ZoneCheckIn возвращает 500 вместо идемпотентного ответа
**Файл:** backend/internal/handler/zones.go:404-439
Незаблокированный check-then-act; уникальный индекс предотвращает порчу данных, но проигравший
конкурентный запрос получает сырую ошибку unique-violation, которую хендлер маппит в generic 500 вместо
идемпотентного «уже отмечен». Штатная гонка при одновременном сканировании бейджа на входе выглядит как
ошибка сервера. **Рекомендация:** детектировать код ошибки Postgres 23505 и возвращать идемпотентный
ответ.

#### BACKEND-BUG-06 — time.Truncate(24h) как граница календарного дня — смещённые сутки для не-UTC мероприятий
**Файл:** backend/internal/store/pg_store_zones.go:133,414,472; handler/zones.go:601-613
`Truncate(24h)` усекает от нулевого времени в UTC, а не от локальной полуночи, но используется как
граница "начала дня". Для мероприятий не в UTC это смещает границу "сегодня"/дня-N на величину
часового пояса, давая неверные `TodayCheckins`/`is_today`/`is_past`/`is_future` в часы возле полуночи.
**Рекомендация:** вычислять границы дня через `time.Date(...)` с явной локацией события/тенанта.

#### BACKEND-BUG-07 — SyncPush слепо принимает изменения клиента и глотает ошибки; SyncPull не сообщает об удалениях
**Файл:** backend/internal/handler/sync.go:44-167; store/pg_store_sync.go:47-84
`SyncPush` молча `continue`ит на любой ошибке записи (без логирования) и всегда отвечает 200; не
сравнивает `updated_at`, поэтому устаревшая офлайн-запись безусловно перезаписывает более новое
состояние сервера. `SyncPull` всегда возвращает пустой список `Deleted`, а базовый запрос не
фильтрует soft-deleted строки для непустого `since` — офлайн-клиенты никогда не узнают об удалениях на
сервере. **Рекомендация:** сравнивать таймстампы перед принятием изменений, отражать неудавшиеся ID в
ответе, реализовать реальный список `Deleted`.

#### BACKEND-BUG-08 — Диапазон дат в статистике использования тенанта исключает последний день периода
**Файл:** backend/internal/handler/super_admin.go:251-264; store/pg_store.go:1178-1201
`end_date` парсится как полночь и используется как верхняя граница `BETWEEN` — весь день после 00:00:00
исключается из отчётов по использованию (для контроля лимитов плана super-admin'ом). **Рекомендация:**
нормализовать `end_date` до конца дня или использовать `logged_at < end_date + 1 day`.

#### BACKEND-QUAL-02 — Три независимые несовместимые реализации генерации кода участника
**Файл:** backend/internal/handler/attendee_codes.go:175-179, bulk_import.go:154-163, attendees.go:74-76
8-символьный hex-код без проверки коллизий (attendee_codes.go), тот же формат с проверкой коллизий в
рамках запроса (bulk_import.go), и полный 36-символьный UUID с дефисами (attendees.go) — участники,
созданные разными путями в одном мероприятии, получают визуально/форматно несовместимые коды.
**Рекомендация:** централизовать генерацию кода в одной функции с проверкой уникальности на уровне БД.

#### BACKEND-QUAL-03 — Проверка "event.TenantID == текущий tenant" дублируется вручную в каждом хендлере и местами отсутствует
**Файл:** backend/internal/handler/attendees.go, events.go, badge_zpl.go, attendee_codes.go, sync.go
(10+ мест, две разные идиомы сравнения)
Копипастный паттерн проверки владения объясняет, почему проверка забывается в новых хендлерах (уже
привело к пробелу, задокументированному в объединённой Critical-находке SEC-03/SEC-05/QUAL-04/QUAL-05).
**Рекомендация:** извлечь общий хелпер (например, `loadEventForTenant`) или фильтровать по tenant_id
прямо в SQL.

#### BACKEND-QUAL-06 — Несогласованная обработка "не найдено" в store — часть методов возвращает (nil,nil), часть — ошибку
**Файл:** backend/internal/store/pg_store.go (GetTenantByID, GetUserByID, GetEventByID vs
GetUserByEmail, GetAttendeeByCode/ByID, GetAPIKeyByHash, GetFontByID)
`GetTenantByID`/`GetUserByID`/`GetEventByID` пробрасывают `pgx.ErrNoRows` как обычную ошибку, из-за чего
`GetEvent` отвечает 500 вместо 404. **Вердикт ЧАСТИЧНО:** центральный пример подтверждён, но
`GetAPIKeyByHash`/`GetFontByID` на деле возвращают `(nil, fmt.Errorf(...))`, а не `(nil, nil)`, как было
заявлено — категоризация этих двух методов неточна, общий вывод о несогласованности верен.
**Рекомендация:** стандартизировать все Get*ByID/ByEmail методы на одну конвенцию.

#### BACKEND-QUAL-08 — CheckTenantLimit не реализован для лимита "attendees_per_event" — заглушка с current=0
**Файл:** backend/internal/store/pg_store.go:1239-1258
`case "attendees_per_event": current = 0` делает лимит неэффективным при заданном значении, а
`maxLimit == 0` при отсутствии лимита блокирует создание участников для любого tenant без явного
лимита — обе стороны бага влияют на биллинг. **Рекомендация:** реализовать реальный `COUNT(*)`,
запрошенный по event_id, либо явно ошибаться на нереализованных типах лимита.

#### BACKEND-QUAL-09 — Несогласованный формат тела ошибки API — {"error"} vs {"message"}
**Файл:** backend/internal/handler/bulk_import.go, qr.go, printer_qr.go, qr_auth.go, users.go (46
вызовов echo.NewHTTPError) против ~30 остальных файлов (177 вызовов `{"error": ...}`)
main.go не регистрирует кастомный `HTTPErrorHandler`, поэтому `echo.NewHTTPError` рендерится как
`{"message": ...}` в 5 файлах, тогда как остальной API использует `{"error": ...}` — клиенты,
парсящие ключ `error`, получают `undefined` именно там, где сообщения важнее всего (импорт, QR-логин).
**Рекомендация:** выбрать один формат, зарегистрировать кастомный error handler.

#### BACKEND-QUAL-10 — api_keys.go использует context.Background() вместо контекста запроса
**Файл:** backend/internal/handler/api_keys.go:51,71,86,111,179,188
Все 6 вызовов БД в этом файле (включая публичный `ExternalImport`) используют `context.Background()`
вместо `c.Request().Context()`, в отличие от всех остальных хендлеров — запросы не отменяются при
разрыве соединения и не наследуют дедлайны. **Рекомендация:** заменить на `c.Request().Context()`.

#### DESKTOP-SEC-06, DESKTOP-BUG-06 — Окно киоска не защищено от выхода в ОС
**Файл:** desktop/src-tauri/tauri.conf.json:23-32; desktop/src/pages/CheckinEvent.tsx:311-321
**Обоснование объединения:** обе находки указывают на одни и те же строки конфигурации окна и один и
тот же дефект (нет fullscreen/decorations/kiosk-lock) — SEC-06 с точки зрения kiosk-escape, BUG-06 с
точки зрения жизненного цикла (плюс рассинхронизация `isFullscreen` при ремонтировании, отсутствие
`CloseRequested`/watchdog). Обе Medium.
Единственное окно приложения создаётся с `resizable: true` и без `fullscreen`/`decorations`/
`always_on_top`, несмотря на позиционирование продукта как "Idento Kiosk" для физически доступных
терминалов чек-ина. Оператор или посетитель может свернуть/закрыть приложение или переключиться в ОС
(Alt-Tab), получив доступ к файловой системе/сети — классический kiosk-escape, усугубляемый DESKTOP-SEC-02
(токен в localStorage). **Рекомендация:** включить `fullscreen: true`/`decorations: false` для прод-сборок,
обработать `WindowEvent::CloseRequested`, рассмотреть watchdog-процесс.

#### DESKTOP-SEC-02 — JWT и сессионные данные хранятся в localStorage без шифрования
**Файл:** desktop/src/lib/api.ts:4-19; pages/Login.tsx:32-38; pages/QRLogin.tsx:31-32
После логина токен/пользователь/тенанты хранятся в обычном localStorage, который Tauri не изолирует
сверх обычного WebView-хранилища — данные лежат в открытом виде на диске под `$APPDATA`, доступны любому
JS в origin или при доступе к файловой системе. На физически доступном киоске чек-ина это делает кражу
токена оператора осуществимой через доступ к файлу. **Рекомендация:** хранить токен через
`tauri-plugin-store`/OS keychain, не пропускать сырые токены через JS-контекст.

#### DESKTOP-SEC-03 — Разрешение shell:allow-open выдано без ограничивающего scope и не используется приложением
**Файл:** desktop/src-tauri/capabilities/default.json:5-10
`main-capability` выдаёт `shell:allow-open` без preconfigured scope (в отличие от `shell:default`); grep
по фронтенду не находит использования плагина shell — разрешение выдано, но не используется, нарушая
принцип наименьших привилегий. **Рекомендация:** удалить `shell:allow-open`, использовать
`shell:default` при необходимости.

#### DESKTOP-BUG-04 — Отсутствие таймаута у HTTP-клиента и повторных попыток — риск зависания киоска
**Файл:** desktop/src/lib/api.ts:12-16; pages/CheckinEvent.tsx:84-128,494-505
`axios.create` не задаёт `timeout`, поэтому запрос может зависнуть бесконечно на застрявшем соединении;
при ошибке загрузки страница чек-ина показывает только кнопку «Назад» без авто-ретрая. Временный сбой
сети при утреннем старте киоска может оставить экран застрявшим на "Loading…". **Рекомендация:**
разумный таймаут axios (10-15с) и экспоненциальный авто-ретрай.

#### DESKTOP-BUG-05 — Несогласованная валидация пустого/невалидного QR между режимами камеры и сканера
**Файл:** desktop/src/pages/CheckinEvent.tsx:188-233
Режим сканера проверяет `.trim()`, режим камеры — нетримленную строку; `lookupByCode` не отклоняет
пустую строку явно. Текущее поведение backend (авто-генерация кода) маскирует риск сегодня, но любое
расхождение может дать ложный чек-ин по повреждённому/пустому QR. **Рекомендация:** добавить тот же
guard `.trim()` в путь камеры, явно отклонять пустые строки в `lookupByCode`.

#### LANDING-BUG-06, LANDING-QUAL-07 — Footer ссылается на несуществующие страницы /privacy и /terms
**Файл:** landing/src/components/layout/Footer.tsx:36-47
**Обоснование объединения:** QUAL-07 своим текстом вердикта прямо указывает "дублирует
LANDING-BUG-06, детали совпадают". Обе Medium.
Footer (глобальный, на каждой странице) ссылается на `/privacy` и `/terms`, но таких маршрутов нет ни в
одной локали — клик по любой ссылке даёт 404, особенно вредно для страниц, продающих доверие ("Secure &
Private"). **Рекомендация:** добавить минимальные страницы privacy/terms или скрыть ссылки до готовности.

#### LANDING-BUG-03, LANDING-BUG-04, LANDING-QUAL-08 — Дефолтная локаль захардкожена трижды и разошлась с логикой next-intl
**Файл:** landing/proxy.ts:10-13; src/app/not-found.tsx:1-5; src/i18n/routing.ts:9
**Обоснование объединения:** QUAL-08 — более широкая находка, охватывающая тот же `proxy.ts`
(BUG-03) и тот же `not-found.tsx` (BUG-04) под одним заголовком "захардкожено трижды". Максимум Medium.
`routing.ts` объявляет `defaultLocale: 'en'` как единственный источник истины, но `proxy.ts` и
`not-found.tsx` независимо дублируют литерал `'en'`, а `proxy.ts` перехватывает `/` до вызова
next-intl'ового `handleI18nRouting` (который иначе учёл бы `Accept-Language`/cookie). Пользователь с
русским браузером всегда попадает на `/en` вместо автоопределённого `/ru`; несуществующий путь под
`/ru/...` тоже сбрасывает в `/en`. **Рекомендация:** убрать ручной редирект в `proxy.ts`, использовать
`routing.defaultLocale` в `not-found.tsx`.

#### LANDING-BUG-05, LANDING-QUAL-01 — Footer полностью не локализован — хардкод на английском в обеих локалях
**Файл:** landing/src/components/layout/Footer.tsx:6-33
**Обоснование объединения:** одна и та же строка/причина (неиспользуемый `useTranslations("Navigation")`
в `_t`, весь видимый текст — английские литералы, нет неймспейса `Footer` ни в одном каталоге). Обе
Medium.
На `/ru/...` footer (виден на каждой странице) остаётся полностью английским, пока остальной контент
корректно переведён — видимая несогласованность локализации по всему сайту. **Рекомендация:** добавить
неймспейс `Footer` в оба JSON-каталога, убрать/использовать мёртвый `_t`.

#### LANDING-BUG-09, LANDING-QUAL-06 — Якорные ссылки шапки (#features/#pricing/#faq) ломаются на /download и частично на /pricing
**Файл:** landing/src/components/layout/Header.tsx:16-21
**Обоснование объединения:** одна и та же причина — статичные relative-hash `<a>` вместо
locale-aware ссылок, применённые к страницам без соответствующих секций. Обе Medium.
`Header` подключён глобально, но `id="features"` есть только на главной, `id="pricing"`/`id="faq"` — на
главной и `/pricing`. На `/download` клик по любому пункту навигации не делает ничего, кроме изменения
хеша; на `/pricing` конкретно "Features" сломан. **Рекомендация:** заменить на locale-aware абсолютные
ссылки (`Link` из `@/i18n/routing`).

#### LANDING-BUG-08, LANDING-QUAL-03 — Страница /pricing содержит хардкод-текст на английском в обход next-intl
**Файл:** landing/src/app/[locale]/pricing/page.tsx:6-14
**Обоснование объединения:** один и тот же файл/строки, один и тот же дефект (хардкод-заголовок
рядом с переведённым содержимым ниже). Обе Medium.
`PricingPage` — серверный компонент без `getTranslations`; заголовок/подзаголовок — английские литералы,
тогда как вложенные `<Pricing />`/`<FAQ />` полностью переведены. На `/ru/pricing` пользователь видит
смешанный по языку экран. **Рекомендация:** использовать `getTranslations` в `PricingPage`, перенести
строки в `messages/*.json`.

#### LANDING-SEC-01 — В next.config.mjs не заданы security-заголовки (CSP, X-Frame-Options, HSTS и др.)
**Файл:** landing/next.config.mjs:5-8
`nextConfig` — пустой объект без `headers()`; сайт никогда не отправляет CSP/X-Frame-Options/HSTS/
X-Content-Type-Options/Referrer-Policy/Permissions-Policy. Допускает clickjacking (встраивание сайта в
iframe поверх CTA/кнопок покупки), убирает defense-in-depth слой против XSS. **Рекомендация:** добавить
`headers()` с `X-Frame-Options: DENY` (или CSP `frame-ancestors 'none'`), HSTS, разумным CSP.

#### LANDING-QUAL-10 — Playwright-тест не соответствует реальной разметке LanguageSwitcher
**Файл:** landing/tests/landing.spec.ts:91-93
Тест ищет `button[role='combobox']`/`[role='option']`, а `LanguageSwitcher` рендерит обычные `<a>`
без этих ролей — тест гарантированно падает/зависает на `.click()`, не давая реальной гарантии, что
переключение локали работает. **Рекомендация:** переписать тест под реальную разметку.

#### LANDING-QUAL-11 — Тесты landing не подключены ни к npm-скриптам, ни к CI
**Файл:** landing/package.json; .github/workflows/ci.yml
Нет `test`/`test:e2e` скрипта; в `ci.yml` нет ни одного упоминания `landing` — единственный тестовый
файл (и его поломка из QUAL-10) может оставаться незамеченным неограниченно долго.
**Рекомендация:** добавить `test`-скрипт и job в CI, триггерящийся на `landing/**`.

#### MOBILE-SEC-06 — Logout — только локальная очистка, серверная инвалидация токена не выполняется
**Файл:** mobile/shared/.../AuthRepository.kt:84-91; AuthApiService.kt:92-98
`AuthRepository.logout()` вызывает только `clearAuth()`; `AuthApiService.logout()` — пустая заглушка,
никогда не вызываемая. Если токен уже скомпрометирован (см. MOBILE-SEC-02) или устройство потеряно,
клиентский logout оставляет JWT валидным на сервере до естественного истечения.
**Рекомендация:** вызывать реальный эндпоинт отзыва токена/сессии на logout, сократить/ротировать TTL.

#### MOBILE-BUG-01 — Offline-хранилище чек-инов на Android — заглушка в памяти, данные теряются
**Файл:** mobile/shared/.../OfflineDatabase.android.kt:7-35 (и .ios.kt аналогично)
`OfflineDatabaseImpl` хранит отложенные чек-ины в обычном `mutableListOf()` без персистентности на
обеих платформах — данные исчезают при завершении процесса. **Вердикт ЧАСТИЧНО (понижение с Critical до
Medium):** код подтверждён дословно, но единственный писатель в это хранилище (`ZoneSelectViewModel`/
`ZoneQRScannerViewModel`) не зарегистрирован в Koin и не подключён ни к одному маршруту навигации (см.
MOBILE-BUG-03/QUAL-06) — сегодня ни один реальный пользователь не может создать запись, которую эта
заглушка потеряет. Это мина замедленного действия, а не активная потеря данных сейчас; риск вернётся
сразу, если офлайн-подсистему подключат к UI. **Рекомендация:** реализовать персистентность (Room/
SQLDelight) до подключения подсистемы к реальному потоку.

#### MOBILE-BUG-07 — NPE-риск от `!!` на selectedAttendee, гонка с автозакрытием по таймеру
**Файл:** mobile/shared/.../CheckinScreen.kt:124-133,346-357
10-секундный таймер автозакрытия обнуляет `selectedAttendee`, но обработчик клика "Print Badge" лениво
перечитывает `uiState.selectedAttendee!!` в момент клика, а не в момент гейтинга — если таймер сработает
между показом кнопки и обработкой клика, `!!` бросает NPE, крашя экран чек-ина. **Рекомендация:**
безопасный доступ (`?.let`) вместо `!!` в обработчике клика.

#### MOBILE-BUG-08 — Утечка ресурсов ML Kit — новый BarcodeScanner создаётся на каждый кадр камеры без закрытия
**Файл:** mobile/android-app/.../QRScannerScreen.kt:575-610
Каждый вызов анализатора кадров создаёт новый `BarcodeScanning.getClient()`, который никогда не
закрывается — вопреки рекомендации ML Kit переиспользовать детектор на протяжении сессии сканирования.
Долгие сессии камеры на киоске/самостоятельном чек-ине накапливают нативные ресурсы, вызывая деградацию
производительности или OOM. **Рекомендация:** создавать сканер один раз (`remember{}`), закрывать в
`DisposableEffect`.

#### MOBILE-QUAL-02 — mobile/android-app полностью дублирует mobile/shared независимой реализацией
**Файл:** mobile/android-app/settings.gradle.kts:17-19; app/build.gradle.kts (без
`implementation(project(":shared"))`)
Два полностью независимых стека для одного продукта: `mobile/shared` (Ktor+Koin+DataStore, ~10 273
строк) и `mobile/android-app` (Retrofit+Gson+Hilt+Room, ~20 803 строки) с почти одинаково названными
файлами, реализованными дважды с разной архитектурой; `:shared` реально потребляется только iOS.
Android и iOS — практически два разных продукта, вопреки заявлению README о "85% общего кода".
**Рекомендация:** выбрать одну целевую архитектуру — либо android-app реально использует `:shared`,
либо shared официально объявляется iOS-only/экспериментальным. См. также тему в Разделе 7.

#### MOBILE-QUAL-03 — Модели одних и тех же сущностей разошлись по полям между двумя реализациями
**Файл:** mobile/shared/.../Attendee.kt,Event.kt vs mobile/android-app/.../Attendee.kt,Event.kt
`Attendee.email` nullable в shared / non-null в android-app (риск скрытого NPE через Gson);
`customFields` типизирован по-разному; `Event`/`User` структурно разошлись. Любое изменение контракта
backend теперь нужно вручную и синхронно применять к двум разошедшимся деревьям — что уже не происходит.
**Рекомендация:** свести к одному источнику истины, в идеале сгенерированному из общего OpenAPI-контракта.

#### MOBILE-QUAL-11 — Каталог версий Gradle не подключён — версии дублируются вручную и уже разошлись
**Файл:** mobile/android-app/gradle/libs.versions.toml (53 записи, не используется)
`grep -rn "libs\." mobile --include="*.kts"` даёт ровно 1 совпадение (само объявление); версии уже
разошлись (например, каталог `compose-bom=2024.12.01` против фактических `2024.11.00` в
app/build.gradle.kts, и совсем другой alpha-артефакт навигации в shared/build.gradle.kts). Создаёт
ложное ощущение централизованного управления зависимостями. **Рекомендация:** подключить каталог через
`dependencyResolutionManagement` либо удалить его; выровнять версию навигации в shared-модуле.

#### WEB-SEC-05 — Проверка доступа к super-admin разделу выполняется только на клиенте по localStorage
**Файл:** web/src/App.tsx:31-45 (ProtectedRoute); components/Layout.tsx:76
И доступ к маршруту `/super-admin/*`, и видимость пункта меню зависят исключительно от
клиент-редактируемого флага `is_super_admin` в localStorage, без повторной проверки на backend перед
рендерингом чувствительного UI. **Рекомендация:** повторно проверять привилегию защищённым вызовом к
backend при входе в раздел.

#### WEB-BUG-04 — Сохранение шаблона бейджа перезаписывает событие устаревшим снимком
**Файл:** web/src/pages/BadgeTemplateEditorV2.tsx:208-247; event/EventSettings.tsx:90-116
`BadgeTemplateEditorV2` держит собственный независимо загруженный снимок `event` и делает PUT всего
объекта (включая устаревшую копию) при сохранении — параллельные правки других полей события другим
пользователем/вкладкой молча перезаписываются. Тот же паттерн полного PUT снимком — в `EventSettings`.
**Рекомендация:** PATCH только изменённого поля, либо перезапрашивать и сливать перед сохранением.

#### WEB-BUG-05 — Импорт CSV не учитывает кодировку файла — кириллица может стать "кракозябрами"
**Файл:** web/src/components/CSVImportEnhanced.tsx:68-90
`Papa.parse` не имеет параметра `encoding` (дефолт UTF-8); экспорты Excel в кириллической локали (часто
Windows-1251) молча декодируются в испорченный текст без ошибки/предупреждения, портя поля участников,
позже попадающие на печатные бейджи. **Рекомендация:** определять/запрашивать кодировку, предупреждать
о символах замены.

#### WEB-BUG-06 — Гонка состояний при быстрой смене CSV-файла
**Файл:** web/src/components/CSVImportEnhanced.tsx:60-90,165-177
`parseCSV` не передаёт токен отмены; выбор файла A, клик "Изменить", выбор файла B могут запустить два
конкурентных парсинга, и какой callback завершится последним — тот и победит независимо от текущего
выбранного файла. **Рекомендация:** request-id ref, игнорировать устаревшие результаты парсинга.

#### WEB-BUG-07 — Нет ограничения размера/строк CSV и парсинг не вынесен в worker
**Файл:** web/src/components/CSVImportEnhanced.tsx:60-118
Нет проверки размера/числа строк перед парсингом; парсинг на главном потоке; весь результат отправляется
одним POST без чанкинга/прогресса. Большие CSV мероприятий (десятки/сотни тысяч строк) могут заморозить
вкладку. **Рекомендация:** проверки размера/строк с предупреждением, `worker: true`, чанкинг с прогрессом.

#### WEB-BUG-08 — Форматтеры дат падают на невалидной дате, ErrorBoundary в приложении нет
**Файл:** web/src/utils/dateFormat.ts:6-83
Форматтеры проверяют только `!date`, не Invalid-Date результат — `Intl.DateTimeFormat.format()` бросает
исключение на испорченном таймстампе; без ErrorBoundary где-либо в приложении это крашит всё дерево
компонентов в белый экран. **Рекомендация:** проверять `isNaN(dateObj.getTime())`, добавить корневой
ErrorBoundary.

#### WEB-BUG-09 — Falsy-проверка данных для полей бейджа отбрасывает валидные нулевые значения
**Файл:** web/src/utils/zpl.ts:91,190,219
Все три генератора ZPL используют truthy-проверку `data[element.source]` — легитимный `0` (например,
номер стола) трактуется как отсутствующий и заменяется на пустой текст без ошибки. **Рекомендация:**
явная nullish/empty-string проверка вместо truthy.

#### WEB-QUAL-01 — Полное отсутствие тестового покрытия веб-приложения
**Файл:** web/package.json; web/src/ (74 файла)
Ноль тестовых файлов и зависимостей/скриптов для тестирования; критичные потоки (чек-ин/печать, ZPL,
редактор бейджей, импорт CSV, auth-interceptor) не покрыты автоматически. **Рекомендация:** vitest +
@testing-library/react, начиная с чистых функций и интеграционного теста CheckinFullscreen.

#### WEB-QUAL-04 — Восстановление сетевых принтеров из localStorage не срабатывает (устаревшее замыкание)
**Файл:** web/src/pages/EquipmentSettings.tsx:109-137
`loadSavedNetworkPrinters` проверяет `agentStatus === "connected"` из устаревшего замыкания до того, как
`checkAgentStatus` успевает разрешиться — условие всегда ложно, сохранённые сетевые принтеры никогда не
восстанавливаются после обновления/рестарта. **Рекомендация:** запускать восстановление из колбэка
разрешения `checkAgentStatus`.

#### WEB-QUAL-05 — Логика выбора принтера по умолчанию продублирована в трёх местах с разным приоритетом
**Файл:** web/src/pages/BadgeTemplateEditorV2.tsx:249-278; EquipmentSettings.tsx:149-171;
CheckinFullscreen.tsx:179-212
Три компонента независимо реализуют выбор принтера по умолчанию и уже разошлись (2 против 3 источников
приоритета) — поведение отличается по страницам, любое исправление нужно применять в трёх местах.
**Рекомендация:** вынести общую логику в `agent.ts` или хук `usePrinterSelection()`.

#### WEB-QUAL-06 — BadgeTemplateEditorV2.tsx — 1135 строк со смешанными ответственностями
**Файл:** web/src/pages/BadgeTemplateEditorV2.tsx:1-1135
Один компонент смешивает загрузку/сохранение через API, рендеринг Konva с почти дублирующимися блоками,
drag&drop, ZPL preview и запросы шрифтов/принтера; 3 самодельные модалки обходят общий компонент Dialog.
**Рекомендация:** разделить на выделенные хуки/компоненты, использовать общий Dialog.

#### WEB-QUAL-07 — EquipmentSettings.tsx — 1002 строки, объединяющие принтеры/сканеры/камеру/COM-порты
**Файл:** web/src/pages/EquipmentSettings.tsx:1-1003
Компонент объединяет управление принтерами/сканерами/камерой/COM-портами с разрозненным прямым доступом
к localStorage в трёх местах вместо единого стора — уже стало корневой причиной бага WEB-QUAL-04.
**Рекомендация:** извлечь `usePrinters()`, `useScannerPorts()`, `useScannerTest()`,
`networkPrintersStore.ts`.

#### WEB-QUAL-09 — Ключи localStorage и парсинг auth-данных продублированы без единого модуля
**Файл:** web/src/ (9 файлов: App.tsx, Layout.tsx, OrganizationSwitcher.tsx, api.ts, Login.tsx,
OrganizationSettings.tsx, QRLogin.tsx, Register.tsx, SuperAdminLayout.tsx)
Литералы `'token'`/`'user'`/`'tenants'`/`'current_tenant'` с собственным непроверяемым `JSON.parse` как
минимум в 9 файлах без единого модуля сессии — опечатка в любом месте молча ломает логику сессии именно
там. **Рекомендация:** типизированный модуль `session.ts` с геттерами/сеттерами/константами.

### 3.4 Low

Ниже — компактные блоки: заголовок, файл, суть/фикс одной строкой. Все имеют вердикт ПОДТВЕРЖДЕНО, за
исключением явно помеченных ЧАСТИЧНО/понижений.

**AGENT-BUG-07** — printer.Manager никогда не вызывает Close() у заменяемых/удаляемых принтеров
(agent/internal/printer/printer.go:59-63,89-95). Сегодня безвредно (подключены только Mock/System/
Network), но `SerialPrinter` (с реальным Close()) недостижим через реальные точки входа — латентно.
Фикс: интерфейс Closable, вызывать при перезаписи/удалении.

**AGENT-BUG-08** — пустое PDF-задание печати не отклоняется на /print-pdf (agent/main.go:542-598).
Пустой base64 декодируется без ошибки и отправляется на печать как пустое задание. Фикс: проверять
`len(pdfData)==0`, возвращать 400.

**AGENT-QUAL-04** — main.go — "god file" на 1069 строк с несколькими не связанными ответственностями
(agent/main.go:1-1069): конфиг, ~18 HTTP-хендлеров, legacy-шаблоны, CORS, встроенный `/docs`. Фикс:
разнести конфиг в internal/config, хендлеры в internal/api.

**AGENT-QUAL-06** — scanner.Manager.RemoveScanner всегда возвращает nil — фиктивная сигнатура ошибки
(agent/internal/scanner/scanner.go:260-269), в отличие от `RemovePrinter`, различающего найдено/нет.
Фикс: сделать симметричным с RemovePrinter.

**AGENT-QUAL-07** — дублирование скелета exec-команды между SendRaw и PrintPDF
(agent/internal/printer/system.go:189-253) — почти дословное дублирование санитизации/exec-паттерна.
Фикс: извлечь общий хелпер `runLP`.

**AGENT-QUAL-08** — паттерн "загрузить конфиг → изменить срез → сохранить" дублируется в 4 хендлерах с
разной блокировкой (agent/main.go:385-972). Фикс: общий хелпер lock/load/mutate/save.

**AGENT-QUAL-09** — магические числа (baud rate 9600, порт 9100, таймауты сканера) без именованных
констант, дублируются в 4+ местах (agent/internal/printer/serial.go:21; scanner.go; main.go:216,375-377,
869). Фикс: именованные пакетные константы.

**BACKEND-SEC-13** — пароль передаётся как аргумент командной строки в утилите reset_password
(backend/cmd/reset_password/main.go:19-24) — виден в истории shell и `ps` во время выполнения; требует
локального доступа к машине. Фикс: интерактивный ввод без эха или env/stdin.

**BACKEND-BUG-09** — Register создаёт tenant/user/членство в трёх нетранзакционных шагах
(backend/internal/handler/auth.go:39-115) — частичный сбой оставляет осиротевший tenant без
пользователя. Фикс: обернуть все три шага в один `pgx.Tx`, по образцу `BulkUpdateZoneAccessRules`.

**BACKEND-BUG-10** — CheckZoneAccess разыменовывает attendee без проверки на nil
(backend/internal/store/pg_store_zones.go:578-590) — `GetAttendeeByID` может вернуть `(nil, nil)`.
Сегодня единственный вызывающий передаёт уже провалидированный ID, но риск паники для будущих
вызывающих. Фикс: явная nil-проверка.

**BACKEND-BUG-11** — GenerateAttendeeCodes тихо пропускает участников при коллизии сгенерированного
кода (backend/internal/handler/attendee_codes.go:35-46) — ответ 200 не отражает, что часть участников
не получила код. Фикс: ретрай генерации при конфликте, отражать неудавшиеся ID в ответе.

**BACKEND-QUAL-11** — pg_store.go — 1320 строк, смешаны ~10 не связанных доменов в одном файле
(backend/internal/store/pg_store.go), при уже существующем прецеденте разделения (zones/sync/
super_admin). Фикс: разбить на pg_store_billing.go, pg_store_fonts.go и т.д.

**BACKEND-QUAL-12** — zones.go (handler) — 676 строк, смешаны 6 разных зон ответственности
(backend/internal/handler/zones.go): CRUD зон, правил доступа, overrides, staff-назначение,
ZoneCheckIn, генерация QR. Фикс: разбить на zones_crud.go, zone_access.go, zone_checkin.go, zone_qr.go.

**BACKEND-QUAL-13** — непроверяемое приведение типа `c.Get("user").(*models.JWTCustomClaims)` повторено
32 раза в 11 файлах (backend/internal/handler/*.go) без проверки `ok` — риск паники (500) вместо
контролируемого 401 при отсутствии middleware на маршруте. Фикс: общий хелпер `getClaims(c)`.

**BACKEND-QUAL-14** — main.go встраивает устаревшую неполную копию OpenAPI-спецификации вместо реального
файла (backend/main.go:16-386; backend/openapi.yaml, 714 строк) — эндпоинт `/openapi.yaml` не включает
zones/api-keys/fonts/super-admin маршруты. Фикс: отдавать реальный файл или генерировать константу из
него при сборке.

**BACKEND-QUAL-15** — мёртвые пустые директории backend/handlers и backend/models — остаток от миграции
в internal/handler, internal/models. Фикс: удалить.

**DESKTOP-SEC-04** — withGlobalTauri:true без необходимости расширяет глобальную поверхность IPC в
WebView (desktop/src-tauri/tauri.conf.json:13) — код использует только ES-импорты, глобальный объект не
нужен. Фикс: установить `false` (дефолт).

**DESKTOP-QUAL-01** — полное отсутствие автотестов для критичных сценариев (desktop/package.json; src/,
src-tauri/src) — нет vitest/jest/testing-library, нет тестов Rust. Фикс: vitest + testing-library для
чистых функций, smoke-тест для `agent_request`.

**DESKTOP-QUAL-03** — CheckinEvent.tsx — 582 строки со смешением ответственностей
(desktop/src/pages/CheckinEvent.tsx:1-583): камера/сканер/чек-ин/печать/fullscreen/UI. Фикс: извлечь
хуки `useQrCameraScanner`, `useScannerPolling`, `useCheckinFlow`.

**DESKTOP-QUAL-04** — Equipment.tsx — 576 строк со смешением ответственностей
(desktop/src/pages/Equipment.tsx:1-577): принтеры/сканеры/настройки/тест сканера/UI. Фикс: разбить на
подкомпоненты-карточки плюс хук `useEquipmentData()`.

**DESKTOP-QUAL-05** — дублирование бизнес-логики между desktop и web без переиспользования
(desktop/src/lib/api.ts, markdownTemplate.ts vs web/). **Вердикт ЧАСТИЧНО:** дублирование и расхождение
экранирования regex в markdownTemplate.ts подтверждены, но заявление о "разном наборе ключей
localStorage" в api.ts неверно — оба файла используют идентичный набор, различается только список
исключаемых при 401-редиректе путей. Фикс: пометить как известный дубликат, синхронизировать любой фикс.

**DESKTOP-QUAL-06** — порт агента (12345) захардкожен независимо в трёх местах
(desktop/src-tauri/src/commands.rs:5-6; src/lib/agent.ts:6; i18n.ts:47,171). Фикс: брать порт из
существующей команды `get_agent_port()`, интерполировать в i18n-строках.

**DESKTOP-QUAL-07** — несогласованная обработка ошибок по всему приложению (silent catch, toast, голый
console.error, дублированный парсинг axios-ошибки с разными полями). **Вердикт ЧАСТИЧНО:** большинство
цитат точны, но пример "console.error без уведомления" на CheckinEvent.tsx:357 некорректен — следующая
строка того же catch-блока вызывает `toast.error`. Фикс: общий хелпер `extractApiErrorMessage(err)`.

**DESKTOP-QUAL-08** — отсутствует конфигурация ESLint — скрипт lint в desktop нерабочий
(desktop/package.json:7) — ESLint 9 объявлен, но нет flat-config/`.eslintrc*`. Фикс: адаптировать
web/eslint.config.js для desktop.

**DESKTOP-QUAL-09** — мёртвый код: присвоение api.defaults.baseURL не имеет эффекта
(desktop/src/pages/Connection.tsx:45-50; lib/api.ts:17-24) — request-interceptor безусловно
перезаписывает baseURL на каждый запрос. Фикс: удалить избыточную строку.

**LANDING-SEC-02** — внешняя ссылка с target="_blank" без rel="noopener noreferrer" (reverse tabnabbing)
в навигации Header (landing/src/components/layout/Header.tsx:44-99) — Footer для сравнения делает это
правильно. Фикс: добавить `rel="noopener noreferrer"`.

**LANDING-BUG-10** — метаданные (title/description/og:url) не переопределяются для /pricing и /download
(landing/src/app/[locale]/layout.tsx:11-66) — обе страницы получают SEO-заголовок и og:url главной.
Фикс: page-specific `generateMetadata`/`metadata` экспорты.

**LANDING-QUAL-02** — ThemeToggle — подписи меню темы захардкожены на английском
(landing/src/components/ThemeToggle.tsx:24-35), нет `useTranslations`. Фикс: неймспейс `Theme.*`.

**LANDING-QUAL-04** — SEO-метаданные дублируют контент отдельно от общего i18n-каталога
(landing/src/app/[locale]/layout.tsx:18-26) — второй, несвязанный источник переводов, рискующий
разойтись. Фикс: перенести в `Metadata`-неймспейс `messages/*.json`.

**LANDING-QUAL-09** — мёртвый компонент — весь select.tsx (161 строка) нигде не используется
(landing/src/components/ui/select.tsx) — `LanguageSwitcher` использует обычные `<a>`. Фикс: удалить.

**LANDING-QUAL-12** — заголовок секции (motion-обёртка + h2 + p) скопирован почти дословно в 7 файлах
секций (landing/src/components/sections/*.tsx); Features.tsx уже разошёлся (пропущен класс `mb-12`).
Фикс: общий компонент `<SectionHeader>`.

**LANDING-QUAL-13** — магические числовые диапазоны жёстко привязывают код к длине массивов в
i18n-каталоге (landing/src/components/sections/UseCases.tsx:56, Pricing.tsx:94) — добавление 4-го пункта
в JSON молча не отрендерится. Фикс: выводить количество из структуры данных, добавить guard как в
Pricing.tsx.

**LANDING-QUAL-14** — ключи сравнительной таблицы Comparison продублированы в трёх местах
(landing/src/components/sections/Comparison.tsx:7-83) без типовой связи — переименование ключа не даёт
ошибки компиляции, просто молча ломает сравнение. Фикс: единая структура данных
`{key, idento, traditional, competitors}`.

**LANDING-QUAL-15** — мёртвые CSS-переменные для градиентов (landing/src/styles/globals.css:52-53) —
нигде не используются. Фикс: удалить или применить в Hero/FinalCTA.

**LANDING-QUAL-16** — неиспользуемый неймспейс "HomePage" в обоих i18n-каталогах
(landing/messages/en.json,ru.json:2-19) — реально используемые Hero/Features содержат другой,
разошедшийся текст. Фикс: удалить неймспейс или пометить TODO.

**MOBILE-SEC-04** — правила бэкапа Android не приведены в соответствие с реальным расположением данных
(mobile/android-app/.../AndroidManifest.xml:32-34; backup_rules.xml) — сегодня ничего не течёт случайно
(DataStore не покрыт правилами, реальной БД нет), но при добавлении SharedPreferences/БД токены могут
утечь в облачный бэкап. Фикс: явно исключить чувствительные домены или отключить allowBackup.

**MOBILE-SEC-05** — избыточное разрешение RECEIVE_BOOT_COMPLETED без соответствующего получателя
(mobile/android-app/.../AndroidManifest.xml:28) — нет обработчика BOOT_COMPLETED. Фикс: удалить
разрешение или реализовать receiver.

**MOBILE-BUG-02** — NetworkMonitor на Android всегда возвращает "онлайн" (mobile/shared/.../
NetworkMonitor.android.kt:10-22). **Вердикт ЧАСТИЧНО (понижение с High до Low):** заглушка подтверждена
дословно, но единственный потребитель (`SyncService.startAutoSync()`) нигде не вызывается (см.
MOBILE-BUG-03) — сегодня заглушка ни на что не влияет на достижимых экранах.

**MOBILE-BUG-05** — race condition в SyncService.performSync() — возможна двойная отправка чек-ина
(mobile/shared/.../SyncService.kt:55-88). **Вердикт ЧАСТИЧНО (понижение с Medium до Low):** неатомарный
check-then-act подтверждён, но единственная точка вызова `performSync()` — внутри `startAutoSync()`,
который сам никогда не запускается (см. MOBILE-BUG-03) — описанного конкурентного сценария в
достижимом коде не существует.

**MOBILE-BUG-06** — постоянные (не сетевые) ошибки чек-ина бесконечно повторяются в офлайн-очереди без
учёта попыток (mobile/shared/.../OfflineCheckInRepository.kt:78-98). **Вердикт ЧАСТИЧНО (понижение с
Medium до Low):** `attemptCount`/`lastAttemptAt`/`errorMessage` подтверждены как нигде не
читаемые/записываемые, но это часть той же отключённой от UI подсистемы (см. MOBILE-BUG-03).

**MOBILE-BUG-09** — TokenManager.getToken() использует collect на незавершающемся Flow — гарантированно
зависнет при вызове (mobile/android-app/.../TokenManager.kt:50-56) — 0 вызовов `getToken()` во всём
проекте сегодня, латентная мина. Фикс: заменить на `dataStore.data.map{...}.first()`.

**MOBILE-QUAL-01** — полное отсутствие тестов при задекларированной тестовой инфраструктуре (тестовые
зависимости объявлены в build.gradle.kts обоих модулей, но 0 тестовых файлов). Фикс: начать с юнит-тестов
чистой логики, затем instrumentation/Compose UI тесты для чек-ина.

**MOBILE-QUAL-07** — несогласованная модель обработки ошибок между shared (`ApiResult` sealed class с
`Loading`) и android-app (`kotlin.Result<T>` со строковыми исключениями) — два несовместимых контракта
для одного понятия. Фикс: унифицировать при консолидации дублирующихся реализаций (MOBILE-QUAL-02).

**MOBILE-QUAL-08** — магические числа в генераторе ZPL для бейджей (mobile/android-app/.../
BadgeTemplate.kt:34-90+, 516 строк) — буквальные ZPL-координаты без именованных констант; shared
использует принципиально другой механизм (подстановка в готовый серверный шаблон). Фикс: именованные
константы/layout-конфиг.

**MOBILE-QUAL-09** — файлы Compose-экранов свыше 400 строк смешивают несколько ответственностей
(CheckinScreen.kt — 867 строк, QRScannerScreen.kt — 742, SettingsScreen.kt — 690/640). Фикс: разнести
composable-функции по отдельным файлам/подпакетам.

**MOBILE-QUAL-10** — готовая система локализации в shared обходится хардкодом строк в бизнес-коде
(mobile/shared/.../SettingsViewModel.kt) — 93-ключевой `StringKey` enum существует, но большинство
success/error-сообщений — английские литералы, местами с ad-hoc `if (language == "ru")`. Фикс: добавить
недостающие StringKey-записи, убрать ad-hoc-ветвление.

**MOBILE-QUAL-12** — избыточное использование `!!` там, где уже есть безопасные альтернативы
(mobile/android-app/.../EventRepository.kt, AuthRepository.kt, EthernetPrinterService.kt) — технически
безопасно сегодня (следует сразу за null-проверкой), но хрупко и является частым источником будущих
регрессионных NPE при полном отсутствии тестов (MOBILE-QUAL-01). Фикс: безопасные идиомы (`?.let`).

**WEB-SEC-06** — слабая политика длины пароля на клиенте (только 6 символов, без требований к сложности)
(web/src/pages/Register.tsx:19; Users.tsx:40). Фикс: поднять минимальную длину (8-10), проверить, что
backend не слабее.

**WEB-BUG-10** — таймер тестирования сканера в настройках оборудования не останавливается при
размонтировании компонента (web/src/pages/EquipmentSettings.tsx:92,358-422) — до 30с фонового поллинга
`getLastScan()` после перехода на другой экран. Фикс: cleanup в `useEffect` при размонтировании.

**WEB-BUG-11** — поток чек-ина не имеет обработки офлайн-режима и повторной синхронизации
(web/src/pages/CheckinFullscreen.tsx:267-325; hooks/useScanner.ts) — нет слушателей online/offline,
неудачный чек-ин просто отбрасывается после таймаута тоста; неиспользуемый ключ `offlineMode` в i18n
намекает на заброшенную фичу. Фикс: локальная очередь неудавшихся чек-инов с авто-ресинком на `online`.

**WEB-QUAL-08** — дублирование ~110 строк JSX между диалогами создания и редактирования зоны
(web/src/pages/event/EventZones.tsx:356-581) — различаются только префиксом id и текстом заголовка/кнопки.
Фикс: общий компонент `<ZoneFormFields>`.

**WEB-QUAL-10** — несогласованная обработка подтверждения удаления — нативный confirm() vs кастомный
Dialog для одного и того же типа действия (web/src/components/FontManager.tsx,APIKeysManager.tsx,
pages/event/EventAttendees.tsx,EventStaff.tsx vs EventZones.tsx,EquipmentSettings.tsx). Фикс: общий
`useConfirmDialog()`/`<ConfirmDialog />`.

**WEB-QUAL-11** — отладочные console.log оставлены в продовых путях кода (web/src/components/
PrintBadgeDialog.tsx, pages/EventLayout.tsx, BadgeTemplateEditorV2.tsx, lib/fonts.ts) — срабатывают на
каждое обычное действие пользователя, не только при ошибке. Фикс: удалить или гейтить `import.meta.env.DEV`.

**WEB-QUAL-12** — несогласованное форматирование дат — часть экранов игнорирует локаль приложения
(web/src/components/AttendeeMovementTimeline.tsx и 5 других файлов, преимущественно super-admin) —
используют `toLocaleDateString` напрямую вместо `dateFormat.ts`. Фикс: заменить на `formatDate`/
`formatDateTime` везде.

**WEB-QUAL-13** — неработающая кнопка «Delete Event» в Danger Zone (web/src/pages/event/EventSettings.tsx:
408-421) — постоянно `disabled`, без onClick; похоже на намеренный плейсхолдер, оставленный без TODO.
Фикс: реализовать удаление или скрыть за feature-флагом.

## 4. Уязвимости из сканеров

Источники: `docs/audit/raw/govulncheck-backend.txt`, `govulncheck-agent.txt` (Go, символьный анализ
достижимости), `npm-audit-{web,landing,desktop}.json` (`metadata.vulnerabilities` + advisory-названия),
`cargo-audit-desktop.txt` (недоступен — `cargo-audit` не установлен, см. Раздел 4.4) и
`docs/audit/raw/versions-current.md` (кросс-проверка через OSV.dev, использована как источник CVE/GHSA
для пакетов и Rust-крейта `tauri`, для которого cargo-audit был единственно недоступной проверкой).

### 4.1 Go — govulncheck (backend + agent)

Оба govulncheck-скана (проверка от 2026-07-09) сообщают о достижимых вызовах ровно для трёх ID
уязвимостей — 3 в backend, 2 в agent (пересечение — 2 общих stdlib-проблемы). Govulncheck также нашёл
4 непроверяемых вызовом уязвимости в backend и 1 в agent «в модулях, которые вы требуете, но код,
похоже, не вызывает» — они не достижимы статически, но включены ниже как накопленный риск, т.к.
`versions-current.md` явно проверила их через OSV.dev.

| Пакет/модуль | ID (GO-ID / GHSA / CVE) | Серьёзность | Достижимость (govulncheck) | Подсистема | Фикс-версия |
|---|---|---|---|---|---|
| `crypto/tls` (stdlib) | GO-2026-5856 (Encrypted Client Hello privacy leak) | High (по влиянию — утечка приватности TLS) | Достижимо: backend (`main.main`→`echo.Echo.Start`→TLS handshake; `handler.UploadEventFont`/`ExportAttendeesCSV`), agent (`main.main`→`http.Server.ListenAndServe`; `scanner.Scanner.Close`) | Backend, Agent | go1.26.5 (обновление тулчейна) |
| `os` (stdlib) | GO-2026-4970 (root escape via symlink + trailing slash) | High | Достижимо: backend (`store.PGStore.RunMigrations`→`os.Root.ReadFile`), agent (`loadConfig`/`saveConfig`→`os.Root.ReadFile`/`WriteFile`) | Backend, Agent | go1.26.5 (обновление тулчейна) |
| `github.com/jackc/pgx/v5` | GO-2026-5004 / GHSA-j88v-2chj-qfwx (SQL injection через путаницу плейсхолдеров с dollar-quoted строками) | High/Critical | Достижимо: backend (`store.PGStore.GetAuditLog`→`pgxpool.Pool.Query`→`sanitize.SanitizeSQL`) | Backend | v5.9.2 (минимум) / v5.10.0 (рекомендовано) |
| `github.com/jackc/pgx/v5` | GHSA-9jj7-4m8r-rfcm / CVE-2026-33816 / GO-2026-4772 (memory-safety) | Critical | Не достижимо по трассе govulncheck ("imported but not called") — присутствует в дереве зависимостей | Backend | v5.9.0 (fix), рекомендовано v5.10.0 (единое обновление закрывает обе) |
| `golang.org/x/crypto` (подпакет `ssh`+`agent/knownhosts`) | 13 GHSA/CVE, неск. CRITICAL (GHSA-5cgq-3rg8-m6cv, GHSA-89gr-r52h-f8rx, GHSA-f5wc-c3c7-36mc, GHSA-jppx-rxg9-jmrx, GHSA-rm3j-f69w-wqmq, GHSA-vgwf-h737-ff37, GHSA-x527-x647-q7gg и др.) | Critical (в подпакете `ssh`) | Не достижимо — backend импортирует только `x/crypto/bcrypt`, подпакет `ssh` не используется | Backend | v0.52.0 (fix ssh), рекомендовано v0.54.0 |

### 4.2 npm audit — web, landing, desktop

`npm audit` (2026-07-09): web — 16 уязвимостей (0 critical/9 high/5 moderate/2 low), desktop — 16 (та же
структура), landing — 11 (0/4 high/5 moderate/2 low). Все перечисленные ниже пакеты либо прямые, либо
транзитивные зависимости инструментов сборки/lint (esbuild/vite/rollup, eslint-тулчейн, axios, next).

| Пакет | Advisory (сокращённо) | Серьёзность | Подсистема | Фикс-версия |
|---|---|---|---|---|
| `vite` | Path Traversal в `.map`, `server.fs.deny` bypass (query), Arbitrary File Read через WS dev-сервера | High | Web, Desktop | ≥7.3.6 (patch в рамках 7.x) |
| `axios` | NO_PROXY Hostname Normalization Bypass → SSRF, Auth Bypass через prototype pollution в `validateStatus` | High | Web, Desktop | 1.18.1 |
| `react-router` / `react-router-dom` | Unauth RCE-подобный гаджет через turbo-stream deserialization, XSS через `javascript:` redirect, DoS (unbounded path expansion, single-fetch) | High | Web, Desktop | 7.18.1 |
| `next` | HTTP request smuggling в rewrites, unbounded image-cache growth (DoS), postponed resume buffering DoS | High | Landing | ≥16.2.6 (мин.) / 16.2.10 (рек.) |
| `flatted` | Unbounded recursion DoS в `parse()`, Prototype Pollution через `parse()` | High | Web, Landing, Desktop | 3.4.2 |
| `minimatch` | 3× ReDoS через wildcard/GLOBSTAR/extglob паттерны | High | Web, Landing, Desktop | 3.1.4 (в рамках 3.x) / 9.0.7 (в рамках 9.x) |
| `picomatch` | Method Injection в POSIX character classes, ReDoS через extglob-квантификаторы | High | Web, Landing, Desktop | 2.3.2 (в рамках 2.x) / 4.0.4 (в рамках 4.x) |
| `form-data` | CRLF injection через неэкранированные имена полей/файлов в multipart | High | Web, Desktop | 4.0.6 |
| `rollup` | Arbitrary File Write через Path Traversal | High | Web, Desktop | 4.62.2 |
| `next-intl` | Open redirect, prototype pollution через `experimental.messages.precompile` | Moderate | Landing | ≥4.9.2 |
| `ajv` | ReDoS при использовании опции `$data` | Moderate | Web, Landing, Desktop | 6.14.0 (в рамках 6.x) |
| `brace-expansion` | Zero-step sequence → зависание процесса/исчерпание памяти | Moderate | Web, Landing, Desktop | 1.1.13 / 2.0.3 |
| `follow-redirects` | Утечка custom auth-заголовков при кросс-доменном редиректе | Moderate | Web, Desktop | 1.16.0 |
| `js-yaml` | Квадратичная сложность/DoS в merge-key handling с повторными алиасами | Moderate | Web, Landing, Desktop | 4.2.0 (в рамках 4.x) |
| `postcss` | XSS через неэкранированный `</style>` в CSS stringify | Moderate | Web, Landing, Desktop | 8.5.16 |
| `@babel/core` | Arbitrary File Read через `sourceMappingURL` комментарий | Low | Web, Landing, Desktop | 7.29.6 |
| `esbuild` | Arbitrary file read dev-сервером на Windows | Low | Web, Desktop | 0.28.1 |
| `icu-minify` | DoS через несанитизированный lookup ключа `select` на `Object.prototype` при `precompile: true` | Low | Landing | 4.9.2 |

### 4.3 Rust / Tauri (desktop) — вручную через OSV.dev + security advisories (cargo-audit недоступен)

| Пакет | ID | Серьёзность | Подсистема | Фикс-версия |
|---|---|---|---|---|
| `tauri` (Cargo.toml, жёстко `=2.9.1`) | CVE-2026-42184 / GHSA-7gmj-67g7-phm9 (Origin Confusion в `is_local_url()` на Windows/Android — удалённая страница может быть ошибочно классифицирована как локальный origin и вызывать IPC-команды с `"local": true`) | Moderate (по факту — обход изоляции IPC) | Desktop | ≥2.11.1 (мин.) / 2.11.5 (рек.) |

### 4.4 Cargo audit — недоступен

`cargo-audit` не был установлен в среде выполнения Задачи 3 (см. `docs/audit/raw/cargo-audit-desktop.txt`,
однострочная заглушка). Единственная проверка безопасности Rust-стороны Tauri в этом аудите — ручная
сверка `github.com/tauri-apps/tauri/security/advisories` через OSV.dev (Задача 5, `versions-current.md`),
давшая находку из Раздела 4.3. **Рекомендация:** установить `cargo-audit` в CI/локальное окружение для
регулярных проверок `desktop/src-tauri/Cargo.lock` в дальнейшем — на сегодняшний день сверка была
разовой и охватывает только прямую зависимость `tauri`, не весь граф Cargo.lock.

Каждый пакет, помеченный сканером выше (Разделы 4.1-4.3), присутствует в плане обновления Раздела 5.

## 5. План обновления зависимостей (для Фазы 2)

Организовано по подсистемам, партиями (партия = группа связанных пакетов, обновляемых вместе). Основа —
раздел «Выводы для политики обновлений» в `docs/audit/raw/versions-current.md`. Ни один пакет не требует
мажорного обновления по причине прекращения поддержки — единственный отмеченный риск сопровождения
(без CVE) — `github.com/skip2/go-qrcode` (см. Партию 4). Везде, где обязательность обусловлена
уязвимостью, это отмечено явно.

### 5.1 Backend (Go)

**Партия 1 — pgx (обязательно, безопасность).**
`github.com/jackc/pgx/v5`: v5.7.6 → v5.10.0. Тип: minor. Обоснование: закрывает достижимую SQL-инъекцию
GO-2026-5004 (v5.9.2) и попутно недостижимую, но CRITICAL memory-safety CVE-2026-33816/GO-2026-4772
(v5.9.0) — рекомендована максимальная версия v5.10.0 вместо минимальной, т.к. уже одна достижимая
уязвимость обосновывает апдейт.

**Партия 2 — Go toolchain (обязательно, безопасность, общая с Agent — см. 5.2 Партию 5).**
go1.26.4 → go1.26.5. Тип: patch. Обоснование: закрывает GO-2026-5856 (`crypto/tls`, достижимо) и
GO-2026-4970 (`os`, достижимо) одновременно в backend и agent.

**Партия 3 — рутинные minor/patch без известных CVE.**
`github.com/labstack/echo/v4` v4.13.4 → v4.15.4 (minor); `github.com/golang-jwt/jwt/v5` v5.3.0 → v5.3.1
(patch); `golang.org/x/crypto` v0.45.0 → v0.54.0 (minor в рамках v0.x — критические CVE в подпакете
`ssh` не достижимы, т.к. используется только `bcrypt`, обновление по общей гигиене). Уже актуальны:
`github.com/swaggo/swag` (v1.16.6).

**Партия 4 — риск сопровождения, без обновления версии.**
`github.com/skip2/go-qrcode`: новых тегов с 2020-06-17 нет, хотя апстрим не архивирован и содержит более
поздние коммиты (push 2024-03-01). Не CVE, а риск сопровождения — оценить замену библиотеки отдельным
тикетом (см. Раздел 7).

### 5.2 Agent (Go)

**Партия 5 — Go toolchain — та же партия, что Backend Партия 2** (общий тулчейн go1.26.4 → go1.26.5,
обязательно, см. 5.1).

**Партия 6 — рутинный minor.**
`go.bug.st/serial` v1.6.4 → v1.7.1 (minor, нет известных уязвимостей). Уже актуален:
`github.com/rs/cors` (v1.11.1).

### 5.3 JS — web / landing / desktop

**Партия 7 — прямые зависимости, обязательно (безопасность).**
`vite` → ≥7.3.6 (patch, web+desktop; уязвимости из Раздела 4.2); `axios` → 1.18.1 (minor, web+desktop);
`react-router-dom`/`react-router` → 7.18.1 (minor, web+desktop); `next` → ≥16.2.10 (minor, landing);
`next-intl` → ≥4.9.2 (minor, landing).

**Партия 8 — транзитивные зависимости инструментов сборки/lint, обязательно (безопасность, закрывается
`npm audit fix`/обновлением родительского прямого пакета).**
`@babel/core` → 7.29.6 (patch); `ajv` → 6.14.0 (patch в рамках 6.x); `brace-expansion` → 1.1.13/2.0.3
(patch); `esbuild` → 0.28.1 (minor, тянется обновлением vite); `flatted` → 3.4.2 (minor); `follow-redirects`
→ 1.16.0 (minor); `form-data` → 4.0.6 (patch); `js-yaml` → 4.2.0 (patch в рамках 4.x); `minimatch` →
3.1.4/9.0.7 (patch, тянется обновлением eslint-тулчейна); `picomatch` → 2.3.2/4.0.4 (patch); `postcss` →
8.5.16 (patch); `rollup` → 4.62.2 (minor, тянется обновлением vite); `icu-minify` → 4.9.2 (minor,
landing only).

**Партия 9 — рутинные minor/patch без известных CVE.**
`react`/`react-dom` (patch в landing 19.2.4→19.2.7; опциональный major в web/desktop 18.3.1→19.x, без
CVE — не обязателен); `@radix-ui/*` (10 пакетов, диапазон minor/patch по каждому); `tailwindcss` (minor,
4.1.x→4.3.2); `framer-motion` (minor, landing, 12.34.0→12.42.2); `@tauri-apps/api` (minor, desktop,
2.9.1→2.11.1); `i18next`/`react-i18next` (minor в рамках текущего мажора; опциональный major без CVE).

### 5.4 Rust (desktop/src-tauri)

**Партия 10 — tauri, обязательно (безопасность).**
`tauri` =2.9.1 → 2.11.5 (жёстко закреплённая версия в Cargo.toml). Тип: minor. Обоснование: CVE-2026-42184
(Origin Confusion, обход проверки локального origin для IPC на Windows/Android) — минимум 2.11.1,
рекомендовано 2.11.5. Единственная проверка безопасности Rust-стороны в этом аудите (cargo-audit
недоступен, см. Раздел 4.4), поэтому обновление приоритетно.

**Партия 11 — рутинный minor.**
`tauri-build` 2.5 (резолвится 2.5.5) → 2.6.3 (minor, нет известных уязвимостей).

### 5.5 Mobile (Kotlin/AGP/Compose/сетевой стек)

**Партия 12 — Kotlin/AGP/Compose toolchain (координировать вместе — одна экосистема версий).**
`kotlin` 2.1.0 → 2.4.0 (minor); AGP 8.7.2 → 8.13.2 в рамках 8.x (minor; опциональный major 9.2.1, без
CVE, не обязателен); Compose Multiplatform gradle-плагин 1.7.3 → 1.11.1 (minor).

**Партия 13 — Compose BOM, отдельный тикет.**
`androidx.compose:compose-bom` 2024.11.00 → 2026.06.01 — существенное отставание (~19 релизов,
calendar-versioning). Рекомендовано отдельным тикетом из-за широкого влияния на весь UI-код (не
поместится в рутинную партию); нет отдельного CVE-фида для BOM-агрегатора, но проверка ключевых
под-артефактов (compose.ui, material3) уязвимостей не выявила.

**Партия 14 — сетевой/сериализационный стек.**
`ktor` (io.ktor:ktor-client-*) 3.0.2 → 3.5.1 (minor); `kotlinx-serialization-json` 1.7.3 → 1.11.0
(minor); `kotlinx-coroutines` 1.9.0 → 1.11.0 (minor). Ни одна уязвимость не найдена.

**Партия 15 — HTTP-клиент, опциональные мажоры.**
`retrofit` (android-app) 2.11.0 → 2.12.0 в рамках 2.x (patch; опциональный major 3.0.0, без CVE, не
обязателен — исторические GHSA-8p8g-f9vg-r7xr/GHSA-j379-9jr9-w5cq закрыты ещё в 2.5.0); `okhttp` уже
последняя в рамках 4.x (4.12.0; опциональный major 5.4.0, без CVE, не обязателен).

**Партия 16 — housekeeping (не версия, структурный фикс).**
Дохлый каталог версий `libs.versions.toml` (см. MOBILE-QUAL-11, Раздел 3.3) — подключить через
`dependencyResolutionManagement` либо удалить; выровнять alpha-артефакт навигации
(`org.jetbrains.androidx.navigation:navigation-compose:2.8.0-alpha10` в `mobile/shared`, другой groupId
и существенно более старая версия, чем `androidx.navigation:navigation-compose:2.8.4` в android-app) —
требует отдельного решения, т.к. это не просто дрейф версии, а другой артефакт в KMP-таргете,
используемом и для iOS.

## 6. Предложение волн исправлений

Границы волн: **Фаза 2** = находки с хотя бы одним SEC-ID (Critical/High/Medium) + партии обновления
зависимостей (Раздел 5); **Фаза 3** = находки-BUG без SEC-ID (Critical/High/Medium); **Фаза 4** =
чистые QUAL-находки, не объединённые ни с одной SEC/BUG (Critical/High/Medium). Все 55 Low-находок и
4 находки MOBILE-BUG-01/02/05/06 (понижены до Low/Medium вердиктом ЧАСТИЧНО) — в Backlog (Раздел 7), в
волны не включены. Итог: Фаза 2 — 31 находка + 16 партий зависимостей; Фаза 3 — 38 находок; Фаза 4 — 25
находок; сумма 31+38+25=94 из 95 Critical/High/Medium (95-я, MOBILE-BUG-01, — в Backlog).

### Фаза 2 — Security (SEC-находки Critical/High/Medium + партии обновления зависимостей)

**Critical (6, все обязательны):** AGENT-SEC-01, AGENT-SEC-02, AGENT-SEC-03, BACKEND-SEC-01,
BACKEND-SEC-03+SEC-05+QUAL-04+QUAL-05, WEB-SEC-01.

**High (14):** AGENT-SEC-04; BACKEND-SEC-02+QUAL-07, BACKEND-SEC-04, BACKEND-SEC-06, BACKEND-SEC-07,
BACKEND-SEC-08; DESKTOP-SEC-05+BUG-01+QUAL-02, DESKTOP-SEC-01; MOBILE-SEC-01+QUAL-05, MOBILE-SEC-02,
MOBILE-SEC-03; WEB-SEC-02, WEB-SEC-03, WEB-SEC-04.

**Medium (11):** AGENT-SEC-05; BACKEND-SEC-09, BACKEND-SEC-10, BACKEND-SEC-11, BACKEND-SEC-12;
DESKTOP-SEC-06+BUG-06, DESKTOP-SEC-02, DESKTOP-SEC-03; LANDING-SEC-01; MOBILE-SEC-06; WEB-SEC-05.

**Партии обновления зависимостей (16, Раздел 5):** Партии 1-2, 5 (Go/pgx/toolchain, обязательные) —
приоритет вместе с Critical; Партии 7-8 (JS прямые+транзитивные, обязательные) — приоритет вместе с
High/Medium этой фазы; Партия 10 (tauri, обязательная) — приоритет вместе с High; Партии 3, 6, 9, 11-16
(рутинные minor/patch, housekeeping) — плановая работа внутри Фазы 2 без отдельного гейта.

### Фаза 3 — Корректность (BUG-находки Critical/High/Medium, включая объединения BUG+QUAL без SEC)

**High (16):** AGENT-BUG-01+QUAL-02, AGENT-BUG-02, AGENT-BUG-03; BACKEND-BUG-01, BACKEND-BUG-02,
BACKEND-BUG-03, BACKEND-BUG-04; DESKTOP-BUG-02, DESKTOP-BUG-03; LANDING-BUG-01+QUAL-17,
LANDING-BUG-02+BUG-07+QUAL-05; MOBILE-BUG-03+QUAL-06, MOBILE-BUG-04; WEB-BUG-01, WEB-BUG-02, WEB-BUG-03.

**Medium (22):** AGENT-BUG-04, AGENT-BUG-05, AGENT-BUG-06; BACKEND-BUG-05, BACKEND-BUG-06,
BACKEND-BUG-07, BACKEND-BUG-08; DESKTOP-BUG-04, DESKTOP-BUG-05; LANDING-BUG-06+QUAL-07,
LANDING-BUG-03+BUG-04+QUAL-08, LANDING-BUG-05+QUAL-01, LANDING-BUG-09+QUAL-06, LANDING-BUG-08+QUAL-03;
MOBILE-BUG-07, MOBILE-BUG-08; WEB-BUG-04, WEB-BUG-05, WEB-BUG-06, WEB-BUG-07, WEB-BUG-08, WEB-BUG-09.

Примечание: MOBILE-BUG-01 (Critical→Medium по вердикту) сознательно исключена из Фазы 3 и перенесена в
Backlog (Раздел 7) вместе с сиблингами MOBILE-BUG-02/05/06 — все четыре чинить имеет смысл только вместе,
одним решением "подключаем офлайн-подсистему к UI или нет" (см. MOBILE-BUG-03/QUAL-06 в этой же Фазе 3,
которая устанавливает сам факт неподключённости).

### Фаза 4 — Качество кода (чистые QUAL-находки Critical/High/Medium)

**High (4):** BACKEND-QUAL-01 (нулевое покрытие тестами backend), MOBILE-QUAL-04 (печать бейджа в
shared — заглушка), WEB-QUAL-02 (настройка киоска не долетает до чек-ина), WEB-QUAL-03 (два источника
правды для поля типа бейджа).

**Medium (21):** AGENT-QUAL-01, AGENT-QUAL-03, AGENT-QUAL-05, AGENT-QUAL-10; BACKEND-QUAL-02,
BACKEND-QUAL-03, BACKEND-QUAL-06, BACKEND-QUAL-08, BACKEND-QUAL-09, BACKEND-QUAL-10; LANDING-QUAL-10,
LANDING-QUAL-11; MOBILE-QUAL-02, MOBILE-QUAL-03, MOBILE-QUAL-11; WEB-QUAL-01, WEB-QUAL-04, WEB-QUAL-05,
WEB-QUAL-06, WEB-QUAL-07, WEB-QUAL-09.

### Трудоёмкие Medium-находки, требующие решения владельца на гейте

Следующие находки формально Medium (или High для тестового покрытия backend), но их устранение — это
не быстрая правка, а отдельный проект. Владельцу нужно явно решить: чинить в Фазе 2-4 или отправить в
backlog отдельным треком.

- **BACKEND-QUAL-01 / AGENT-QUAL-01 / WEB-QUAL-01 / DESKTOP-QUAL-01(Low) / LANDING-QUAL-11(частично) /
  MOBILE-QUAL-01(Low)** — нулевое тестовое покрытие во всех 6 подсистемах. Полное закрытие — это
  недели работы на подсистему; реалистичный первый шаг — юнит-тесты на модулях наивысшего риска
  (перечислены в описаниях находок), а не 100% покрытие сразу.
- **MOBILE-QUAL-02** (mobile/android-app полностью дублирует mobile/shared) — требует архитектурного
  решения продукта/инженерии: унифицировать на одну кодовую базу (android-app потребляет :shared, либо
  :shared официально iOS-only) — это многонедельный рефакторинг, затрагивающий MOBILE-QUAL-03/04/07/08/11
  и потенциально MOBILE-BUG-04.
- **WEB-QUAL-06 / WEB-QUAL-07** (BadgeTemplateEditorV2.tsx 1135 строк, EquipmentSettings.tsx 1002
  строки) — разбиение god-компонентов на хуки/подкомпоненты; затрагивает код, в котором уже найдены
  реальные баги (WEB-BUG-04, WEB-QUAL-04), так что рефакторинг стоит делать вместе с их фиксом.
- **BACKEND-QUAL-03** (проверка tenant дублируется вручную в 10+ местах) — централизация в хелпер имеет
  смысл сделать одновременно с фиксом объединённой Critical-находки (BACKEND-SEC-03+SEC-05+QUAL-04+
  QUAL-05) и BACKEND-SEC-04/06/07/09, а не отдельно — иначе новый копипаст-паттерн повторится.
- **Партия 13 (Compose BOM, Раздел 5.5)** — обновление 2024.11.00→2026.06.01 технически "рутинное minor",
  но по объёму влияния на UI-код сопоставимо с отдельным проектом — уже вынесено отдельной партией,
  требует отдельного тикета/оценки.

## 7. Backlog (вне охвата волн)

### 7.1 Опровергнутые находки

Ни одна находка не была опровергнута (ОПРОВЕРГНУТО) — из 169 верифицированных находок 159 подтверждены
полностью, 10 — частично (с коррекцией, применённой в Разделах 2-3), 0 — опровергнуто. Раздел
формально пуст.

### 7.2 Находки, понижённые вердиктом ЧАСТИЧНО до Low/Medium — офлайн-подсистема mobile

**MOBILE-BUG-01** (Medium, понижено с Critical), **MOBILE-BUG-02** (Low, понижено с High),
**MOBILE-BUG-05** (Low, понижено с Medium), **MOBILE-BUG-06** (Low, понижено с Medium) — все четыре
находки описывают реальные, технически подтверждённые дефекты внутри одной и той же зоны кода
(offline-хранилище чек-инов, монитор сети, синхронизация — `OfflineDatabaseImpl`, `NetworkMonitorImpl`,
`SyncService`, `OfflineCheckInRepository`), но адверсариальная верификация (Задача 9) установила, что
эта зона кода **полностью недостижима**: единственные писатели/потребители
(`ZoneSelectViewModel`/`ZoneQRScannerViewModel`, `SyncService.startAutoSync()`) не зарегистрированы в
Koin DI и не подключены ни к одному маршруту `IdentoNavHost` (см. MOBILE-BUG-03/MOBILE-QUAL-06 в Фазе 3
— это находка, которая как раз фиксирует сам факт неподключённости и остаётся в волне). Поэтому:
- сегодня ни один реальный пользователь не может создать данные, которые эти четыре бага испортят/потеряют;
- чинить их по отдельности бессмысленно без предварительного решения "подключаем офлайн-подсистему к
  UI или нет" — если ответ "нет", эти 4 находки становятся неактуальными вместе с самим мёртвым кодом;
  если "да", все 4 нужно чинить одним пакетом работ перед подключением.
- **Рекомендация для владельца:** решить на гейте, войдёт ли "подключение офлайн-чек-ина" в roadmap;
  если да — эти 4 находки + MOBILE-BUG-03/QUAL-06 планируются одной задачей в Фазе 3/4; если нет — весь
  недостижимый код (`OfflineCheckInRepository`, `SyncService`, `NetworkMonitorImpl`,
  `ZoneSelectViewModel`, `ZoneQRScannerViewModel`) стоит просто удалить, чтобы не вводить в заблуждение
  относительно реальных возможностей приложения (README заявляет офлайн-устойчивость, которой на деле
  нет — см. также 7.4).

### 7.3 Low-находки, не попавшие в волны (55)

Все 55 находок раздела "Low" из Разделов 2 и 3.4 не включены в Фазы 2-4 — это мелкие, недорогие в
исправлении дефекты (мёртвый код, магические числа, дублирование небольших блоков, непоследовательные
конвенции, отсутствующие директории/константы), не блокирующие ни один текущий сценарий использования.
Рекомендуется чинить их оппортунистически — вместе с соседним кодом, который и так меняется в рамках
Фаз 2-4 (многие Low-находки указывают на те же файлы, что и находки из волн: например DESKTOP-QUAL-03/04
и DESKTOP-BUG-02/03 — один и тот же файл CheckinEvent.tsx/Equipment.tsx; WEB-QUAL-08/10/11/12/13 —
файлы, соседствующие с WEB-BUG/WEB-QUAL находками из волн), а не отдельным треком. Полный список с ID,
файлом и сутью — Раздел 2 (таблица) и Раздел 3.4 (детали).

### 7.4 Сквозные темы, заслуживающие отдельного трудозатратного усилия

- **Нулевое автоматизированное тестовое покрытие во всех 6 подсистемах.** Backend (0 из 36 файлов, 7297
  строк), Agent (0 тестов), Web (0 тестов, 74 файла), Desktop (0 тестов, нет даже конфигурации ESLint —
  DESKTOP-QUAL-08), Landing (1 файл Playwright-тестов, но сломанный по разметке — LANDING-QUAL-10 — и не
  подключённый к CI — LANDING-QUAL-11), Mobile (тестовые зависимости объявлены в Gradle, но 0 тестовых
  файлов — MOBILE-QUAL-01). Это системная проблема организации разработки, а не подсистемы — стоит
  отдельного трека "тестовая стратегия и CI-гейты" вне рамок точечных QUAL-находок Фазы 4.
- **mobile/shared и mobile/android-app — де-факто два разных приложения одного продукта.**
  MOBILE-QUAL-02 (полное дублирование архитектуры: Ktor+Koin+DataStore+Compose Multiplatform в shared
  против Retrofit+Gson+Hilt+Room в android-app, ~10 273 против ~20 803 строк), усугубляется
  MOBILE-QUAL-03 (модели данных разошлись по полям), MOBILE-QUAL-04 (печать бейджа реализована и
  сломана только в shared, т.е. не работает на iOS), MOBILE-QUAL-07 (несовместимые модели ошибок),
  MOBILE-QUAL-08 (два разных механизма генерации ZPL для бейджей), MOBILE-QUAL-11 (версии зависимостей
  разошлись между модулями, каталог версий не подключён ни в одном). README заявляет "85% общего кода"
  и "Android: Production Ready, 100%" — оба утверждения не подтверждаются кодом. Требует отдельного
  архитектурного решения продукта/инженерии (см. также Раздел 6, "трудоёмкие Medium-находки").
- **Риск сопровождения `github.com/skip2/go-qrcode`** (Раздел 5.1, Партия 4) — не CVE, но не тегирован с
  2020 года при живом апстриме; стоит оценить замену отдельным тикетом, не блокирующим Фазу 2.
- **`cargo-audit` не установлен в окружении** (Раздел 4.4) — единственная проверка безопасности
  Rust-стороны Tauri в этом аудите была разовой ручной сверкой одной прямой зависимости (`tauri`) через
  OSV.dev, а не полным сканированием `Cargo.lock`. Рекомендуется установить `cargo-audit` в CI отдельным
  тикетом инфраструктуры, не блокирующим текущий аудит.
- **Мёртвый/неиспользуемый каталог версий Gradle в mobile** (MOBILE-QUAL-11, Раздел 5.5 Партия 16) —
  `libs.versions.toml` существует, синтаксически корректен, но физически не подключён ни в одном
  `build.gradle.kts` — само существование каталога создаёт ложное ощущение централизованного управления
  версиями, которого нет.





