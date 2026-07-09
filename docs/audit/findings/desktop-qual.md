# DESKTOP-QUAL — desktop/src/ (Tauri 2 + React 18), КАЧЕСТВО КОДА

Проверено: весь `desktop/src/` (App.tsx, pages/*, components/*, lib/*, i18n.ts) и
весь `desktop/src-tauri/src/` (commands.rs, lib.rs, main.rs). Дополнительно
сопоставлено с `web/src/` для проверки дублирования (lib/api.ts, lib/agent.ts,
utils/markdownTemplate.ts). Первым делом проверено наличие тестов.

## Наличие тестов

`desktop/package.json` не содержит `vitest`/`jest`/`@testing-library/*` ни в
зависимостях, ни в devDependencies, скрипт `test` отсутствует (только `dev`,
`build`, `tauri`, `lint`). В дереве `desktop/src/**` нет ни одного файла
`*.test.*` / `*.spec.*`. В `desktop/src-tauri/src/**` нет ни одного модуля
`#[cfg(test)]`. Тестов нет вообще — см. DESKTOP-QUAL-01.

---

### DESKTOP-QUAL-01: Полное отсутствие автотестов для критичных сценариев
- Файл: desktop/package.json (нет test-раннера), desktop/src/pages/CheckinEvent.tsx, desktop/src/pages/Equipment.tsx, desktop/src-tauri/src/commands.rs
- Описание: В desktop-приложении нет ни одного unit/component-теста (нет vitest/jest/testing-library в package.json, нет файлов `*.test.*`/`*.spec.*`) и ни одного Rust-теста (`#[cfg(test)]`) в src-tauri. Непокрытыми остаются: сканирование QR через камеру и декодирование jsQR (CheckinEvent.tsx:170-204), поиск участника по коду и чек-ин через API (CheckinEvent.tsx:224-291), логика печати бейджа и получение принтера по умолчанию (CheckinEvent.tsx:323-362), управление принтерами/сканерами и тест сканера (Equipment.tsx:78-278), рендеринг markdown-шаблона бейджа (lib/markdownTemplate.ts), сохранение/восстановление настроек чек-ина (lib/checkinSettings.ts) и Tauri-команда прокси к агенту (commands.rs:10-44).
- Влияние: Регрессии в сценарии чек-ина или печати бейджа (самые критичные пути приложения) не будут обнаружены до ручного тестирования на реальном киоске; рефакторинг любого из перечисленных файлов рискован.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Добавить vitest + @testing-library/react для ключевых компонентов (в первую очередь lookupByCode/handleScanCode в CheckinEventPage и парсеры parsePrinters/parseScanners в Equipment.tsx как чистые функции), и минимум smoke-тест на Rust-команду agent_request с моком HTTP-сервера.
- Вердикт: ПОДТВЕРЖДЕНО — подтверждено: нет vitest/jest/testing-library в package.json, нет `*.test.*`/`*.spec.*` в desktop/src, нет `#[cfg(test)]` в src-tauri/src.

### DESKTOP-QUAL-02: CSP жёстко ограничивает backend-хост, конфликтует с UI для смены сервера
- Файл: desktop/src-tauri/tauri.conf.json:12 (`connect-src`), desktop/src/pages/Connection.tsx:26-50, desktop/src/lib/config.ts:1-21
- Описание: `tauri.conf.json` задаёт `connect-src": "'self' ipc: http://ipc.localhost http://localhost:8008 http://127.0.0.1:8008"` — жёстко разрешены только `localhost:8008`/`127.0.0.1:8008`. При этом ConnectionPage (Connection.tsx) и `getBackendUrl()/setBackendUrl()` (config.ts) явно реализуют фичу "указать произвольный URL backend-сервера" и сохраняют его в localStorage, а axios-инстанс (lib/api.ts) на каждый запрос берёт этот URL как baseURL. Ни один из этих файлов не согласован с CSP.
- Влияние: В собранном (production) приложении при указании любого backend-хоста, отличного от localhost:8008/127.0.0.1:8008 (типичный кейс — сервер в локальной сети для реального киоска на другой машине), все XHR/fetch-запросы будут заблокированы CSP webview, и приложение станет полностью нефункциональным (логин, чек-ин, печать) без внятной диагностики для пользователя.
- Серьёзность: High
- Уверенность: средняя
- Рекомендация: Либо генерировать `connect-src` динамически/шире (например, разрешить произвольный HTTPS/HTTP хост, вводимый пользователем, через `dangerousDisableAssetCspModification`/`csp: null` с собственной валидацией), либо на UI-уровне явно ограничить ConnectionPage только теми хостами, что разрешены в CSP, и показать понятную ошибку при попытке сохранить недопустимый URL.
- Вердикт: ЧАСТИЧНО — суть подтверждена (то же, что DESKTOP-BUG-01/DESKTOP-SEC-05), но строка указана неверно: `connect-src` в tauri.conf.json находится на строке 18, а не 12 (строка 12 — это `"app": {`).

### DESKTOP-QUAL-03: CheckinEvent.tsx — компонент на 582 строки со смешением ответственностей
- Файл: desktop/src/pages/CheckinEvent.tsx:1-583
- Описание: Единственный компонент `CheckinEventPage` совмещает: получение события/участников через API, работу с камерой и декодирование QR (jsQR), polling сканера через Tauri-агент, бизнес-логику чек-ина (lookupByCode/handleScanCode), логику печати бейджа, Tauri-специфичный вызов `getCurrentWindow()/setFullscreen()`, "секретный" жест по заголовку (5 тапов) для навигации, и всю разметку UI для 5 разных состояний экрана. Превышает порог 400 строк.
- Влияние: Высокая связность затрудняет модификацию (например, изменение логики печати требует понимания камеры/сканера/state-машины результата) и повышает риск регрессий при отсутствии тестов (см. DESKTOP-QUAL-01).
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Вынести в отдельные хуки: `useQrCameraScanner`, `useScannerPolling`, `useCheckinFlow` (lookup + API + print), а Tauri-вызов fullscreen — в `lib/window.ts`; компонент оставить только для композиции UI.
- Вердикт: ПОДТВЕРЖДЕНО — файл действительно 582 строки (заявлено 1-583, расхождение на 1 строку несущественно) и смешивает камеру/сканер/чек-ин/печать/fullscreen/UI, как описано.

### DESKTOP-QUAL-04: Equipment.tsx — компонент на 576 строк со смешением ответственностей
- Файл: desktop/src/pages/Equipment.tsx:1-577
- Описание: Один компонент `EquipmentPage` содержит: загрузку принтеров/сканеров/портов/принтера-по-умолчанию через агента (fetchEquipmentData/refresh), CRUD сетевых принтеров и COM-сканеров, управление настройками чек-ина (persistCheckinSettings), полноценный "мастер" теста сканера с генерацией QR и polling (startScannerTest/endScannerTest) и всю разметку 4 карточек UI. Превышает порог 400 строк.
- Влияние: Аналогично DESKTOP-QUAL-03 — сложность сопровождения и повышенный риск регрессий без тестов.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Разбить на подкомпоненты `PrintersCard`, `ScannersCard`, `CheckinSettingsCard`, `ScannerTestCard` и вынести data-fetching в хук `useEquipmentData()`.
- Вердикт: ПОДТВЕРЖДЕНО — файл 576 строк (заявлено 1-577, расхождение на 1 строку несущественно) и содержит принтеры/сканеры/настройки чекина/тест сканера/UI в одном компоненте, как описано.

### DESKTOP-QUAL-05: Дублирование бизнес-логики между desktop и web без переиспользования
- Файл: desktop/src/lib/api.ts:1-43 (ср. web/src/lib/api.ts:1-45), desktop/src/lib/markdownTemplate.ts:1-32 (ср. web/src/utils/markdownTemplate.ts:1-75)
- Описание: `lib/api.ts` — axios-инстанс с request/response-интерцепторами (Bearer-токен, обработка 401, редирект на /login) скопирован в desktop и web как отдельные независимые реализации (разный список исключаемых путей при редиректе, разный набор localStorage-ключей). `lib/markdownTemplate.ts` — функция `renderMarkdownTemplate`/`getDefaultAttendeeTemplate` продублирована почти дословно, но с разошедшимся поведением: desktop-версия экранирует спецсимволы regex в имени поля (`escapeRegExp`, markdownTemplate.ts:4-6, 19), web-версия — нет (web/src/utils/markdownTemplate.ts:16). Общего пакета/модуля нет.
- Влияние: Исправление бага в одной копии (например, в обработке 401 или экранировании regex) не попадает в другую; поведение рендера шаблона бейджа уже разошлось между платформами для полей с спецсимволами в имени.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Пометить как известный дубль (без крупного рефакторинга в рамках этой задачи); при следующей правке любой из двух копий — переносить фикс в обе, либо начать выделение общего пакета `packages/shared` для api-клиента и утилит шаблонов.
- Вердикт: ЧАСТИЧНО — дублирование и расхождение поведения `markdownTemplate.ts` (desktop экранирует regex через `escapeRegExp`, web — нет, `web/src/utils/markdownTemplate.ts:16`) подтверждены; однако утверждение о «разном наборе localStorage-ключей» в api.ts неверно — оба файла используют идентичный набор `token/user/tenants/current_tenant`, различается только список исключаемых при редиректе путей (`/register` есть в web, нет в desktop).

### DESKTOP-QUAL-06: Порт агента (12345) захардкожен независимо в трёх местах
- Файл: desktop/src-tauri/src/commands.rs:5-6, desktop/src/lib/agent.ts:6, desktop/src/i18n.ts:47,171
- Описание: Значение `12345` определено как константа в Rust (`AGENT_PORT`/`AGENT_PORT_STR`, commands.rs:5-6) и отдельно — как часть строки `FALLBACK_AGENT_URL` в TS (agent.ts:6), а также упоминается в переводах i18n (i18n.ts:47 en, i18n.ts:171 ru) как текст для пользователя. Общего источника правды нет.
- Влияние: Изменение порта агента требует правки минимум в 3 файлах на 2 языках; при рассинхронизации fallback-URL в браузерном dev-режиме перестанет совпадать с реальным портом sidecar-процесса.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Вынести порт в единственную Rust-константу и передавать его во фронтенд через Tauri-команду `get_agent_port()` (уже существует, commands.rs:46-49) вместо повторного захардкоживания в agent.ts; в i18n-строках использовать интерполяцию `{{port}}` вместо литерала.
- Вердикт: ПОДТВЕРЖДЕНО — точные совпадения: `commands.rs:5-6` (AGENT_PORT/AGENT_PORT_STR), `agent.ts:6` (FALLBACK_AGENT_URL), `i18n.ts:47` (en) и `:171` (ru) — везде литерал "12345".

### DESKTOP-QUAL-07: Несогласованная обработка ошибок по всему приложению
- Файл: desktop/src/pages/CheckinEvent.tsx:217-219,336-338, desktop/src/pages/Equipment.tsx:89-91,96-98,233-236,253-255, desktop/src/pages/Login.tsx:41-46, desktop/src/pages/QRLogin.tsx:34-39, desktop/src-tauri/src/commands.rs:15-44
- Описание: Ошибки обрабатываются несколькими несовместимыми способами без единого подхода: тихое поглощение (`catch { /* ignore */ }` — 6+ мест), `toast.error` с сообщением пользователю, `console.error` без уведомления (CheckinEvent.tsx:357), и дублированный ad-hoc код извлечения сообщения из axios-ошибки (одинаковый паттерн `err && typeof err === "object" && "response" in err ? ... : undefined` продублирован в Login.tsx:42-45 и QRLogin.tsx:35-38 с разными полями `error`/`message`). На Rust-стороне `agent_request` (commands.rs) все виды ошибок (сетевые, HTTP-статус, неизвестный метод) сворачиваются в единую строку через `.map_err(|e| e.to_string())`, из-за чего фронтенд не может различить причину сбоя иначе как по содержимому текста.
- Влияние: Пользователь получает противоречивый опыт (одни ошибки показываются, другие — нет), а разработчик не может надёжно различать типы ошибок агента на фронтенде; дублирование кода извлечения сообщений увеличивает риск рассинхронизации при правках.
- Серьёзность: Low
- Уверенность: средняя
- Рекомендация: Ввести общий хелпер `extractApiErrorMessage(err)` в lib/ и использовать его во всех страницах; для команды `agent_request` возвращать структурированную ошибку (enum/JSON с кодом причины) вместо голой строки.
- Вердикт: ЧАСТИЧНО — большинство цитат точны (silent catch в CheckinEvent.tsx:217-219/336-338 и Equipment.tsx:89-91/96-98/233-236/253-255, дублированный ad-hoc парсинг axios-ошибки в Login.tsx:42-45 vs QRLogin.tsx:35-38 с разными полями `error`/`message`, commands.rs сворачивает все ошибки в строку); но пример «console.error без уведомления» на CheckinEvent.tsx:357 некорректен — на следующей строке 358 того же catch-блока вызывается `toast.error(t("printFailed"))`, то есть уведомление пользователю есть.

### DESKTOP-QUAL-08: Отсутствует конфигурация ESLint — скрипт `lint` в desktop нерабочий
- Файл: desktop/package.json:7 (`"lint": "eslint ."`), нет desktop/eslint.config.*
- Описание: `desktop/package.json` объявляет devDependency `eslint@^9.15.0` и скрипт `lint`, но в каталоге `desktop/` нет файла `eslint.config.js/mjs/ts` (flat config, обязателен для ESLint 9) и нет legacy `.eslintrc*`. Для сравнения — в `web/` есть `web/eslint.config.js`. Без конфигурации `npm run lint` в desktop завершится ошибкой "could not find config file" и не выполнит ни одной проверки.
- Влияние: В desktop нет работающего статического анализа кода — потенциальные баги (неиспользуемые переменные, hooks-правила React, и т.д.) не отлавливаются автоматически, в отличие от web.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Скопировать/адаптировать `web/eslint.config.js` под desktop (react-hooks, @typescript-eslint) и подключить в CI.
- Вердикт: ПОДТВЕРЖДЕНО — `desktop/package.json` содержит `eslint@^9.15.0` и скрипт `lint`, но в `desktop/` нет ни flat-config, ни legacy `.eslintrc*`, тогда как `web/eslint.config.js` существует.

### DESKTOP-QUAL-09: Мёртвый код — присвоение `api.defaults.baseURL` не имеет эффекта
- Файл: desktop/src/pages/Connection.tsx:45-50, desktop/src/lib/api.ts:17-24
- Описание: `save()` в Connection.tsx выполняет `setBackendUrl(normalizedBase)` (запись в localStorage), а следом — `api.defaults.baseURL = normalizedBase`. Однако request-интерцептор в lib/api.ts (строка 18) на **каждый** запрос безусловно перезаписывает `config.baseURL = getBackendUrl()`, то есть значение `api.defaults.baseURL` полностью игнорируется реальным запросом. Строка `api.defaults.baseURL = normalizedBase` не влияет ни на одно последующее обращение к API.
- Влияние: Не является багом (переключение сервера работает благодаря localStorage+интерцептору), но вводит в заблуждение читающего код, создавая иллюзию, что мутация `defaults.baseURL` нужна.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Удалить строку `api.defaults.baseURL = normalizedBase;` в Connection.tsx:48 — она избыточна, т.к. интерцептор уже читает актуальный URL из localStorage при каждом запросе.
- Вердикт: ПОДТВЕРЖДЕНО — точное совпадение строк: `Connection.tsx:48` и request-интерцептор `api.ts:18` (`config.baseURL = getBackendUrl();`), который безусловно перезаписывает baseURL на каждый запрос.

## Итог

Записано находок: 9. Разбивка: High — 1, Medium — 0, Low — 8.
