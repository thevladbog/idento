# Idento Mobile — рефакторинг и редизайн: дизайн-документ

Дата: 2026-07-10. Статус: одобрен пользователем (все секции).
Источник дизайна: Claude Design, проект `165a9ba5-4bb1-4ede-9048-546ccb1742af`, файл **«Idento Mobile.dc.html»** (канвас «Полная система: киоск-строгий + киоск самообслуживания»). Ключевые факты макетов продублированы в этом документе — реализация не должна требовать доступа к канвасу.

## 1. Цель и рамки

Переработать мобильные приложения Idento в **единый KMP-продукт** (Compose Multiplatform) по утверждённому дизайну: тёмный рабочий интерфейс персонала («киоск-строгий») + киоск самообслуживания. Полный объём дизайна, 4 платформы, backend-доработки в скоупе.

**Решения, зафиксированные с пользователем:**

| Вопрос | Решение |
|---|---|
| Объём | Полный продукт по дизайну (3 режима станции + мастер + очереди) |
| Платформы | Android телефон/ТСД, iOS телефон, Android-планшет (киоск), iPad (киоск) |
| Backend | В скоупе (правила зон, станции, batch, override-лог) |
| Миграция | Прод-пользователей нет — радикальная перестройка разрешена |
| Локализация | RU + EN с самого начала (все строки через ресурсы) |
| Архитектура | **Подход A: KMP-унификация** — один код в `:shared`, старый Android-стек (`mobile/android-app`, Hilt/Retrofit) удаляется после паритета |

**Не в скоупе v1:** светлая тема (пункт «Тема» показывает «Тёмная»; макетов светлой нет), BT-SPP печать/сканер на iOS (дизайн: «только Android»), интерактивный прототип и планшет-версия интерфейса персонала (в `dv-next` дизайна как «дальше»).

## 2. Контекст кода (почему рефакторинг, а не достройка)

Сейчас два параллельных стека с дублированной логикой:
- `mobile/android-app` (`:app`) — отгружаемый Android: Hilt + Retrofit/OkHttp + Jetpack Compose; **не зависит** от `:shared`.
- `mobile/shared` — KMP (Koin + Ktor + Compose MP) — фактически код iOS; его Android-часть мертва.

В `:shared` уже есть скелет будущего продукта, но брошенный: offline-sync не подключён к UI (MOBILE-BUG-03/QUAL-06), печать на iOS — заглушка с ложным успехом (MOBILE-QUAL-04), zone-режим недостижим, `runBlocking` в `onReceive` сканера (MOBILE-BUG-04). Дизайн легализует именно эти подсистемы. Недавние security-фиксы (SecureStore Keychain/Keystore, редакция логов, `isDebugBuild()`/`resolveBaseUrl()`, network_security_config variant-split) сделаны в `:shared`/`:app` и переезжают в новую структуру.

Версионные потолки: **Kotlin 2.3.21 / AGP 8.13.2 / Compose MP 1.11.1 / Ktor 3.5.1 / Koin 4.x** (см. память проекта: Hilt-потолок неактуален — Hilt уходит). iOS-таргеты: `iosArm64`, `iosSimulatorArm64`, deployment target 14.0.

## 3. Архитектура

