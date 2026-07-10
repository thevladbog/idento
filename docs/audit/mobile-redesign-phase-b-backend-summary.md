# Фаза B — Backend-контракт для мобильного редизайна: итоговая сводка (2026-07-10)

Ветка: `redesign/phase-b-backend` (15 коммитов от `origin/main`@`cf7fb48`).
Задачи 1-8 (схема БД, time-windowed zone access, 5 новых mobile-эндпоинтов,
web-консоль для провижининга станций, внеплановый багфикс) выполнены и
влиты в эту ветку. Задача 9 (этот документ) — финальный верификационный
гейт: помимо фиксации проверок, он же нашёл и закрыл фикс-волной 2
находки (lint-регрессию и критичный баг, ломающий фичу этой фазы) — см.
§e и раздел про lint ниже.

**Push/PR не выполнялись** — это финальный шаг, который делает отдельный
процесс после сквозного code review всей ветки.

## (a) Новые эндпоинты (Задачи 3-7)

| Метод | Путь | Задача | Назначение |
|---|---|---|---|
| `POST` | `/api/zones/:zone_id/scan` | B3 | Mobile zone-control: вердикт `allowed \| no_access \| not_registered` по отсканированному коду участника; всегда `200` (см. §c) |
| `POST` | `/api/events/:event_id/stations/provisioning-token` | B4 | Менеджер/админ минтит одноразовый provisioning-токен (TTL 10 мин), привязанный к конкретному существующему staff-пользователю тенанта |
| `POST` | `/api/stations/provision` | B4 | Публичный (без JWT) редим provisioning-токена мобильным/POS-устройством: гасит токен, создаёт `stations`-запись (номер устройства), выдаёт JWT (см. §d) |
| `POST` | `/api/events/:event_id/checkins/batch` | B5 | Идемпотентное (по `client_uuid`) применение офлайн-очереди чек-инов/входов в зону одним запросом с mobile-клиента |
| `POST` | `/api/events/:event_id/checkins/override` | B6 | Аудит-лог ручного override сотрудником вердикта `already_checked \| not_registered \| no_access` ("Всё равно пропустить") |
| `GET` | `/api/events/:event_id/stats` | B7 | KPI-счётчики события и (опционально, `?zone=`) зоны для мобильного статус-бара |

