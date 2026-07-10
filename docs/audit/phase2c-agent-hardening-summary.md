# Фаза 2C — Сводка хардненинга принтер-агента (2026-07-10)

Закрыты 3 Critical-находки принтер-агента. Введён первый тестовый харнесс в
`agent/` (репо ранее имел 0 тестов агента).

## Гейты (финальное состояние ветки)

| Проверка | Результат |
|---|---|
| `go test ./...` (agent) | PASS (httpauth + main) |
| `go build ./...` (agent) | OK |
| `golangci-lint run ./...` (agent) | 0 issues |
| `gosec ./...` (agent) | Issues : 0 |
| `govulncheck ./...` (agent) | No vulnerabilities found |
| `cargo build` (desktop/src-tauri) | OK |
| `npm run build` (web, desktop) | OK |

## Находки → статус

| Находка | Серьёзность | Статус | Как закрыто |
|---|---|---|---|
| AGENT-SEC-01 нет аутентификации | Critical | ✅ | Bearer-токен (desktop) ИЛИ Origin-allowlist (web); токен генерируется агентом в `~/.idento/agent_config.json` |
| AGENT-SEC-02 bind на `0.0.0.0` | Critical | ✅ | флаг `--host` по умолчанию `127.0.0.1`; сервер слушает `host:port` (подтверждено `lsof`) |
| AGENT-SEC-03 CSRF/relay | Critical | ✅ | middleware: loopback-`Host` (анти-DNS-rebind) + `Content-Type: application/json` на мутациях + Origin-allowlist |

## Как аутентифицируются клиенты

- **web** (браузер) — по `Origin` (в дефолтном allowlist `http://localhost:5173/5174/3000`; переопределяется `AGENT_ALLOWED_ORIGINS`). Код web-аутентификации не менялся; потребовалась лишь правка bodyless-POST `/scan/clear` (см. ниже).
- **desktop** (Tauri) — по `Authorization: Bearer <token>`; Rust-команда `agent_request` читает токен из `~/.idento/agent_config.json`.
- Мутирующие запросы обоих клиентов теперь всегда несут `Content-Type: application/json` (bodyless `/scan/clear` иначе давал бы 415).

## Реализация

- Новый тестируемый пакет `agent/internal/httpauth` (Authorizer + Middleware, deny-by-default, constant-time сравнение токена) — 15 тестов.
- `AgentConfig` + `auth_token`/`allowed_origins`; хелперы генерации/резолвинга — 4 теста.
- Интеграция в `agent/main.go`: bind, обёртка mux авторизатором (цепочка cors→authorizer→mux, неотключаемая), согласование `rs/cors` с allowlist, лог токена/origins при старте.
- desktop `commands.rs`: Bearer-заголовок; web/desktop клиенты: JSON content-type на bodyless POST.

## Проверка потока (smoke)

`/health` без auth → 200; `/printers` без auth → 401; с allowlist-origin → 200;
с токеном → 200; с чужим origin → 401; с битым токеном → 401;
`/scan/clear` (POST) с JSON+origin/token → 200, без content-type → 415, чужой origin → 401.

## Операционные заметки (деплой)

- Токен создаётся автоматически при первом старте агента в `~/.idento/agent_config.json` (права `0600`), логируется один раз.
- Для прод-домена web добавить его origin в `AGENT_ALLOWED_ORIGINS` (CSV) или `allowed_origins` конфига.
- `--host 0.0.0.0` — только осознанный оверрайд (по умолчанию безопасно loopback).

## Backlog (осознанно отложено)

- **AGENT-SEC-04/05:** relay-валидация таргета `/printers/add`/`/print` (произвольный IP:port) — ограничить allowlist'ом/приватными диапазонами.
- **AGENT-BUG/QUAL:** гонки (scanner.Manager без мьютекса), утечки портов, таймауты, отсутствие тестов покрытия — отдельный трек.
- Хеширование токена на диске не делаем (локальный файл 0600).
