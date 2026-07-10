# Фаза 2B — Сводка backend security-фиксов (2026-07-09)

Закрытие Critical/High/Medium SEC-находок backend из аудита под TDD. Введён
первый тестовый харнесс backend (репо ранее имел 0 тестов) — теперь 42 теста в
10 файлах. Каждая authz-дыра покрыта регрессионным тестом.

## Гейты (финальное состояние ветки)

| Проверка | Результат |
|---|---|
| `go test ./...` | PASS (42 теста, handler + middleware) |
| `go build ./...` | OK |
| `golangci-lint run ./internal/...` | 0 issues |
| `gosec ./...` | Issues : 0 |
| `govulncheck ./...` | No vulnerabilities found |

## Находки → статус

| Находка | Серьёзность | Статус | Задача/коммит |
|---|---|---|---|
| SEC-01 JWT hardcoded fallback | Critical | ✅ закрыто | 2B-2 (fail-closed keyfunc + fail-fast старт) |
| SEC-02 QR-логин hardcoded secret | High | ✅ закрыто | 2B-2 (generateTokenForTenant) |
| SEC-03 tenant в GetAttendees/UpdateAttendee | Critical | ✅ закрыто | 2B-3 |
| SEC-04 IDOR GetAttendeeQR | High | ✅ закрыто | 2B-3 |
| SEC-05 ZoneCheckIn без authz | Critical | ✅ закрыто | 2B-4 (tenant + роль/staff, deny-by-default) |
| SEC-06 системный tenant-пробел zones.go | High | ✅ закрыто | 2B-5 (все 22 хендлера + GetAttendeeZoneAccessByID) |
| SEC-07 API-ключи чужих событий | High | ✅ закрыто | 2B-6 |
| SEC-08 утечка qr_token через GET /api/users | High | ✅ закрыто | 2B-8 (json:"-" + has_qr_token) |
| SEC-09 tenant в fonts.go | Medium | ✅ закрыто | 2B-7 (Get/Upload/CSS + DeleteEventFont + GetFontFile) |
| SEC-10 разрешающий CORS `*` | Medium | ✅ закрыто | 2B-9 (CORS_ALLOWED_ORIGINS allowlist, **fail-fast** при пустом — иначе Echo подставляет `*`) |
| SEC-11 CSV formula injection | Medium | ✅ закрыто | 2B-10 (sanitizeCSVField: значения + заголовок) |
| SEC-12 нет rate limiting | Medium | ✅ закрыто | 2B-11 (login/login-qr/checkin) |

Общий authz-хелпер (`internal/handler/authz.go`:
`requireEventOwnership`/`requireZoneOwnership`/`writeErr`) введён в 2B-1 и применён
единообразно вместо копипаст-проверок.

**Финальное ревью всей ветки** дополнительно нашло и закрыло 2 блокера, не видимых
по-задачно: (1) CORS при пустом `CORS_ALLOWED_ORIGINS` молча откатывался к `*`
(Echo подставляет дефолт при пустом списке) → сделан fail-fast при старте;
(2) `GetFontFile` (`GET /fonts/:id/file`) не проверял tenant → добавлена
`requireEventOwnership` + регресс-тест.

⚠️ **Деплой:** `CORS_ALLOWED_ORIGINS` теперь обязателен — сервер не стартует без
него (как `JWT_SECRET`/`DATABASE_URL`). Для desktop (Tauri) в проде origin —
кастомная схема (`tauri://localhost`), её нужно добавить в список.

## Backlog (осознанно отложено)

- **SEC-13** (Low): пароль в argv `reset_password` — читать из stdin/env
  (пароль-в-URL для БД уже убран в Фазе 2A).
- **Хеширование `qr_token` в БД** (defense-in-depth) — требует миграции схемы и
  изменения `GetUserByQRToken`; в 2B закрыта только утечка сериализации.
- **Лимит на шрифты** (`CheckLimits` для upload) — `CheckTenantLimit` не
  поддерживает тип `fonts`; нужен реальный ключ лимита + counting-case (иначе
  каждая загрузка 403). Проверка владения уже добавлена.
- **`e.IPExtractor`/trusted-proxy для rate limiter** — сейчас `RealIP()` доверяет
  `X-Forwarded-For` (spoofable при прямом доступе без прокси).
- **DRY inline tenant-проверок** в attendees.go (UpdateAttendeeInfo/Block/Unblock/
  Delete всё ещё дублируют логику вместо `requireEventOwnership`).
- **Единый формат ошибок**: часть путей (qr.go, LoginWithQR) ещё отдаёт
  echo.NewHTTPError `{"message"}` вместо `{"error"}`.
- **BACKEND-BUG-04** (неверное приведение типа в UploadEventFont → 401) — это
  BUG-находка Фазы 3.
- Мёртвый `allFields` в ExportAttendeesCSV.

## Не-цели (по охвату фазы)

Agent-хардненинг (AGENT-SEC-*) и frontend security-фиксы (web/desktop/mobile/
landing) — отдельные планы, требуют координации с клиентами.
