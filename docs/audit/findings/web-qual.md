# WEB-QUAL — web/src/ (React 18 + Vite), КАЧЕСТВО КОДА

Проверено перед аудитом: поиск `*.test.tsx` / `*.spec.ts` / `*.test.ts` по всему
`web/src` — совпадений нет (0 файлов). `web/package.json` не содержит ни одного
тестового инструмента (нет `vitest`, `@testing-library/*`, `jest`) и скрипт
`test` в `scripts` отсутствует (`dev`, `build`, `lint`, `lint:fix`, `preview`).
Т.е. тестовая инфраструктура для веб-приложения отсутствует полностью — это
учтено в WEB-QUAL-01 ниже и напрямую влияет на серьёзность остальных находок
(логические баги вроде WEB-QUAL-05/06 не могли быть пойманы регрессионным
тестом, потому что тестов нет вообще).

### WEB-QUAL-01: Полное отсутствие тестового покрытия веб-приложения
- Файл: web/package.json (весь), web/src/ (весь, 74 файла .ts/.tsx)
- Описание: Ни одного `*.test.tsx`/`*.test.ts`/`*.spec.*` файла в проекте. В
  `devDependencies` нет `vitest`, `@testing-library/react`, `jsdom` и т.п.
  Критичные непокрытые места: чек-ин участника и печать бейджа
  (`web/src/pages/CheckinFullscreen.tsx`, `handleCheckin`/`printBadge`),
  генерация ZPL (`web/src/utils/zpl.ts`, `web/src/utils/zpl-image-text.ts`),
  редактор шаблонов бейджей (`web/src/pages/BadgeTemplateEditorV2.tsx`),
  импорт CSV участников (`web/src/components/CSVImportEnhanced.tsx`),
  auth-интерцептор и разлогин по 401 (`web/src/lib/api.ts`), форматирование
  дат/шаблонов бейджа (`web/src/utils/dateFormat.ts`,
  `web/src/utils/markdownTemplate.ts`).
- Влияние: Регрессии в ключевых сценариях (чек-ин, печать бейджа, импорт
  участников, логин/логаут по истечению токена) не будут пойманы
  автоматически — только вручную или пользователями в проде. Ниже в этом же
  отчёте есть минимум два подтверждённых функциональных бага (WEB-QUAL-05,
  WEB-QUAL-06) в непокрытом тестами check-in flow.
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Подключить `vitest` + `@testing-library/react`, начать с
  unit-тестов на чистые функции (`utils/zpl.ts`, `utils/dateFormat.ts`,
  `utils/markdownTemplate.ts`) и с интеграционных тестов на
  `CheckinFullscreen.tsx` (поиск/чек-ин/печать) как самый критичный флоу.

### WEB-QUAL-02: Настройка check-in киоска для конкретного события не долетает до CheckinFullscreen
- Файл: web/src/pages/event/EventCheckin.tsx:13 (`navigate(\`/checkin-fullscreen?event=${eventId}\`)`); web/src/pages/CheckinFullscreen.tsx:83-87, 244-254
- Описание: Кнопка «Fullscreen Checkin» на странице события передаёт
  `eventId` через query-параметр `?event=`. Однако `CheckinFullscreenPage`
  (файл `CheckinFullscreen.tsx`) нигде не читает `useSearchParams`/
  `location.search` (grep по файлу подтверждает отсутствие любого чтения
  query-параметров) — вместо этого при монтировании вызывается
  `fetchUserEvents()` (строка 244), который берёт `/api/events` и
  автоматически выбирает `response.data[0]`, т.е. первое событие в списке
  пользователя, независимо от того, из какого события был клик.
- Влияние: Если у организации/пользователя больше одного активного события,
  переход «Launch fullscreen checkin» из карточки конкретного события
  открывает check-in экран для СОВЕРШЕННО ДРУГОГО события (первого в списке).
  Сотрудник может отмечать чек-ины и печатать бейджи не в том мероприятии —
  это напрямую ломает ключевой сценарий «чек-ин».
