# Kiosk K2a — Staffed-Run Implementation — Design

**Дата:** 2026-07-21
**Статус:** утверждён
**Родитель:** `docs/superpowers/specs/2026-07-21-kiosk-desktop-v2-design.md` (K2 — desktop/src rewrite). K2 декомпозирован на K2a (этот документ — pre-flight + staffed-run) и K2b (self-service, отдельный цикл, вне объёма).

## 1. Цель и объём

Переписать `desktop/src` на новый check-in loop и `@idento/ui/kiosk` (готово с K1): pre-flight-визард из 5 шагов (с новым под-шагом регистрации станции), staffed-run экраны (компоновка 1a/1c), три входа сканирования (`wedge`/`scanner`/`manual`), деградация/блокировка по канве K1.

**Вне объёма K2a:** self-service (K2b), камера как источник скана (backend enum `scan_input` не имеет значения `camera`; при появлении спроса — отдельное решение о расширении enum на backend+panel), офлайн-очередь отметок, Undo/Reprint с киоска (остаётся staff-действием в panel), светлая тема, e2e-тесты (P5.3.2 покрывает panel/web Playwright отдельно; desktop e2e — будущий follow-up).

## 2. Ключевое решение: миграция на server-side check-in loop

Текущий `desktop/src` (не тронут в K1) делает check-in клиентски: тянет весь список attendees события, ищет код локально, `PUT /api/attendees/:id {checkin_status: true}`. Backend уже имеет полноценный идемпотентный check-in loop (P4.1), а **panel уже использует его** (`panel/src/features/checkin/`) — включая опрос того же локального hardware-агента, который K1 бандлит в desktop как sidecar. K2a мигрирует desktop на этот loop:

- `POST /api/events/{event_id}/checkin {attendee_id, station_id}` → `CheckinOutcome`: `checked_in | already_checked_in | blocked` (сервер решает; `not_found` НЕ приходит с сервера — это клиентский исход, когда `GET /attendees?code=X` вернул пусто, до вызова `/checkin`).
- Маппинг в `Verdict` (`@idento/ui`): `checked_in→allowed`, `already_checked_in→already_checked_in`, `blocked→no_access`, клиентский `not_found→not_registered`. Копия panel's `verdict.ts`-маппинга, тот же порядок.
- `GET /api/events/{event_id}/attendees?code=X` — exact-match поиск по коду (не весь список). `?search=` — подстрочный поиск (включается `manual_search_enabled`), закрывает канвовский экшен «Найти по имени» на экране «код не найден».
- `POST /api/events/{event_id}/checkin-stations` (upsert по имени) + `POST .../checkin-stations/{id}/heartbeat` (каждые 20с, пока станция смонтирована) — станция теперь **именованная сущность на сервере**, а не анонимный клиент.
- `GET/PUT /api/events/{id}/checkin-settings` — `scan_input` (`wedge|scanner|manual`), `print_on_checkin`, `manual_search_enabled`, `verdict_auto_dismiss_sec` (1..30) читаются с сервера, а не из чисто локального `checkinSettings.ts` (как сейчас); событийный уровень, общий для всех станций этого события.
- `POST /api/events/{event_id}/checkin/undo` и `markAttendeePrinted` (reprint-лог) существуют на сервере, но **не вызываются с киоска в K2a** — это panel/staff-действия.

## 3. Переиспользование логики panel (порт паттерна, не файлов)

`panel/src/features/checkin/` — боевой, прошедший несколько раундов bot-review код с проработанными edge-case'ами (re-entrancy guard на submitCode/submitAttendee, debounced online-сигнал, atomic scan-consume, wedge-refocus эвристика, printer-readiness gate). Прямой импорт невозможен (desktop не импортирует из panel, разный транспорт: panel — browser fetch + browser print, desktop — Tauri agent invoke + ZPL-печать через агента). **Решение: заново написать те же хуки в `desktop/src/features/checkin/`, зеркаля логику и прокомментированные edge-case'ы panel'а**, адаптируя только транспортный слой:

