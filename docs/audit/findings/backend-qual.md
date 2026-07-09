# BACKEND-QUAL — backend/ (Go), КАЧЕСТВО КОДА

### BACKEND-QUAL-01: Нулевое покрытие тестами всего backend
- Файл: backend/internal/**, backend/cmd/** (все 36 .go файлов, 7297 строк)
- Описание: В `backend/internal/` и `backend/cmd/` нет ни одного файла `*_test.go` (проверено `find ... -name "*_test.go"` — пусто). Не покрыты тестами: генерация и валидация JWT (`handler/auth.go`, `handler/qr_auth.go`, `middleware/jwt.go`), чек-ин участников (`handler/attendees.go:UpdateAttendeeHandler`, `handler/zones.go:ZoneCheckIn`), генерация кодов участников (`handler/attendee_codes.go`, `handler/bulk_import.go`, `handler/api_keys.go`), проверка лимитов тарифа (`store/pg_store.go:CheckTenantLimit`), генерация ZPL-этикеток (`internal/zpl/zpl.go`, 404 строки), а также вся авторизация/мультитенантность. В корне `backend/` лежит `coverage.out` (гитигнорится), где все 1412 строк профиля показывают counter=0 — то есть даже если профиль когда-то генерировался, реального исполнения тестов не было.
- Влияние: Регрессии в чек-ине, авторизации, начислении лимитов и генерации кодов (все — найденные ниже реальные баги, см. BACKEND-QUAL-05..08) не будут пойманы автоматически; они обнаруживаются только вручную/в проде.
- Серьёзность: High
- Уверенность: высокая
- Рекомендация: Начать с unit-тестов на самые рискованные модули: `generateTokenForTenant`/`middleware.JWT`, `ZoneCheckIn`, `CheckTenantLimit`, генерацию кодов участников; добавить table-driven тесты для store через тестовый Postgres или testcontainers.
- Вердикт: ПОДТВЕРЖДЕНО — подтверждено `find`: 0 файлов `*_test.go`; подтверждено 36 .go файлов / 7297 строк в internal+cmd; coverage.out (в .gitignore) содержит 1412 строк профиля, все с counter=0.

### BACKEND-QUAL-02: Три независимые и несовместимые реализации генерации кода участника
- Файл: backend/internal/handler/attendee_codes.go:175-179, backend/internal/handler/bulk_import.go:154-163, backend/internal/handler/attendees.go:74-76
- Описание: Логика "сгенерировать код участника, если не задан" реализована трижды по-разному: (1) `generateUniqueCode()` в attendee_codes.go — `strings.ToUpper(uuid.New().String()[:8])` без проверки на коллизии вообще; (2) bulk_import.go:157-162 — тот же формат, но в цикле `for { ...; if !existingCodes[...] { break } }`, то есть с проверкой уникальности (только в рамках текущего запроса, не по всей БД); (3) attendees.go:75 `CreateAttendee` — `attendee.Code = uuid.New().String()` — **полный UUID с дефисами** (36 символов), а не 8-символьный код, как везде. `generateUniqueCode()` также используется отдельно в api_keys.go:138 для внешнего импорта.
- Влияние: Участник, созданный через "Add attendee" в UI (CreateAttendee), получит код совсем другого формата (36 симв. с дефисами) по сравнению с участником, созданным через bulk-импорт или "generate codes" (8 симв.). Это ломает консистентность QR/штрихкодов на бейджах и сканирование на чек-ине, если разные пути создания участников сосуществуют в одном мероприятии. `generateUniqueCode()` в GenerateAttendeeCodes вообще не проверяет коллизии с существующими кодами события — редкая, но реальная возможность дублирования кода.
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Вынести генерацию кода в одну функцию в store/models (с проверкой уникальности через БД, напр. `INSERT ... ON CONFLICT` retry или `SELECT EXISTS`), использовать её во всех трёх местах.
- Вердикт: ПОДТВЕРЖДЕНО — подтверждены все три реализации ровно на указанных строках: attendee_codes.go:175-179 (8 символов, без проверки коллизий), bulk_import.go:154-163 (цикл с `existingCodes`), attendees.go:74-76 (полный `uuid.New().String()`).

### BACKEND-QUAL-03: Проверка "event.TenantID == текущий tenant" дублируется вручную в каждом хендлере и местами отсутствует
- Файл: backend/internal/handler/attendees.go (CreateAttendee:59, UpdateAttendeeInfo:136, BlockAttendee:275, UnblockAttendee:311, DeleteAttendee:347), backend/internal/handler/events.go:89,119, backend/internal/handler/badge_zpl.go:77, backend/internal/handler/attendee_codes.go:25,66, backend/internal/handler/sync.go:131,151 и др.
- Описание: Проверка принадлежности event/attendee текущему tenant (`event.TenantID != tenantID` / `event.TenantID.String() != user.TenantID`) скопирована вручную более чем в 10 хендлерах, двумя разными идиомами сравнения (uuid.UUID vs string). Она не вынесена ни в middleware, ни в store (запросы к БД не фильтруют по tenant_id вообще, см. `GetAttendeeByID`, `GetEventByID` в pg_store.go — выборка идёт только по `id`). Из-за этого при добавлении новых хендлеров проверка легко забывается — что и произошло (см. BACKEND-QUAL-05).
- Влияние: Любое изменение модели авторизации требует правки в десятке мест; уже привело к реальным пропускам проверки (следующая находка).
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Вынести проверку в общий хелпер (`func (h *Handler) loadEventForTenant(ctx, eventID, claims) (*models.Event, error)`) или добавить фильтрацию по tenant_id непосредственно в SQL-запросы store.
- Вердикт: ПОДТВЕРЖДЕНО — проверка `event.TenantID != tenantID`/`.String() != user.TenantID` подтверждена ровно на всех указанных строках (attendees.go:59,136,275,311,347; events.go:89,119; badge_zpl.go:77; attendee_codes.go:25,66; sync.go:131,151), используя две разные идиомы сравнения; store-запросы (GetAttendeeByID/GetEventByID) действительно фильтруют только по `id`.

### BACKEND-QUAL-04: UpdateAttendeeHandler (эндпоинт чек-ина) не проверяет принадлежность attendee к tenant вызывающего
- Файл: backend/internal/handler/attendees.go:182-246 (`PUT /api/attendees/:id`, зарегистрирован в handler.go:63 с комментарием "For check-in status")
- Описание: В отличие от соседних хендлеров в этом же файле (BlockAttendee, UnblockAttendee, DeleteAttendee, UpdateAttendeeInfo), которые после `GetAttendeeByID` получают event и сверяют `event.TenantID != tenantID`, `UpdateAttendeeHandler` этого не делает: он получает attendee по ID (строка 189) и сразу меняет `checkin_status`/`checked_in_at`/`checked_in_by` (строки 211-237), используя только `claims.UserID` для записи "кто отметил", без какой-либо проверки `claims.TenantID`.
- Влияние: Любой аутентифицированный пользователь (из любого tenant) может отправить `PUT /api/attendees/{любой-uuid}` и изменить статус чек-ина участника чужого мероприятия/tenant, зная или подобрав UUID. Это напрямую ломает ключевой сценарий "чек-ин" (см. шкалу серьёзности в reviewer-common.md).
- Серьёзность: High
- Уверенность: высокая
- Рекомендация: Добавить в UpdateAttendeeHandler ту же проверку tenant, что и в соседних хендлерах этого файла (получить event по attendee.EventID и сверить tenant), в идеале — централизованно (см. BACKEND-QUAL-03).
- Вердикт: ПОДТВЕРЖДЕНО — независимо подтверждено чтением attendees.go:182-246: `UpdateAttendeeHandler` не содержит проверки tenant, в отличие от соседних `BlockAttendee`/`UnblockAttendee`/`DeleteAttendee`/`UpdateAttendeeInfo`.

### BACKEND-QUAL-05: GetAttendees и ZoneCheckIn не проверяют принадлежность event/zone к tenant вызывающего
- Файл: backend/internal/handler/attendees.go:97-110 (`GetAttendees`), backend/internal/handler/zones.go:327-466 (`ZoneCheckIn`)
- Описание: `GetAttendees` берёт `event_id` из URL и сразу вызывает `h.Store.GetAttendeesByEventID`, не сверяя, что событие принадлежит tenant вызывающего (сравните с `GetEvent` в events.go:87-91, где такая проверка есть). `ZoneCheckIn` — основной эндпоинт зонного чек-ина — получает zone по `req.ZoneID` (тело запроса, не URL, значит легко подставить чужой ID) и далее весь код (строки 340-465) работает с этой зоной/событием/участником без единой проверки, что zone.EventID принадлежит tenant текущего пользователя (сравните с sync.go:131,151, где для похожей операции проверка есть).
- Влияние: Аутентифицированный сотрудник одного tenant может прочитать список участников чужого мероприятия (`GetAttendees`) либо выполнить чек-ин участника в зоне чужого tenant (`ZoneCheckIn`), передав чужой `zone_id`/`event_id`. Это напрямую касается чек-ина — критичного сценария.
- Серьёзность: High
- Уверенность: высокая
- Рекомендация: Добавить проверку tenant для обоих эндпоинтов по аналогии с GetEvent/SyncPush; рассмотреть проверку прав уровня zone/event (assigned staff) в самом ZoneCheckIn.
- Вердикт: ПОДТВЕРЖДЕНО — независимо подтверждено чтением attendees.go:97-110 и zones.go:327-466: ни `GetAttendees`, ни `ZoneCheckIn` не сверяют tenant, в отличие от `GetEvent`/`SyncPush`, которые эту проверку делают.

### BACKEND-QUAL-06: Несогласованная обработка "не найдено" в store — часть методов возвращает (nil, nil), часть — (nil, ErrNoRows)
- Файл: backend/internal/store/pg_store.go:153-167 (GetTenantByID), :213-224 (GetUserByID), :388-405 (GetEventByID) vs :197-212 (GetUserByEmail), :459-479 (GetAttendeeByCode), :481-501 (GetAttendeeByID), :559-578 (GetAPIKeyByHash), :652-670 (GetFontByID)
- Описание: `GetUserByEmail`, `GetAttendeeByCode`, `GetAttendeeByID`, `GetAPIKeyByHash`, `GetFontByID`, `GetSubscriptionByTenantID` явно проверяют `if err == pgx.ErrNoRows { return nil, nil }`. Но `GetTenantByID`, `GetUserByID`, `GetEventByID` (и `UpdateEvent`, использующий тот же паттерн) этого не делают — при отсутствии записи возвращают `nil, err` с `err == pgx.ErrNoRows`. Хендлеры при этом почти везде проверяют `if err != nil || result == nil { 404 }`, полагаясь на конвенцию "не найдено = (nil, nil)".
- Влияние: Конкретный пример — `GetEvent` (events.go:76-94): при запросе несуществующего `event_id` `GetEventByID` вернёт `(nil, pgx.ErrNoRows)`, и хендлер попадёт в ветку `if err != nil` (строка 83) и ответит **500 Internal Server Error**, а не 404, как для аналогичного случая с attendee/font/api-key. Клиенты API получают разные и неверные коды состояния для одинаковой по сути ситуации "ресурс не найден".
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Привести все Get*ByID/ByEmail методы store к единой конвенции (например, всегда возвращать `(nil, nil)` при ErrNoRows, ошибку — только при реальных сбоях БД).
- Вердикт: ЧАСТИЧНО — центральный пример подтверждён (`GetTenantByID`/`GetUserByID`/`GetEventByID` не проверяют `pgx.ErrNoRows` и пробрасывают его как обычную ошибку; `GetEvent` в events.go:82-85 из-за этого действительно отвечает 500, а не 404), но `GetAPIKeyByHash` (pg_store.go:559-576) и `GetFontByID` (652-669) на самом деле возвращают `(nil, fmt.Errorf(...))` с текстом ошибки, а не `(nil, nil)`, как утверждается в находке — категоризация этих двух методов в группе "(nil, nil)" неточна, хотя общий вывод о несогласованности конвенций верен.

### BACKEND-QUAL-07: LoginWithQR подписывает JWT захардкоженным литералом секрета вместо общего механизма
- Файл: backend/internal/handler/qr_auth.go:36-46
- Описание: `Register`/`Login`/`SwitchTenant` в auth.go генерируют токен через общую функцию `generateTokenForTenant` (auth.go:192-211), которая читает `JWT_SECRET` из окружения и **явно возвращает ошибку**, если переменная не задана (комментарий "fail if not set for security", auth.go:204-208). `LoginWithQR` дублирует логику построения JWT-claims вручную и подписывает токен строкой `"your-secret-key"` (строка 46, с комментарием `// TODO: use env var`), полностью игнорируя `JWT_SECRET`. Валидирующий токены `middleware.JWT()` (middleware/jwt.go:29-33) при этом читает `JWT_SECRET`, а если он не задан — использует свой отдельный хардкод `"idento_secret_key_change_me"` (middleware/jwt.go:31), отличный от `"your-secret-key"`.
- Влияние: В любой инсталляции, где `JWT_SECRET` задан (как и требует auth.go, иначе обычный логин вообще не работает), токен, выданный `LoginWithQR`, подписан секретом `"your-secret-key"`, который не совпадает с `JWT_SECRET` — то есть `middleware.JWT()` отклонит его как невалидный. QR-логин для персонала (ключевой сценарий на мероприятии, где сотрудники входят по QR) фактически не работает при штатной конфигурации с заданным `JWT_SECRET`. Это прямое следствие дублирования (не переиспользования) логики генерации токена.
- Серьёзность: High
- Уверенность: высокая
- Рекомендация: Заменить ручное построение JWT в LoginWithQR вызовом `generateTokenForTenant(user, user.TenantID.String(), role)`, убрать хардкод секрета и TODO.
- Вердикт: ПОДТВЕРЖДЕНО — независимо подтверждено чтением qr_auth.go:36-46 и auth.go:192-211/204-208 и middleware/jwt.go:29-33: три независимых секрета (`JWT_SECRET`, `"your-secret-key"`, `"idento_secret_key_change_me"`) действительно используются в трёх разных местах.

### BACKEND-QUAL-08: CheckTenantLimit не реализован для лимита "attendees_per_event" — заглушка с current=0
- Файл: backend/internal/store/pg_store.go:1239-1258 (`CheckTenantLimit`), используется в handler.go:58-59 (`middleware.CheckLimits(h.Store, "attendees_per_event")`)
- Описание: `switch limitType` в CheckTenantLimit обрабатывает `"events_per_month"` и `"users"` реальными SQL-запросами, а для `"attendees_per_event"` стоит комментарий "This should be checked per event, not tenant-wide / Implementation depends on context" и просто `current = 0` (строка 1251). При этом маршруты `POST /events/:event_id/attendees` и `.../attendees/bulk` (handler.go:58-59) явно защищены этим лимитом через middleware.
- Влияние: Если для тарифа задан лимит `attendees_per_event` (через plan.Limits или custom_limits), `current` всегда 0, поэтому `allowed := current < maxLimit` всегда true — лимит по факту никогда не срабатывает, сколько бы участников ни было создано (бизнес-функция биллинга неработоспособна). Если лимит для тарифа не задан вовсе, `maxLimit` остаётся 0 (нулевое значение), и `0 < 0` = false — тогда создание участников блокируется для ЛЮБОГО tenant без явно прописанного лимита. Оба сценария — баг.
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Реализовать подсчёт `SELECT COUNT(*) FROM attendees WHERE event_id = $1 AND deleted_at IS NULL` (event_id нужно прокинуть в CheckTenantLimit/middleware.CheckLimits, сейчас туда передаётся только tenantID) либо убрать этот limitType, пока не готов, и добавить `default:` в switch с явной ошибкой на неизвестный/нереализованный limitType вместо тихого `current = 0`.
- Вердикт: ПОДТВЕРЖДЕНО — `CheckTenantLimit` (pg_store.go:1203-1262) подтверждён: `case "attendees_per_event": current = 0` (1248-1251) делает лимит всегда неэффективным при заданном лимите, а `maxLimit == 0` при отсутствии лимита даёт `allowed := 0 < 0 == false`, блокируя создание участников для любого tenant без явного лимита.

### BACKEND-QUAL-09: Несогласованный формат тела ошибки API — `{"error": ...}` vs `{"message": ...}`
- Файл: backend/internal/handler/bulk_import.go, qr.go, printer_qr.go, qr_auth.go, users.go (46 вызовов echo.NewHTTPError) против остальных ~30 файлов (177 вызовов `c.JSON(status, map[string]string{"error": ...})`)
- Описание: main.go не регистрирует кастомный `e.HTTPErrorHandler`, поэтому `echo.NewHTTPError(status, msg)` рендерится дефолтным обработчиком Echo как `{"message": "msg"}`, тогда как подавляющее большинство хендлеров вручную формируют `c.JSON(status, map[string]string{"error": "msg"})`. Оба стиля используются в рамках одного и того же API (например, users.go использует echo.NewHTTPError 29 раз, а его сосед tenants.go — c.JSON с ключом "error").
- Влияние: Фронтенд/мобильные клиенты, которые парсят тело ошибки по ключу `error`, получат `undefined`/пропущенное сообщение об ошибке на эндпоинтах bulk-импорта, QR-кодов, printer-qr, qr-логина и части users — то есть именно там, где часто нужно показать пользователю причину сбоя (например, при импорте участников).
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Выбрать один формат (`{"error": ...}` или `{"message": ...}`), зарегистрировать кастомный `e.HTTPErrorHandler` в main.go и привести все хендлеры к нему; для унификации проще всего обернуть echo.NewHTTPError-вызовы в одинаковый c.JSON.
- Вердикт: ПОДТВЕРЖДЕНО — подтверждено grep: ровно 46 вызовов `echo.NewHTTPError` строго в bulk_import.go/qr.go/qr_auth.go/printer_qr.go/users.go, ровно 177 вызовов `c.JSON(..., map[string]string{"error": ...})` в остальных файлах; main.go не регистрирует кастомный `e.HTTPErrorHandler`.

### BACKEND-QUAL-10: api_keys.go использует context.Background() вместо контекста запроса — теряется отмена/таймаут
- Файл: backend/internal/handler/api_keys.go:51,71,86,111,179,188
- Описание: Все шесть DB-вызовов в этом файле (`CreateAPIKey`, `GetAPIKeysByEventID`, `RevokeAPIKey`, и в `ExternalImport` — `GetEventByID`, `CreateAttendee`, `UpdateEvent`) используют `context.Background()`. Это единственный файл в handler/ с таким паттерном — все остальные 14 файлов последовательно используют `c.Request().Context()` (проверено grep по всей директории).
- Влияние: Запросы к БД в этом файле не отменяются при закрытии клиентского соединения и не наследуют дедлайны/таймауты, которые могут быть выставлены выше по стеку (прокси, будущий контекстный таймаут). `ExternalImport` — публичный эндпоинт для внешних систем импорта (аутентификация по API-ключу), где отсутствие привязки к контексту запроса особенно нежелательно при больших пакетах данных.
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Заменить все `context.Background()` в api_keys.go на `c.Request().Context()`.
- Вердикт: ПОДТВЕРЖДЕНО — подтверждены все 6 вызовов `context.Background()` ровно на строках 51,71,86,111,179,188 в api_keys.go; ни один другой файл handler/ так не делает (грep по всем 14 остальным файлам не даёт совпадений).

### BACKEND-QUAL-11: pg_store.go — 1320 строк, смешаны ~10 не связанных доменов в одном файле
- Файл: backend/internal/store/pg_store.go (1320 строк, самый большой файл в подсистеме)
- Описание: Файл содержит методы для: миграций (RunMigrations), tenants, users и мульти-тенантности (AddUserToTenant/GetUserTenantRole), назначения персонала на события, events, attendees, API-ключей, шрифтов (fonts), тарифных планов (SubscriptionPlan), подписок (Subscription), учёта использования (UsageLog/CheckTenantLimit), аудит-лога (LogAdminAction/GetAuditLog) — это 10+ разных предметных областей в одном файле с общим "残り" неймингом. При этом в этом же пакете уже есть прецедент правильного разделения: pg_store_zones.go (зоны), pg_store_sync.go (sync), pg_store_super_admin.go (super-admin вынесены отдельно) — то есть конвенция разделения по доменам существует, но не применена последовательно к "базовому" файлу.
- Влияние: Затруднена навигация и code review (любое PR по биллингу/тарифам, аудиту или fonts трогает один и тот же гигантский файл); повышенный риск конфликтов при параллельной разработке.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Разбить pg_store.go по аналогии с уже выделенными файлами: pg_store_billing.go (subscriptions/plans/usage/limits), pg_store_fonts.go, pg_store_audit.go, оставив в pg_store.go только tenants/users/events/attendees и миграции.
- Вердикт: ПОДТВЕРЖДЕНО — `wc -l` подтверждает ровно 1320 строк в pg_store.go, содержащих все перечисленные домены; pg_store_zones.go/pg_store_sync.go/pg_store_super_admin.go подтверждены как уже существующий прецедент разделения.

### BACKEND-QUAL-12: zones.go (handler) — 676 строк, смешаны 6 разных зон ответственности
- Файл: backend/internal/handler/zones.go (676 строк)
- Описание: Один файл объединяет: CRUD зон мероприятия, CRUD правил доступа к зонам, CRUD индивидуальных override-доступов участников, назначение персонала на зоны, бизнес-логику зонного чек-ина (ZoneCheckIn, ~140 строк с 9 явно пронумерованными шагами валидации), mobile-специфичную фильтрацию зон по правам сотрудника и генерацию QR-кода зоны (со своим импортом `github.com/skip2/go-qrcode`, дублирующим импорт из qr.go/printer_qr.go). Это самый крупный по числу разнородных обязанностей файл в handler/.
- Влияние: Основная бизнес-логика чек-ина (ZoneCheckIn) теряется среди CRUD-шаблонного кода; сложнее точечно тестировать/ревьюить именно критичную часть.
- Серьёзность: Low
- Уверенность: средняя
- Рекомендация: Разнести на zones_crud.go, zone_access.go, zone_checkin.go (核心 бизнес-логика отдельно), zone_qr.go.
- Вердикт: ПОДТВЕРЖДЕНО — `wc -l` подтверждает ровно 676 строк в zones.go, содержащих CRUD зон, правил доступа, individual overrides, staff-назначения, `ZoneCheckIn` и генерацию QR (собственный импорт `go-qrcode`, дублирующий qr.go/printer_qr.go).

### BACKEND-QUAL-13: Непроверяемое приведение типа `c.Get("user").(*models.JWTCustomClaims)` повторено 32 раза в 11 файлах
- Файл: backend/internal/handler/{sync,users,auth,attendees,badge_zpl,super_admin,bulk_import,events,zones,attendee_codes,tenants}.go (32 вхождения `c.Get("user").(*models.JWTCustomClaims)` без проверки `ok`)
- Описание: Везде, кроме middleware/limits.go (которое делает `claims, ok := user.(*models.JWTCustomClaims)` с проверкой), хендлеры делают безусловное приведение типа `c.Get("user").(*models.JWTCustomClaims)`. Паттерн скопирован в каждый хендлер вместо общего хелпера.
- Влияние: Если `c.Get("user")` вернёт nil (маршрут случайно окажется без `middleware.JWT()`, либо middleware в будущем изменит порядок Set) — паника, перехватываемая `middleware.Recover()` и превращаемая в непрозрачный 500 без единообразного сообщения; отладка усложнена, поведение отличается от middleware/limits.go, где такая ситуация обрабатывается как контролируемый 401.
- Серьёзность: Low
- Уверенность: средняя
- Рекомендация: Добавить хелпер `func getClaims(c echo.Context) (*models.JWTCustomClaims, error)` с явной проверкой `ok`, использовать во всех хендлерах вместо прямого приведения типа.
- Вердикт: ПОДТВЕРЖДЕНО — grep подтверждает ровно 32 вхождения `c.Get("user").(*models.JWTCustomClaims)` ровно в 11 перечисленных файлах; middleware/limits.go подтверждён как единственное место с безопасной проверкой `ok`.

### BACKEND-QUAL-14: main.go встраивает устаревшую, неполную копию OpenAPI-спецификации вместо реального файла
- Файл: backend/main.go:16-386 (константа `backendOpenAPISpec`), backend/openapi.yaml (714 строк)
- Описание: Эндпоинт `GET /openapi.yaml` (main.go:447-449) отдаёт не файл `backend/openapi.yaml` (714 строк, актуальный, с полным описанием эндпоинтов), а захардкоженную Go-константу `backendOpenAPISpec` (386 строк), которая покрывает лишь малую часть реальных маршрутов (нет zones, API keys, fonts, super-admin и т.д., которые есть в handler.go) и текстуально разошлась с файлом (сравнение diff показывает разные формулировки в info.description, тегах и т.д.).
- Влияние: `/docs` (Scalar UI, main.go:457-472) и `/openapi.yaml` показывают внешним потребителям API устаревшую и неполную документацию; два источника правды для одной и той же спецификации будут расходиться дальше при каждой правке одного без другого.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Удалить встроенную константу и отдавать `openapi.yaml` через `c.File("openapi.yaml")`, либо генерировать константу из файла на этапе сборки.
- Вердикт: ПОДТВЕРЖДЕНО — main.go:16-386 действительно содержит константу `backendOpenAPISpec`, отдаваемую через `/openapi.yaml` (447-449), покрывающую лишь малую часть маршрутов (нет zones/api-keys/fonts/super-admin), при наличии отдельного полного backend/openapi.yaml.

### BACKEND-QUAL-15: Мёртвые пустые директории backend/handlers и backend/models
- Файл: backend/handlers/ (пусто), backend/models/ (пусто)
- Описание: В корне backend/ существуют пустые директории `handlers` и `models` — по всей видимости, остаток до переноса кода в `backend/internal/handler` и `backend/internal/models`. Файлов в них нет (проверено `find`/`ls -la`).
- Влияние: Засоряют структуру репозитория, вводят в заблуждение при навигации (можно принять за альтернативный/дублирующий код).
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Удалить пустые директории.
- Вердикт: ПОДТВЕРЖДЕНО — `find`/`ls` подтверждают, что backend/handlers/ и backend/models/ существуют и пусты.