- Серьёзность: High
- Уверенность: высокая
- Рекомендация: В `CheckinFullscreenPage` читать `event` из `useSearchParams()`
  и, если он присутствует и валиден, выбирать это событие как
  `selectedEvent` вместо `events[0]`.

### WEB-QUAL-03: «Поле типа бейджа» — два независимых несинхронизированных источника правды
- Файл: web/src/pages/event/EventSettings.tsx:44,65,104 (сохраняется в `event.custom_fields.badgeTypeField` через API); web/src/pages/CheckinFullscreen.tsx:72,138-151,153-177 (хранится отдельно в `localStorage["checkin_settings"].badgeTypeField`)
- Описание: `EventSettings.tsx` даёт админу настроить «Badge Type Field» —
  поле участника, которое должно крупно показываться при чек-ине
  (`i18n.ts:256-257`: «Choose which field... should be displayed as the badge
  type/category during check-in», сохраняется на бэкенд per-event). Но
  `CheckinFullscreen.tsx` использует СОВСЕМ ДРУГОЕ состояние `badgeTypeField`
  — грузится/сохраняется только в `localStorage` браузера ключом
  `checkin_settings` (строки 138-151, 153-177) и никогда не читает
  `event.custom_fields.badgeTypeField`. Описание в `i18n.ts:196-197`
  («This field will be displayed prominently when a participant checks in»)
  описывает ровно ту же задачу, что и настройка в Event Settings.
- Влияние: Настройка «Тип бейджа», сделанная админом в Event Settings (и
  ожидаемо синхронная для всех сотрудников/киосков), не влияет на реальный
  check-in экран. Каждый браузер/киоск должен настраивать это поле заново
  локально, разные киоски одного события могут показывать разные поля как
  «тип бейджа» — путаница на входе на мероприятие.
- Серьёзность: High
- Уверенность: высокая
- Рекомендация: Убрать дублирующее локальное состояние в
  `CheckinFullscreen.tsx`, читать `badgeTypeField` из `event.custom_fields`
  (как это уже делает `EventSettings.tsx`), либо явно развести две настройки
  по смыслу и переименовать/задокументировать разницу.

### WEB-QUAL-04: Восстановление сетевых принтеров из localStorage не срабатывает из-за устаревшего замыкания state
- Файл: web/src/pages/EquipmentSettings.tsx:109-114 (`useEffect`), 116-137 (`loadSavedNetworkPrinters`)
- Описание: В `useEffect` при монтировании одновременно вызываются
  `checkAgentStatus()` и `loadSavedNetworkPrinters()`. `checkAgentStatus`
  асинхронно обновляет state `agentStatus` на `"connected"` при удачном
  health-check. Но `loadSavedNetworkPrinters` в этот же тик читает `agentStatus`
  из замыкания эффекта — там ещё исходное значение `"disconnected"` (см.
  инициализацию `useState<...>("disconnected")` на строке 59-61), так как
  `checkAgentStatus` не успевает завершиться и обновить state до того, как
  выполнится условие `savedPrinters.length > 0 && agentStatus === "connected"`
  (строка 121). Условие всегда `false` при обычной загрузке страницы.
- Влияние: Сетевые принтеры, ранее добавленные и сохранённые в
  `localStorage["network_printers"]`, никогда не восстанавливаются в
  print-агенте после перезапуска агента/обновления страницы — агент не помнит
  их сам (комментарий в коде: «Save to localStorage for persistence»). Принтер
  пропадает из списка доступных, пока пользователь не добавит его вручную
  заново — рабочий процесс печати бейджей ломается без явной причины для
  пользователя.
- Серьёзность: Medium
- Уверенность: средняя (логика подтверждена чтением кода; не проверялось раннтайм-поведение агента)
- Рекомендация: Перестроить эффект — вызывать `loadSavedNetworkPrinters()`
  из колбэка/промиса `checkAgentStatus()` после реального подтверждения
  `"connected"`, либо убрать проверку `agentStatus` и просто пытаться
  восстановить принтеры, обрабатывая ошибку сети как no-op.