| Panel (browser) | Desktop (Tauri), K2a |
|---|---|
| `useCheckinFlow` (fetch + `usePrintBadge`) | `useCheckinFlow` (тот же контракт: `submitCode`/`submitAttendee`/`state`/`clear`, тот же re-entrancy `busyRef`, тот же auto-dismiss-таймер из `verdict_auto_dismiss_sec`), но печать — через `lib/agent.ts`'s `agentPost("/print", ...)` + `markAttendeePrinted` вместо `usePrintBadge` |
| `useScanInput` (agentClient = browser fetch к агенту) | `useScanInput`, тот же 3-режимный контракт (`wedge`/`scanner`/`manual`), но `scanner`-поллинг — `agent_request` invoke на `POST /scan/consume` (атомарный read+clear — переход с текущего рассинхронного `/scan/last`+`/scan/clear`) |
| `useHeartbeat` (TanStack `useMutation`) | тот же 20с-интервал, ref-mirrors-latest-callback идиома, `.mutate()`-как-fire-and-forget |
| `useConnectionState` (navigator.onLine + query isError) | тот же debounced (400мс) сигнал: `navigator.onLine` + react-query isError с checkin-actions-эквивалентного поллинга |
| `verdict.ts` (`outcomeToVerdict`) | копия маппинга, тот же порядок веток |
| `settingsTypes.ts` (`parseCheckinSettings`, `DEFAULT_CHECKIN_SETTINGS`) | копия defensive-parser логики (per-field fallback, clamp `verdict_auto_dismiss_sec` в 1..30) |

Ничего в `panel/` не меняется K2a-работой — нулевой риск регрессии проверенной фичи.

## 4. Слой данных: TanStack Query

Desktop сейчас на axios + `useEffect`/`useState` (без библиотеки запросов). K2a добавляет **TanStack Query** — приближает к panel (упрощает портирование хуков из §3), даёт retry/cache бесплатно вместо ручного дебаунса/поллинга для health-сигналов и heartbeat. `lib/api.ts`'s axios-инстанс остаётся транспортом под `queryFn`/`mutationFn` (не заменяется на `fetch`/openapi-client — вне объёма K2a генерировать typed-клиент для desktop).

## 5. Pre-flight (5 шагов, `PreflightShell` из K1)

1. **Подключение** — URL backend + health-check (как сейчас, без изменений).
2. **Вход** — пароль/staff-QR (как сейчас, без изменений).
3. **Оборудование** (чек-лист готовности): здоровье агента, принтер (список + дефолт + тест-печать), сканер (COM-порт + скан-тест генерируемым QR — как сейчас), **плюс новый под-шаг: регистрация станции** (имя станции, опционально zone_id) → `POST checkin-stations`, сохраняет `station_id` локально.
4. **Событие** — карточки событий с прогрессом отметок (как сейчас).
5. **Режим и настройки станции**: выбор компоновки run-экрана (1a полоса / 1c панель — **локальный** выбор станции, не серверная настройка) + чтение/запись `checkin-settings` события (`scan_input`, `print_on_checkin`, `manual_search_enabled`, `verdict_auto_dismiss_sec`) через `GET/PUT checkin-settings`. Когда `GET checkin-settings` возвращает `settings: null` (событие никогда не сохраняло настройки), форма предзаполняется теми же значениями, что `DEFAULT_CHECKIN_SETTINGS` в panel (`print_on_checkin: true, verdict_auto_dismiss_sec: 4, scan_input: "wedge", manual_search_enabled: true`) — те же дефолты в обоих приложениях, чтобы первое сохранение с любой стороны не удивляло оператора другой.

Локально в станции (localStorage, как сейчас `checkinSettings.ts`) хранится: `station_id`, выбор компоновки (1a/1c), выбранный принтер (name).

## 6. Run-экран (1a/1c)

`TopStatusBar`/`OperatorPanel` (по выбору компоновки станции) с узлами:
- **Сервер** — react-query error-based сигнал (как `useConnectionState`, debounced 400мс).
- **Агент** — `checkAgentHealth()` (уже есть).
- **Принтер** — агент `/printers/default` + reachability.
- **Сканер** — `useScanInput`'s `degraded`-флаг (только для `scanner`-режима; serial-опрос не отвечает).