Все шесть эндпоинтов защищены `middleware.JWT()` кроме `POST
/api/stations/provision` (намеренно публичный — у устройства ещё нет JWT;
защищён тем же rate-limiter'ом, что `login`/`login-qr`). Мутирующие
эндпоинты вложены под `/api/events/:event_id/...` или `/api/zones/:zone_id/...`
для единообразия с уже существующим паттерном tenant-authz
(`requireEventOwnership`/`requireZoneOwnership`) — намеренное расхождение с
иллюстративным `POST /api/checkins/batch` из дизайн-документа.

## (b) Новые объекты БД (Задача 1, миграция `000013_mobile_stations`)

- `zone_access_rules` — добавлены колонки `time_from`, `time_to` (`VARCHAR(5)`,
  `"HH:MM"`) для time-windowed правил доступа.
- `stations` — реестр физических станций: `id`, `event_id`, `device_number`
  (порядковый номер на событие, `UNIQUE(event_id, device_number)`),
  `staff_user_id`, `device_info JSONB`, `created_at`.
- `station_provisioning_tokens` — одноразовые токены редима: `token` (PK,
  64-символьный hex), `event_id`, `staff_user_id`, `created_by`, `expires_at`,
  `consumed_at`.
- `checkin_overrides` — аудит-лог override: `id`, `attendee_id`, `zone_id`
  (nullable), `context`, `staff_user_id`, `created_at`.
- `batch_checkin_log` — идемпотентность batch-чекина: `client_uuid` (PK —
  сам является ключом идемпотентности), `event_id`, `attendee_id`, `kind`,
  `zone_id`, `device_number`, `checked_in_at`, `created_at`.
- `zone_scan_log` — журнал каждого исхода `ZoneScan` (не только успешных),
  питает `GetEventStats`: `id`, `zone_id`, `attendee_id` (nullable),
  `verdict`, `created_at`.
- Индексы: `idx_zone_scan_log_zone_created(zone_id, created_at)`,
  `idx_batch_checkin_log_event(event_id)`.

## (c) Осознанные расхождения с legacy `POST /api/zones/checkin`

1. **Всегда `200` со структурированным вердиктом.** Legacy `ZoneCheckIn`
   возвращает разные HTTP-статусы для разных исходов (`400` невалидный
   запрос, `403` не назначен на зону / зона неактивна, `404` участник не
   найден, `200` успех). Новый `ZoneScan` (`internal/handler/zone_scan.go`)
   для доменных исходов `allowed | no_access | not_registered` всегда отдаёт
   `200` с `models.ZoneScanResponse{Verdict, Reason, ...}` — это три
   равноправных бизнес-результата, которые мобильный UI рендерит как разные
   экраны, а не как ошибки. HTTP-коды ошибок (`400`/`401`/`403`/`404`/`500`)
   у `ZoneScan` остаются только для транспортных/authz-сбоев (невалидный
   `zone_id`, чужой тенант, не назначен на зону и т.п.).
2. **`CheckZoneAccessAt` строже, чем `CheckZoneAccess`, в кейсе
   "нет категории, но правила заданы".** Legacy `CheckZoneAccess`
   (`pg_store_zones.go:605`) проверяет категорийные правила только внутри
   `if ok && category != ""` — если у участника нет категории, код просто
   пропускает блок правил и падает на шаг 5 ("Default: allow if no rules
   defined"), **разрешая доступ** даже если для зоны заданы правила.
   Новая `CheckZoneAccessAt` → `evaluateZoneAccessRules`
   (`pg_store_zones.go:655`) явно: `if category == "" { return false,
   "Attendee has no category assigned" }` — **если для зоны заданы хоть
   какие-то правила, участник без категории получает отказ**. Это
   намеренное ужесточение только для нового zone-control поверхности;
   `CheckZoneAccess` и legacy `ZoneCheckIn` не тронуты и ведут себя как
   раньше.
3. Попутно: time-window (`time_from`/`time_to`) учитывается только в
   `evaluateZoneAccessRules` — `CheckZoneAccess` про него не знает вообще.

## (d) Дизайн-решение: JWT при провижининге минтится для выбранного менеджером staff-пользователя, а не для самого менеджера

`CreateStationProvisioningToken` (`internal/handler/stations.go:18`) требует
роль `admin`/`manager` и явного указания `req.StaffUserID` — существующего
пользователя **того же тенанта** (проверяется через `GetUserTenantRole`;
если пользователь принадлежит другому тенанту — единообразный `404`, чтобы
не давать enumeration чужих пользователей). Токен связывает
`event_id + staff_user_id + created_by(менеджер)`.

`ProvisionStation` (публичный редим устройством) минтит JWT именно для
`tok.StaffUserID` (`generateTokenForTenant(staffUser, event.TenantID.String(),
staffUser.Role)`), а **не** для `tok.CreatedBy`. Рационале: физическая
станция — общее устройство на точке входа, которое должно аутентифицироваться
как тот сотрудник, что реально на ней работает (его роль/зонные назначения
применяются на устройстве), а не как более широкие права генерирующего
менеджера, случайно осевшие на общем девайсе.

## (e) Задача 8: внеплановый фикс `CreateUser`/`user_tenants` — и отдельный, более серьёзный баг `AddUserToTenant`, оставленный незакрытым

**Зафикшено (коммит `f76ce3c`, вне плана, найдено в e2e-тестировании Задачи
8):** `CreateUser` (`internal/handler/users.go`) создавал строку в `users`,
но никогда не вызывал `AddUserToTenant` — новый staff/manager был невидим
для `GetUserTenantRole`, который использует `GenerateQRToken` и (важно для
этой фазы) `CreateStationProvisioningToken` при поиске staff-пользователя.
На практике это означало, что провижининг станции для только что созданного
сотрудника молча падал в `404 "Staff user not found"`. Фикс добавляет вызов
`h.Store.AddUserToTenant(...)` с ролью из тела запроса; регресс-тест
`TestCreateUser_AddsUserToTenant` добавлен.

**Изначально флагован отдельно, затем эскалирован и зафикшен в рамках этой
же фазы (коммит `f641cb8`):** во время подготовки этой сводки баг ниже был
сперва вынесен как отдельная, не связанная с мобильным редизайном задача
(`spawn_task`). Но прямая live-репродукция показала, что он **ломает
собственную фичу этой фазы** (провижининг станции — `POST
/api/events/:event_id/stations/provisioning-token` для только что созданного
staff-пользователя падает на первом же реальном использовании), поэтому
отдельная задача была отозвана и баг зафикшен здесь же.

`AddUserToTenant` (`internal/store/pg_store.go:712`) вставлял `id` явным
значением из переданной структуры:

```go
query := `INSERT INTO user_tenants (id, user_id, tenant_id, role, joined_at)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (user_id, tenant_id) DO NOTHING`
```

Оба вызывающих места — `auth.go` `Register` (существует с самого первого
коммита репозитория, `579120b`) и теперь также `users.go` `CreateUser`
(добавлено фиксом Задачи 8) — строят `&models.UserTenant{...}` **без поля
`ID`**, то есть каждый раз передают нулевой UUID
`00000000-0000-0000-0000-000000000000` как первичный ключ. `ON CONFLICT
(user_id, tenant_id) DO NOTHING` подавляет конфликт только по этому
уникальному индексу — конфликт по **другому** ограничению (`PRIMARY KEY id`)
он не подавляет, и Postgres кидает обычную ошибку `duplicate key value
violates unique constraint "user_tenants_pkey"`.

Живая репродукция на чистой (только что мигрированной) БД, **до** фикса:

1. `POST /auth/register` (первый пользователь тенанта) → `201`, в
   `user_tenants` появляется строка с `id = 00000000-0000-0000-0000-000000000000`.
2. Тем же токеном `POST /api/users` (создание второго, staff-пользователя,
   тот самый путь, который чинит Задача 8) → **`500 {"message":"Failed to
   add user to tenant"}`** — ровно из-за коллизии PK с шагом 1.

Т.е. фикс Задачи 8 действительно доводит `CreateUser` до вызова
`AddUserToTenant` — но `Register` уже "занял" единственно возможную
нулевую строку глобально (не по тенанту!), так что путь падал на **первой
же реальной попытке** добавить второго пользователя в любой уже
зарегистрированный тенант. Это серьёзнее бага, который чинит Задача 8 (тот
тихо отдавал `404` в смежном месте; этот жёстко валил основной флоу
"добавить сотрудника" кодом `500`).

**Фикс (коммит `f641cb8`):** `userTenant.ID = uuid.New()` первой строкой
внутри `AddUserToTenant` — закрывает проблему для обоих вызывающих мест
(`Register` и `CreateUser`) без изменения самих вызывающих мест, по
аналогии с тем, как каждый другой `Create*`-метод хранилища в этой кодовой
базе сам генерирует свой ID (напр. `CreateZoneAccessRule`). Повторная
живая репродукция **после** фикса: тот же сценарий (`register` → `create
staff`) → `201 Created`. Не восстановлена задним числом только уже
существующая на момент фикса строка `user_tenants` с нулевым `id` (если
такая где-то накопилась в реальном деплое до этого фикса) — это вопрос
data-backfill для конкретного окружения, вне рамок этого кодового фикса.

## (f) Гейты — фактический результат (Задача 9)

| Гейт | Команда | Результат |
|---|---|---|
| Backend build | `go build ./...` | ✅ PASS (exit 0) |
| Backend vet | `go vet ./...` | ✅ PASS (exit 0) |
| Backend tests | `go test ./... -v` | ✅ PASS — все тесты зелёные (`config`, `handler`, `middleware`, `store`; `models`/`migrations`/`zpl` — без тестов) |
| gofmt | `gofmt -l .` | ✅ PASS (пустой вывод) |
| Lint | `golangci-lint run ./...` | ✅ PASS после фикс-волны (было `4 issues` до неё — см. ниже) |
| SAST | `gosec ./...` | ✅ PASS (`Issues: 0`, 49 файлов, 9059 строк) |
| Vuln scan | `govulncheck ./...` | ⚠️ **PASS с оговоркой** — `0` уязвимостей, достижимых из кода; но обнаружена `1` уязвимость (`GO-2026-5932`, `golang.org/x/crypto/openpgp` — unmaintained/unsafe by design) в требуемом (не импортируемом кодом) модуле — govulncheck считает это не блокирующим (код её не вызывает), но не скрываю |
| Миграция с нуля | `docker compose down -v db && up -d db && go run ./cmd/migrate` | ✅ PASS — все 13/13 миграций применились с нуля, `exit 0` (перепроверено дважды, второй раз после ручной live-репродукции бага из §e) |
| Web build/typecheck | `cd web && npm run build` (нет отдельного `type-check`; `build` = `tsc -b && vite build`, что и покрывает typecheck) | ✅ PASS |
| Web lint | `npm run lint` (`eslint .`) | ✅ PASS |

### Детали lint-находок и фикс-волна (`golangci-lint run ./...`)

Изначально (до фикс-волны):

```
backend/internal/handler/zone_scan.go:75:3: Error return value of `h.Store.CreateZoneScanLog` is not checked (errcheck)
backend/internal/handler/zone_scan.go:85:3: Error return value of `h.Store.CreateZoneScanLog` is not checked (errcheck)
backend/internal/handler/zone_scan.go:99:3: Error return value of `h.Store.CreateZoneScanLog` is not checked (errcheck)
backend/main.go:423:8: SA1019: middleware.Logger is deprecated: please use middleware.RequestLogger or middleware.RequestLoggerWithConfig instead. (staticcheck)
```

(С `--max-same-issues=0` находок errcheck на самом деле было **4**, а не 3
— golangci-lint по умолчанию скрывает повторы одного и того же правила
сверх лимита `max-same-issues: 3`; четвёртая — `zone_scan.go:124`.)

- **4× errcheck в `zone_scan.go`** — новый код этой фазы (Задача 3, коммиты
  `e6b062d`/`0167ae2`). Паттерн `_ = h.Store.CreateZoneScanLog(...)`
  (намеренное игнорирование ошибки логирования, чтобы не ронять ответ
  клиенту из-за сбоя записи статистики) конфликтует с
  `errcheck.check-blank: true` в корневом `.golangci.yml` — эта опция
  специально включена репозиторием и ловит именно `_ = fn()`. Раньше в
  проекте такого паттерна не было ни разу, поэтому конфликт не проявлялся.
  **Зафикшено (коммит `f641cb8`):** все 4 места переведены на устоявшийся
  в кодовой базе идиому best-effort-логирования (`if err := ...; err !=
  nil { log.Printf(...) }`, по образцу `users.go`'s `LogUsage`) без
  изменения поведения — сбой записи в `zone_scan_log` по-прежнему не
  блокирует ответ клиенту.
- **1× staticcheck SA1019 в `main.go:423`** — подтверждено сравнением с
  `origin/main` (запустил `golangci-lint` на коммите `cf7fb48`, до Фазы B):
  та же находка уже была там. Это **не регрессия этой фазы** — `main.go` в
  этой ветке не менялся (`git diff` между merge-base и HEAD по файлу пуст).
  Существовавший ранее долг, сознательно не тронут — вне рамок Фазы B.

После фикс-волны: `golangci-lint run ./...` — **0 issues**, кроме
пред-существующей `main.go:423` находки (не эта фаза). Гейт снова зелёный,
как во всех предыдущих фазах (2A/2B/2C).

## Не-цели этой сводки

- Push ветки / открытие PR — следующий шаг вне мандата Задачи 9 (делается
  после сквозного code review всей ветки).
- Пред-существующий `main.go:423` staticcheck-долг — не трогали, вне
  рамок Фазы B.