### WEB-QUAL-05: Логика выбора принтера по умолчанию продублирована в трёх местах с разным порядком приоритетов
- Файл: web/src/pages/BadgeTemplateEditorV2.tsx:249-278 (`loadFonts`); web/src/pages/EquipmentSettings.tsx:149-171 (`fetchPrinters`); web/src/pages/CheckinFullscreen.tsx:179-212 (`checkAgent`)
- Описание: Все три компонента независимо реализуют «получить список
  принтеров у агента → получить дефолтный принтер → выбрать начальный».
  Реализации разошлись: `CheckinFullscreen.checkAgent` учитывает три
  приоритета (agent default → `checkin_settings` из localStorage → первый в
  списке), `EquipmentSettings.fetchPrinters` и
  `BadgeTemplateEditorV2` — только два (agent default → первый в списке).
  Общего хука/сервиса (`usePrinterSelection` и т.п.) нет.
- Влияние: Поведение выбора «активного» принтера отличается в зависимости от
  того, какая страница открыта, что уже видно по разнице в приоритетах.
  Любое будущее исправление (например, добавление ещё одного источника
  приоритета) нужно вносить в трёх местах, легко забыть одно из них.
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Вынести общую логику выбора принтера в
  `web/src/lib/agent.ts` или отдельный хук `usePrinterSelection()` и
  переиспользовать во всех трёх местах.

### WEB-QUAL-06: BadgeTemplateEditorV2.tsx — компонент на 1135 строк со смешанными ответственностями
- Файл: web/src/pages/BadgeTemplateEditorV2.tsx:1-1135
- Описание: Один файл/компонент одновременно отвечает за: загрузку и
  сохранение шаблона бейджа через API (`loadEventAndTemplate`, `handleSave`),
  канву редактора на Konva с ручным рендерингом 5 типов элементов
  (`text`/`qrcode`/`barcode`/`line`/`box`, строки 394-516 — почти identical
  копипаст блоков `Rect` с небольшими отличиями), drag&drop-логику
  (`handleDragEnd`), генерацию и предпросмотр ZPL (`previewZPL`, `copyZPL`),
  работу с принтером/шрифтами через agent API (`loadFonts`,
  `queryPrinterFonts`) и три встроенных модальных диалога, свёрстанных вручную
  через `fixed inset-0` (строки 1012-1132) вместо переиспользуемого `Dialog`
  компонента, который используется в остальном приложении (`@/components/ui/dialog`).
- Влияние: Компонент трудно тестировать и менять — любое изменение бизнес-
  логики (сохранение, работа со шрифтами) требует навигации по 1000+ строкам
  вперемешку с JSX канвы. Ручные модалки (`fixed inset-0 bg-black/50`) не
  переиспользуют доступность/фокус-трапы существующего `Dialog`, что создаёт
  двойной стандарт UI в одном файле.
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Разбить на: `useBadgeTemplate(eventId)` (загрузка/сохранение),
  `BadgeCanvas` (рендер Konva-элементов), `useAgentFonts`/`usePrinterQuery`
  (работа со шрифтами/принтером), и заменить самодельные модалки на
  `@/components/ui/dialog`.

### WEB-QUAL-07: EquipmentSettings.tsx — компонент на 1002 строки, объединяющий принтеры, сканеры, камеру и COM-порты
- Файл: web/src/pages/EquipmentSettings.tsx:1-1003
- Описание: Один компонент содержит: управление системными/сетевыми
  принтерами (CRUD, тестовая печать), управление camera-permission API,
  управление USB/COM сканерами (список портов, добавление/удаление),
  polling-тест сканера через `setInterval` (`startScannerTest`,
  строки 358-412) и два модальных диалога. Прямой доступ к `localStorage`
  (`"network_printers"`) разбросан по трём функциям (строки 118-137, 250-257,
  283-289) вместо единого стора.
