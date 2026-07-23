# Kiosk K2b — Self-Service Implementation — Design

**Дата:** 2026-07-22
**Статус:** утверждён
**Родитель:** `docs/superpowers/specs/2026-07-21-kiosk-desktop-v2-design.md` (K2 — desktop/src rewrite). K2 декомпозирован на K2a (staffed-run, **смержено**) и K2b (этот документ — self-service).

## 1. Цель и объём

Реализовать self-service режим станции: attract-экран ожидания, необслуживаемый check-in loop (только `wedge`/`scanner`, без ручного ввода), приватные вердикты, полный lockdown окна приложения, выход из lockdown по staff-QR. Родительский spec (`kiosk-desktop-v2-design.md` §17, §64-66) уже набросал контуры — этот документ уточняет их относительно того, что реально смержено в K1/K2a/K3a/K3b, и относительно реальной структуры роутинга/данных, сложившейся в K2a (а не гипотетической из родительского наброска).

**Отклонение от родительского наброска:** родительский spec описывал единый верхнеуровневый роут `/self`. К2a на практике вложил весь check-in flow под `/checkin/:eventId/...` (Equipment/Mode/Run). K2b следует уже сложившейся конвенции: новый роут `/checkin/:eventId/self` → `desktop/src/pages/SelfService.tsx` (export `SelfServicePage`, тот же паттерн, что `ModePage`/`RunPage`), а не отдельное верхнеуровневое дерево — меньше расхождений в структуре приложения, тот же `ProtectedRoute`-гейт, что у остальных экранов после логина.

**Вне объёма K2b** (сознательно, не по недосмотру):
- per-event брендинг attract-экрана сверх tenant-уровневого `logo_url` — если понадобится, отдельное решение;
- камера как источник скана (backend enum `scan_input` по-прежнему без `camera`, тот же K2a-й пограничный случай);
- добавление `current_tenant` в ответ `/auth/login-qr` для полного паритета с `/auth/login` — обходится graceful degradation на клиенте (см. §3), backend не трогаем;
- Pi-специфичная тонкая настройка touch-инпута сверх уже существующих K1-брейкпоинтов;
- desktop e2e-тесты (тот же открытый follow-up, что и с K2a).

## 2. Pre-flight: выбор типа станции (шаг Mode)

`ModePage` (`desktop/src/pages/Mode.tsx`) получает новый переключатель **«Тип станции: Staffed / Self-service»**, локальный выбор станции (localStorage, как выбор компоновки run-экрана сейчас) — не серверная настройка.

При выборе **Self-service**:
- скрывается выбор компоновки run-экрана (`bar`/`panel` — staffed-only, self-service всегда attract-loop);
- из опций `scan_input` убирается `manual` (self-service допускает только `wedge`/`scanner` — необслуживаемый ручной ввод кода на закрытом киоске не поддерживается, риск опечаток/подбора чужих кодов без реальной пользы для большинства событий, где у гостя есть штрих-код/QR в билете);
- кнопка «Сохранить и начать» ведёт на `/checkin/:eventId/self` вместо `/checkin/:eventId`.

Если событие уже сохраняло `scan_input: "manual"` (настроено ранее для staffed-режима на этой же станции/событии) и оператор переключается на Self-service — форма принудительно переставляет `scan_input` на `wedge` (дефолт) при переключении типа станции, не оставляя невалидную для self-service комбинацию невидимо сохранённой.

## 3. Attract-экран

Новый компонент `AttractScreen.tsx` (`desktop/src/components/` или `desktop/src/features/self-service/`, решится на этапе плана), собран из уже существующих примитивов `@idento/ui/kiosk`:
- `BrandSlot` (380×130) — логотип организации;
- `LanguageToggle` — единственная интерактивная зона экрана (переключение EN/RU);
- медленный дрейф позиции (transform, ~60с цикл) для защиты от выгорания экрана.

**Источник логотипа**: `current_tenant.logo_url` из `localStorage` (уже кешируется после `/auth/login` — `Login.tsx` сохраняет весь `current_tenant`, включающий `logo_url`, без единого нового сетевого вызова). Известный пробел: `/auth/login-qr` (`QRLogin.tsx`) не возвращает `current_tenant` вовсе (только `token`+`user`) — если станция была настроена через QR-вход, `logo_url` в кеше не будет. Это обрабатывается graceful degradation на клиенте: `BrandSlot` рендерится пустым/без лого, а не падает и не блокирует attract-экран. Backend/`QRLogin.tsx` не меняем (см. §1).

Attract-экран показывается, когда self-service loop простаивает (нет активного скана, не показан вердикт) — это `attract`-состояние `useSelfServiceFlow` (§4).

## 4. Self-service check-in loop

Новый хук `useSelfServiceFlow` (`desktop/src/features/self-service/useSelfServiceFlow.ts`), по форме смоделирован на K2a-шном `useCheckinFlow`, но отдельная реализация — переиспользует напрямую уже существующие мутации `useSubmitCode`/`useSubmitAttendee` из `desktop/src/features/checkin/hooks.ts` (сам API check-in — `POST .../checkin` — режимо-агностичен, различается только вокруг него UI/переходы).

Состояния: `attract` → `scanning` (код захвачен сканером, запрос в полёте) → `verdict` (результат) → авто-таймер (`verdict_auto_dismiss_sec` из `checkin-settings` события, как в staffed-режиме) → назад в `attract`.