Единая Gradle-сборка `mobile/` (одна `settings.gradle.kts` c модулями `:shared`, `:androidApp`; `iosApp` — Xcode-проект поверх framework'а `shared`).

```
mobile/
├── shared/                          # ВЕСЬ продукт
│   └── src/commonMain/kotlin/com/idento/
│       ├── designsystem/            # токены, тема, базовые компоненты
│       ├── domain/                  # модели, StationConfig, вердикты, правила
│       ├── data/                    # Ktor API, SQLDelight, очереди, репозитории
│       ├── feature/
│       │   ├── setup/               # мастер: вход → событие → режим → день/зона → принтер
│       │   ├── registration/        # Скан/Поиск/Список + 6 вердиктов
│       │   ├── zonecontrol/         # скан у зоны + 3 вердикта
│       │   ├── kiosk/               # ожидание/приветствие/ошибка (планшет)
│       │   └── settings/            # СТАНЦИЯ + ЛИЧНОЕ
│       └── platform/                # expect-объявления: скан, печать, lockdown, SecureStore
├── androidApp/                      # тонкая оболочка: 1 Activity, CameraX+MLKit,
│                                    # HW/BT-сканер, Lock Task Mode, network_security_config
└── iosApp/                          # тонкая оболочка (существующая): AVFoundation-скан
```

- **Одно приложение, три режима.** Режим станции (Регистрация / Контроль зоны / Киоск) — шаг 2/4 мастера; он определяет навигационный граф после настройки. Киоск — НЕ отдельное приложение. Телефон/планшет — адаптивная вёрстка по window size class (киоск-экраны рассчитаны на вертикальный планшет).
- **DI — Koin** во всём продукте (паттерн `expect fun createX()` + платформенные actual, как сейчас в `AppModule`). Hilt удаляется вместе с `mobile/android-app`.
- **HTTP — только Ktor** (Retrofit/OkHttp-стек уходит; OkHttp остаётся транспортным движком Ktor на Android).
- **Навигация** — org.jetbrains navigation-compose (уже в зависимостях): граф `setup` → по режиму: граф `registration` | `zonecontrol` | `kiosk`.

## 4. Доменная модель

```kotlin
// Результат мастера; персистентен (DataStore), пересобирается при «Выйти со станции»
data class StationConfig(
    val eventId: String, val eventName: String,
    val mode: StationMode,             // REGISTRATION | ZONE_CONTROL | KIOSK
    val dayDate: LocalDate?,           // null для KIOSK
    val workPointId: String,           // вход или зона (для KIOSK — точка регистрации)
    val workPointName: String,
    val printer: PrinterConfig?,       // null для ZONE_CONTROL
    val autoPrint: Boolean,            // «Автопечать при чек-ине»
    val deviceNumber: Int,             // выдаёт backend при провижининге
    val staffName: String,
)

// Общие данные участника в вердикте
data class VerdictAttendee(val id: String, val fullName: String, val company: String?, val category: String)

// Состояние печати в вердикте Success (Instant — kotlinx-datetime, уже в зависимостях)
sealed interface PrintState { object Printing; object Queued; object Done; data class Failed(val reason: String) }

sealed interface RegistrationVerdict {          // экран = полоса 42% + таблица + кнопки
    // зелёная #00935E — «ОТМЕЧЕНА»; printState: Printing|Queued|Done|Failed(reason)
    data class Success(val a: VerdictAttendee, val at: Instant, val firstTime: Boolean, val printState: PrintState)
    // янтарная #F5A300 — «УЖЕ ОТМЕЧЕН» + где/когда/каким устройством; кнопки «Всё равно пропустить» / «Следующий»
    data class AlreadyChecked(val a: VerdictAttendee, val firstAt: Instant, val firstPoint: String, val firstDevice: Int)
    // нейтральная #2B3230 — «КОД НЕ НАЙДЕН»; кнопки «Найти по имени» / «Сканировать снова»
    data class NotFound(val rawCode: String, val hint: String)
    // красная #CE2B37 — «ДОСТУП ЗАПРЕЩЁН»; причина от сервера; кнопки «Понятно» / «Позвать менеджера»
    data class Denied(val a: VerdictAttendee, val reason: String)
    // зелёная полоса (чек-ин УСПЕШЕН) + красная строка печати; кнопки «Повторить печать» / «Следующий — напечатать позже»
    data class PrintError(val a: VerdictAttendee, val at: Instant, val printReason: String)
}

sealed interface ZoneVerdict {
    // зелёная — «ДОСТУП РАЗРЕШЁН»; регистрация «Пройдена ✓ HH:MM · точка», вход впервые/повторно
    data class Allowed(val a: VerdictAttendee, val registeredAt: Instant, val registeredPoint: String, val firstEntry: Boolean)
    // красная — «НЕТ ДОПУСКА»; причина-правило («после 14:00 — только VIP и Спикеры»)
    data class NoAccess(val a: VerdictAttendee, val ruleReason: String, val registeredAt: Instant?)
    // янтарная — «НЕ БЫЛ НА РЕГИСТРАЦИИ»; «направьте на стойку (точка)»; кнопки «Всё равно пропустить» / «Следующий»
    data class NotRegistered(val a: VerdictAttendee, val registrationPointHint: String)
}
```

Правила поведения (из макетов, обязательны):
- Вердикт-экран живёт **до следующего скана** (или явной кнопки «Следующий»).
- «Всёравно пропустить» (override) всегда логируется на backend с именем сотрудника.
- Ошибка печати **не отменяет чек-ин**: задание в очередь печати, ячейка «Принтер» в статус-строке красная.
- Единый скан-пайплайн: источник (камера | аппаратный сканер) → `Flow<String>` → общий обработчик. Дебаунс: тот же код в течение 3 с игнорируется.
- Цвет всегда дублируется иконкой и подписью (доступность).

## 5. Данные и backend-контракт

### 5.1 Backend (Go) — новое

| # | Что | API / модель |
|---|---|---|
| 1 | Правила допуска в зону | Таблица `zone_access_rules(zone_id, category, time_from, time_to)`. Вердикт считает сервер: `POST /api/zones/:id/scan {code}` → `{verdict: allowed|no_access|not_registered, reason, attendee{...}, registration{passed, at, point}}`. Клиент кэширует правила события для офлайн-фоллбэка (`GET /api/events/:id/zone-rules`). |
| 2 | Override-лог | `POST /api/checkins/override {attendee_id, context: already_checked|not_registered|no_access, zone_id?}` — сотрудник из JWT; аудит-таблица `checkin_overrides`. |
| 3 | Провижининг станции | Веб-консоль менеджера генерирует одноразовый QR (короткоживущий токен) → `POST /api/stations/provision {token, device_info}` → `{station_config, staff_jwt, device_number}`. Таблица `stations`. Существующий вход email+пароль остаётся для менеджера. |
| 4 | Идемпотентный batch чек-ин | `POST /api/checkins/batch [{client_uuid, attendee_id, at, device_number, kind: checkin|zone_entry}]` — дедуп по `client_uuid`; конфликт → в ответе `already_checked` с первичными данными. |
| 5 | KPI статус-строки | `GET /api/events/:id/stats?zone=` → отмечено/допущено/отказов; клиент инкрементит локально между обновлениями. |

Все новые хендлеры — через `requireEventOwnership`/`requireZoneOwnership` (харнесс Фазы 2B) + тесты.

### 5.2 Mobile data-слой

- **SQLDelight** (новая зависимость, KMP-стандарт) вместо `OfflineDatabaseImpl`:
  - `pending_checkins` — офлайн-очередь (client_uuid, attendee, at, kind, попытки);
  - `attendee_cache` — снапшот участников события (для офлайн-вердиктов, Поиска и Списка на ~2 500 строк);
  - `zone_rules_cache`; `print_jobs` — очередь печати (ZPL, статус, попытки).
- **SyncService** (оживление существующего): авто-слив `pending_checkins` при появлении сети; жёлтый счётчик «Очередь» в статус-строке; баннер «Офлайн · N чек-инов в очереди · посл. синх. HH:MM» в настройках.
- **Очередь печати**: ретраи с бэкоффом; «Повторить печать» с вердикта; ZPL-генератор в `shared` с экранированием `\ ^ ~` (практика WEB-SEC-02).

## 6. UI-слой

### 6.1 Токены (из канваса, дословно)

| Токен | Значение | Роль |
|---|---|---|
| bg | `#111413` | фон |
| surface | `#1B1F1D` | поверхности/карточки |
| brand | `#00935E` | бренд, primary-кнопки, активные состояния |
| indicator | `#2EE6A8` | мятные индикаторы, скан-линия, «подключён» |
| queue | `#FACC15` | очередь/офлайн |
| denied | `#CE2B37` | отказ |
| amber | `#F5A300` | «уже отмечен» / «не был на регистрации» |
| neutralBand | `#2B3230` | «код не найден» |
| hairline `#232725`, border `#2A2F2C`, text muted `#6B736F` / secondary `#9AA5A0` | | вспомогательные |

Типографика: **Inter** (бандлится, 400–800). Вердикт-слово 24–26px/800 (letter-spacing .04–.06em), имя 29px/800 (киоск 46px), caps-лейблы 9.5–12px/700. Моно — только коды (`EVT-2026-…`). Радиусы: primary-кнопка r14/h56, secondary r12/h48, карточки r14–20, чипы r99.

### 6.2 Компоненты (однократно, для всех экранов)

`StatusBar` (4 ячейки: значение + caps-подпись; состав зависит от режима), `ModeSegmentedControl` (Скан/Поиск/Список), `VerdictBand` (цветная полоса ~42% высоты + иконка + слово), `DetailTable` (label 110–120px + значение), `ActionStack` (primary + outline, прижаты вниз), `ListRow` (аватар-инициалы + имя + организация + статус-чип `✓ HH:MM`/`✕ отказ`/`—`/пилюля «Отметить»), `FilterChips` («Все · N» и т.д.), `ScanReticle` (уголки + анимированная линия: keyframes 0%→top 10%, 48%→top 86%, 52–100% fade, 2.6s infinite), `OfflineBanner`, `Toggle`, `SelectableCard` (выбранная — рамка 2px brand + заливка `#0F2A20`).

### 6.3 Экраны (23 макета → composable)

- **Регистрация (3a)**: скан; вердикты Успех / Уже отмечен / Не найден / Отказ / Ошибка печати.
- **Аппаратный сканер (3b)**: «Сканер готов» (камера выключена, пульсирующие кольца, пилюля «Zebra TC21 · подключён», кнопка «Включить камеру телефона»); «Сканер отключился» (переподключить / перейти на камеру). Режим включается автоматически при подключённом сканере.
- **Поиск/Список (3c)**: поиск с подсветкой совпадения мятным и подсказками; список с фильтр-чипами и статусами. «Скан работает и здесь».
- **Контроль зоны (3d)**: статус-строка ЗОНА/ДОПУЩЕНО/ОТКАЗОВ/ОЧЕРЕДЬ; бейдж «Контроль допуска — печать отключена»; вердикты Допуск / Нет допуска / Не был на регистрации.
- **Мастер (3e)**: Вход (QR персонала — камера + поля сервер/email/пароль для менеджера) → 1/4 Событие (карточки) → 2/4 Режим (3 карточки с описаниями) → 3/4 День и зона (пилюли дат + радио-точки) → 4/4 Принтер (табы Bluetooth/Ethernet/QR-код, карточки принтеров, тумблер автопечати, «Пробная печать») → «Готово — к сканеру». Ветвления: Контроль зоны пропускает шаг «Принтер»; Киоск вместо дня/зоны — только точка регистрации.
- **Настройки (3f)**: секции СТАНЦИЯ (Сервер, Режим, Принтер, BT-сканер «только Android») и ЛИЧНОЕ (Тема, Язык); «Выйти со станции» (красная outline); футер «Idento Mobile <версия> · устройство №N»; офлайн-баннер.
- **Киоск (3g, вертикальный планшет)**: Ожидание (большой ретикл + «Кода нет? Позовите сотрудника») → Приветствие (полноэкранная зелёная, имя 46px, «бейдж печатается — заберите справа», авто-возврат 5 с) | «Обратитесь к сотруднику» (нейтрально для участника, причина — только персоналу; авто-возврат 10 с). Сервисный выход — long-press по логотипу.

## 7. Платформенные сервисы (expect/actual)

| Сервис | Android actual | iOS actual |
|---|---|---|
| `ScanSource` (камера) | CameraX + ML Kit barcode | AVFoundation `AVCaptureMetadataOutput` |
| `HardwareScanner` | Honeywell/Datalogic broadcast + Zebra BT SPP (существующий код; фикс MOBILE-BUG-04: `runBlocking`→буферизованный `tryEmit`) | отсутствует (UI скрыт) |
| `PrinterTransport` | BT SPP + TCP:9100 | **только TCP:9100** (`NWConnection`); BT-SPP на iOS недоступен без MFi — принято дизайном |
| `KioskLock` | Lock Task Mode + keep-screen-on + скрытие system UI | Guided Access (ОС) + keep-screen-on |
| `SecureStore` | Keystore AES/GCM (готово) | Keychain (готово) |

## 8. Обработка ошибок

- Ошибка печати → чек-ин сохранён, job в очередь, вердикт «Ошибка печати», ячейка «Принтер» красная.
- Нет сети → вердикт по `attendee_cache`, чек-ин в `pending_checkins`; жёлтая «Очередь»; авто-синк.
- Сканер отключился → экран 3b-2, камера как фоллбэк; чек-ин не прерывается.
- Киоск: любая проблема → нейтральный экран участнику, детали в стороне персонала.
- Истечение/отзыв токена → на экран входа; очереди (чек-ины, печать) сохраняются и доливаются после входа.
- Скан-дебаунс 3 с по одинаковому коду (защита от двойной обработки).
- Секьюрные инварианты: fail-closed токен (login не успешен без персиста — уже реализовано), HTTPS-only в release, логи без тел/токенов.

## 9. Тестирование

- **commonTest**: маппинг ответов API → вердикты; офлайн-оценка правил зон (вкл. временные окна и «не был на регистрации»); семантика очередей (дедуп по client_uuid, ретраи, порядок); экранирование ZPL; дебаунс.
- **SQLDelight** — JVM-тесты запросов.
- **Backend (Go)** — хендлер-тесты новых эндпоинтов на харнессе 2B (tenant-изоляция обязательна для всех).
- **Гейты на фазу**: `:androidApp:assembleDebug` + `:androidApp:lintDebug`, `:shared:compileKotlinIosSimulatorArm64` + `iosArm64`, `:shared:testDebugUnitTest`, backend `go test ./...` + gosec + golangci-lint.

## 10. Фазы исполнения (каждая — отдельный план)

| Фаза | Содержимое | Выход |
|---|---|---|
| **B** | Backend-контракт: zone_access_rules + `POST /zones/:id/scan`, `stations` + провижининг QR, `checkins/batch`, `checkins/override`, stats | API готово + тесты; веб-консоль: генерация QR станции (минимально) |
| **M1** | Design system + мастер настройки + режим «Регистрация» целиком (скан/поиск/список, 6 вердиктов, очередь печати, офлайн-очередь, настройки) | Рабочий продукт регистрации на Android+iOS |
| **M2** | Контроль зоны + аппаратный/BT-сканер (+фикс MOBILE-BUG-04) | Все staff-режимы |
| **M3** | Киоск: планшетная вёрстка, lockdown, авто-сброс, long-press выход | Все 3 режима |
| **M4** | Удаление `mobile/android-app`, чистка мёртвого кода `:shared` (InMemoryAuthStorage, createPlatformHttpClient, старые VM), перенос CI на `:androidApp` | Один стек; аудиторские MOBILE-BUG-03, QUAL-04/-05/-06 закрыты по построению (BUG-04 закрыт ещё в M2) |

Порядок B → M1 → M2 → M3 → M4; M1 может стартовать параллельно B на замоканном контракте (контракт фиксируется в этом документе).

## 11. Риски и открытые вопросы

- **Compose MP на iOS** — зрелость: продукт уже собирается на CMP 1.11.1 для iOS; риск умеренный, staff-инструменту нативность некритична.
- **Печать iOS = только сеть.** Если появится требование BT-печати с iPhone — отдельный проект (Zebra Link-OS/MFi).
- **EN-тексты** макетов не нарисованы — переводим самостоятельно, ревью носителем позже.
- **Светлая тема** — задел токенами, не рисуем.
- Реальный Keychain/Keystore smoke-тест в подписанных сборках — обязателен в M1 (ограничение из аудита SEC-03).