- Влияние: Компонент сложно поддерживать и покрывать тестами: изменение
  логики сканеров рискует случайно задеть логику принтеров в одном и том же
  файле; дублирование чтения/записи `localStorage` уже привело к багу
  WEB-QUAL-04.
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Выделить `usePrinters()`, `useScannerPorts()`,
  `useScannerTest()` хуки и модуль `networkPrintersStore.ts` для
  инкапсуляции работы с `localStorage`.

### WEB-QUAL-08: Дублирование ~110 строк JSX между диалогами создания и редактирования зоны
- Файл: web/src/pages/event/EventZones.tsx:356-467 (Create Zone Dialog), 470-581 (Edit Zone Dialog)
- Описание: Диалоги создания и редактирования зоны содержат почти идентичную
  разметку полей формы (`name`, `zone_type`, `open_time`, `close_time`,
  `is_registration_zone`, `requires_registration`, `is_active`) — единственная
  разница: префикс `id`/`edit_` и текст заголовка/кнопки. Общий компонент
  формы не выделен.
- Влияние: Любое изменение набора полей формы зоны нужно вносить в двух
  местах; несовпадение уже частично видно — например, отсутствие общей
  валидации между обеими копиями.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Выделить `<ZoneFormFields formData={} onChange={} idPrefix?=/>`
  и переиспользовать в обоих диалогах (или использовать один диалог с флагом
  `mode: 'create' | 'edit'`).

### WEB-QUAL-09: Ключи localStorage и парсинг auth-данных продублированы без единого модуля
- Файл: web/src/App.tsx:32,38; web/src/components/Layout.tsx:31-39; web/src/components/OrganizationSwitcher.tsx:40-68; web/src/lib/api.ts:15,28-31; web/src/pages/Login.tsx:56-67; web/src/pages/OrganizationSettings.tsx:34,67; web/src/pages/QRLogin.tsx:31-32; web/src/pages/Register.tsx:36-44; web/src/pages/super-admin/SuperAdminLayout.tsx:22-28
- Описание: Строковые ключи `"token"`, `"user"`, `"tenants"`,
  `"current_tenant"` захардкожены как литералы минимум в 9 файлах, каждый раз
  с собственным `JSON.parse(localStorage.getItem(...) || '{}'/'null')` без
  единой типизации результата (везде — `any`/неявный `any` через
  `JSON.parse`). Общего модуля `session.ts`/`authStorage.ts` нет.
- Влияние: Опечатка в одном из мест (например, `'current-tenant'` вместо
  `'current_tenant'`) не будет поймана компилятором и тихо сломает логику
  переключения организации только в одном месте кода. Именно такое
  дублирование уже видно в `lib/api.ts` (очистка 4 ключей при 401) — список
  ключей там нужно синхронно поддерживать в актуальном состоянии с местами
  записи, что легко упустить при добавлении новых полей сессии.
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Создать `web/src/lib/session.ts` с типизированными
  `getToken()/setToken()/getUser()/setUser()/getCurrentTenant()/clearSession()`
  и константами ключей, использовать везде вместо прямых обращений к
  `localStorage`.

### WEB-QUAL-10: Несогласованная обработка подтверждения удаления — нативный `confirm()` vs кастомный Dialog
- Файл: web/src/components/FontManager.tsx:102; web/src/components/APIKeysManager.tsx:85; web/src/pages/event/EventAttendees.tsx:146,215,227; web/src/pages/event/EventStaff.tsx:38 (используют `window.confirm(...)`); в противовес web/src/pages/event/EventZones.tsx:584-601 и web/src/pages/EquipmentSettings.tsx:971-999 (используют `@/components/ui/dialog` для того же типа действия — подтверждение удаления)
- Описание: Для однотипных деструктивных действий (удаление/отзыв/блокировка)
  в одном и том же приложении используются два разных UX-паттерна:
  блокирующий нативный `window.confirm()` (нестилизуемый, не локализуется
  дизайн-системой, блокирует JS event loop) и кастомный `Dialog` с явными
  кнопками «Отмена»/«Удалить».
  EventAttendees.tsx — единственный файл, где для удаления и разблокировки
  участника выбран `confirm()`, хотя рядом (`EventZones.tsx`) для того же
  типа операции (удаление сущности того же события) используется `Dialog`.