- Вход скана — переиспользуется существующий `useScanInput` из K2a, ограниченный на этапе Mode до `wedge`/`scanner` (без `manual`-ветки в self-service UI вообще — компонент её не рендерит).
- Вердикт — `VerdictScreen` из `@idento/ui/kiosk` с `privacy={true}` (уже реализован в K1, ранее не используемый десктопом). Все 4 исхода (`allowed`/`already_checked_in`/`not_registered`/`no_access`) уже корректно рендерятся в privacy-режиме (иконка+имя(если есть)+опциональное сообщение+auto-return) — новой вёрстки не требуется, только подключение реальных данных.
- Нет ручного поиска, нет `RecentLog`/`OperatorPanel`, нет кнопки печати-с-подтверждением/повторной печати — некому на них нажимать. Печать (если `print_on_checkin` включён в `checkin-settings` события) происходит автоматически при `allowed`, как и в staffed-режиме.
- Деградация оборудования (принтер не готов, сканер отключён, агент недоступен) переиспользует стиль `BlockingBanner`, но **без кнопки повтора** — просто сообщение ожидания; снимается автоматически, когда `useAgentSupervisor`'s health-поллинг восстанавливается (та же эскалационная модель K1's `stationLevel()`, что и в staffed-режиме).

## 5. Lockdown окна (Tauri)

Новые Rust-команды `enter_lockdown`/`exit_lockdown` в `desktop/src-tauri/src/commands.rs`, по образцу существующих `spawn_agent`(K3a)/`check_for_update`(K3b) — обычные `#[tauri::command]` без новых плагинов. Технически подтверждено достаточным (сверено с вендоренным `tauri-2.11.5` source, не предположение): `WebviewWindow::set_fullscreen(true)`, `set_decorations(false)`, `set_always_on_top(true)`, `set_skip_taskbar(true)`, плюс перехват `WindowEvent::CloseRequested` через `on_window_event` с вызовом `CloseRequestApi::prevent_close()` — блокирует закрытие окна на уровне события, а не просто отключает кнопку (у `set_closable` есть платформенная оговорка на Linux — "GTK+ will do its best", не гарантия).

- `enter_lockdown` вызывается один раз при монтировании `SelfServicePage` (boot-эффект, тот же паттерн, что `AgentLifecycle`).
- Локдаун держится весь цикл attract/scanning/verdict — выйти можно только через staff-QR (§6).
- `exit_lockdown` реверсирует всё (`set_fullscreen(false)`, `set_decorations(true)`, `set_always_on_top(false)`, `set_skip_taskbar(false)`, снятие перехвата close) — вызывается только после успешной staff-QR проверки.

## 6. Выход по staff-QR

Триггер выхода — некрупная, малозаметная область на attract-экране (точное расположение — деталь этапа плана, не spec-решение). Открывает оверлей ввода QR-кода. Оверлей доступен из **любого** состояния self-service loop (`attract`, `scanning`, `verdict`), а не только из `attract` — реальная аппаратная проблема не должна ждать, пока истечёт auto-таймер текущего вердикта, прежде чем персонал сможет вмешаться.

Поток: оверлей собирает QR-токен (тем же способом ввода, что сейчас `QRLogin.tsx` — сканером или вручную) → вызывает существующий `POST /auth/login-qr` (новый backend-код не нужен) → при успехе: `exit_lockdown` + переход на `/checkin/:eventId/mode` (персонал возвращается на тот же шаг Mode — может переключиться обратно на staffed или перенастроить) → при ошибке: инлайн-сообщение, локдаун остаётся, без счётчика попыток/блокировки (тот же паттерн, что уже у `QRLogin.tsx` сегодня — новой логики троттлинга не вводим).

## 7. Тестирование

Vitest + Testing Library, по аналогии с K2a:
- `useSelfServiceFlow` — переходы состояний, привязка к существующим `useSubmitCode`/`useSubmitAttendee`, auto-return таймер.
- `AttractScreen` — рендер с/без `logo_url`, дрейф-анимация (снапшот трансформа, не таймер в реальном времени).
- Staff-QR оверлей — успех/ошибка `/auth/login-qr`, доступность из всех 3 состояний loop.
- Rust: `enter_lockdown`/`exit_lockdown` — по образцу существующих unit-тестов `commands.rs` там, где это тестируемо без живого `AppHandle` (вероятно, минимально — большая часть проверяется вручную на реальном устройстве, тот же класс ограничения, что уже отмечен для K3a's sidecar lifecycle и K3b's update lifecycle).
- Ручная проверка на реальном устройстве остаётся открытым пунктом (см. §8) — тот же паттерн, что у K3a/K3b.

## 8. Риски и допущения

- **Lockdown никогда не проверялся на реальном железе** (macOS/Windows/Linux/Pi) — код и API вызовы сверены с вендоренным Tauri source, но фактическое поведение (особенно Linux-оговорка у `set_closable`, поведение `always_on_top` под разными оконными менеджерами) не эмпирически подтверждено в этой среде. Тот же класс открытого пункта, что уже отмечен для K3a (sidecar на реальном systemd) и K3b (реальный `desktop-v*` dry-run) — будет явно отмечено при финальном ревью, не тихо предполагается рабочим.
- QR-логин без `current_tenant` в ответе — существующее (не K2b-шное) расхождение между `/auth/login` и `/auth/login-qr`; K2b обходит его graceful degradation, не чинит backend.
- Переключение типа станции (Staffed↔Self-service) — чисто локальный, станционный выбор; не влияет на `checkin-settings` события (общие для всех станций), кроме принудительного сброса `scan_input` с `manual` при переключении на Self-service (§2).
- Self-service предполагает, что у гостя есть физический считываемый код (штрих-код/QR в билете) — событие без printed/digital кода с кодом, годным для `wedge`/`scanner`, не сможет использовать self-service вообще (не новое ограничение K2b, а следствие уже принятого решения не поддерживать `manual` здесь).