**Деградация принтера**: `print_on_checkin && принтер не готов` блокирует **только экран сканирования** (не check-in-логику) — тот же гейт, что у panel's `StationPage` (`printerGateActive`). Не блокирует, если `print_on_checkin` выключен.

**Офлайн**: `!connection.online` блокирует новые сканы клиентски (никогда не queue — явно вне объёма и K1, и K2a), `BlockingBanner` с авто-повтором.

`VerdictScreen`: 4 исхода; `already_checked_in` без auto-return (уже закодировано в K1's `VerdictScreen` — ждёт решения оператора); `checked_in`/`allowed` — auto-return по `verdict_auto_dismiss_sec` события. Кнопка «Печать» на экране ОТМЕЧЕНА рендерится тогда и только тогда, когда `!(verdict === "allowed" && settings.print_on_checkin)` — то есть скрыта именно и только в кейсе, когда авто-принт уже сработал для этого скана (иначе либо `print_on_checkin` выключен и печати ещё не было, либо исход не «отмечена» и кнопки нет вовсе). Нажатие зовёт печать + `markAttendeePrinted` с `printContext` (аудит как reprint — та же семантика, что у panel's `RecentScansRail`'s Reprint).

`RecentLog` (K1, панельный или footer-режим) — **пассивный список**, без Undo/Reprint-кнопок с киоска (соответствует канве K1: лог только для чтения; Undo/Reprint остаются staff-действием в panel на другом устройстве).

## 7. Вход сканирования

Три режима из backend enum `checkin-settings.scan_input`:
- **`scanner`** — поллинг `agent_request` invoke на `POST /scan/consume` каждые 200мс (атомарный read+clear на стороне агента — не текущая рассинхронная связка `/scan/last`+`/scan/clear`, которая теряла скан в гонке read/clear).
- **`wedge`** — скрытый always-focused `<input>`, Enter — граница скана; refocus-эвристика: возвращает фокус через ~50мс после потери, если не «намеренная» цель (текстовый инпут/textarea/select/contenteditable/открытый диалог-меню-listbox).
- **`manual`** — только поиск по имени (`manual_search_enabled` должен быть true; если событие настроено на `manual` без `manual_search_enabled`, UI показывает пустое состояние без входа — граничный случай, редкий, но валиден по схеме).

## 8. Тестирование

Vitest + Testing Library для каждого хука: `useCheckinFlow` (submitCode/submitAttendee state machine, re-entrancy guard, auto-dismiss timer, print-only-on-checked_in), `useScanInput` (три режима, wedge refocus, atomic consume), `useConnectionState` (debounce), `useHeartbeat` (interval lifecycle). Мок агента (`agent --mock`, уже существует) для дев-прогонов/интеграционных тестов. Компонентные тесты для pre-flight шагов и run-экранов через `@testing-library/react` с моками TanStack Query.

## 9. Риски и допущения

- TanStack Query — новая зависимость в `desktop/package.json`; версия синхронизируется с `panel`'s (уже в воркспейсе, конфликтов на уровне peer нет — panel и desktop оба на React 19 после K1).
- Регистрация станции — новый шаг pre-flight; станция без имени невозможна (backend требует `name`, min length 1). Поле остаётся пустым с плейсхолдером-подсказкой (например, «Стойка 1») — кнопка «Продолжить» неактивна, пока оператор не введёт непустое имя (тот же паттерн валидации, что уже в шаге 1 «Подключение»), никакого автогенерируемого значения (hostname и т.п.) не подставляется.
- Переход на `checkin-settings` события означает, что смена режима сканирования на ОДНОЙ станции меняет его для ВСЕХ станций этого события (событийный, не станционный уровень настройки) — это осознанное следствие серверной модели, а не баг; отражает architecture backend, не решение K2a.
- Manual-режим без физического сканера — граничный случай, покрыт enum'ом, но не основной путь; тестируется, но не оптимизируется отдельно.