- Влияние: Непоследовательный UX и невозможность полноценно стилизовать/
  тестировать (E2E-тесты нативных confirm-диалогов сложнее автоматизировать)
  часть деструктивных действий приложения.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Завести переиспользуемый `useConfirmDialog()`/
  `<ConfirmDialog />` и заменить все вызовы `window.confirm` на него для
  единообразия.

### WEB-QUAL-11: Отладочные console.log оставлены в продовых путях кода
- Файл: web/src/components/PrintBadgeDialog.tsx:100-107 (эффект на каждое открытие диалога печати логирует весь объект шаблона); web/src/pages/event/EventLayout.tsx:27-33 (логирует событие и badgeTemplate при каждой загрузке события); web/src/pages/BadgeTemplateEditorV2.tsx:220,230 (логирует шаблон при каждом сохранении); web/src/lib/fonts.ts:100-102 (логирует при каждой загрузке шрифта)
- Описание: Это не `console.error` для диагностики ошибок, а
  `console.log`/`console.error`-имитация debug-трассировки, выполняющаяся при
  обычном пользовательском взаимодействии (открытие диалога печати,
  открытие страницы события, сохранение шаблона), а не только при сбоях.
- Влияние: Засоряет консоль браузера в проде, может утекать чувствительные
  данные шаблона/события в консоль (не секреты, но лишняя информация), явный
  признак недоубранного debug-кода.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Убрать эти `console.log` или обернуть в
  `if (import.meta.env.DEV)`.

### WEB-QUAL-12: Несогласованное форматирование дат — часть экранов игнорирует локаль приложения
- Файл: web/src/components/AttendeeMovementTimeline.tsx:84,88; web/src/pages/OrganizationSettings.tsx:182; web/src/pages/super-admin/Organizations.tsx:163; web/src/pages/super-admin/AllUsers.tsx:122; web/src/pages/super-admin/OrganizationDetail.tsx:256; web/src/pages/super-admin/AuditLog.tsx:60
- Описание: В проекте есть готовая утилита `web/src/utils/dateFormat.ts`
  (`formatDateTime`/`formatDate`), которая явно учитывает `i18n.language` для
  выбора locale (`'ru-RU'` vs `'en-US'`). Однако в перечисленных местах даты
  форматируются напрямую через `new Date(...).toLocaleDateString()` /
  `.toLocaleString()` без передачи локали — используется locale браузера по
  умолчанию, а не выбранный в приложении язык.
- Влияние: При переключении языка интерфейса на русский эти экраны (в
  основном super-admin и organization settings) продолжают показывать даты в
  формате локали браузера пользователя, тогда как экраны участников/чек-ина,
  использующие `formatDateTime`, корректно переключаются — визуально
  непоследовательный и трудно предсказуемый UI.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Заменить прямые вызовы `toLocaleDateString`/`toLocaleString`
  на `formatDate`/`formatDateTime` из `utils/dateFormat.ts` во всех
  перечисленных местах.

### WEB-QUAL-13: Неработающая кнопка «Delete Event» в Danger Zone
- Файл: web/src/pages/event/EventSettings.tsx:408-421
- Описание: Секция «Danger Zone» рендерит кнопку `t("deleteEvent")` с
  атрибутом `disabled` без каких-либо условий и без обработчика `onClick` —
  функциональность отсутствует полностью, кнопка постоянно неактивна.
- Влияние: Не является багом сам по себе (похоже на осознанный
  placeholder), но это мёртвый/незавершённый UI, оставленный в проде без
  пометки TODO/feature-flag — вводит пользователя в заблуждение, зачем кнопка
  вообще показана.
- Серьёзность: Low
- Уверенность: средняя
- Рекомендация: Либо реализовать удаление события, либо скрыть секцию за
  feature-flag/убрать до готовности функциональности.
