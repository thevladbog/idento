# Экспорт данных подключения принтеров (QR pairing export)

Date: 2026-07-23
Status: approved

## Проблема

Мобильное приложение (Android/iOS, KMP) умеет подключаться к принтеру,
отсканировав QR-код `PrinterQRData` камерой
(`mobile/.../data/model/PrinterQRData.kt` + `CameraService`/`ScanSource`,
результат сохраняется в `StationConfig.printer`). Половина «scan →
подключение» **уже существует**.

Чего нет: удобного способа **получить сам QR / данные принтеров из
админки**, чтобы напечатать наклейки со стикером-QR на корпус принтера.
Оператор хочет:

- скачать QR одного принтера картинкой и вставить в свой шаблон этикетки;
- выгрузить таблицу по всем принтерам, загнать её во внешнюю лейбл-программу
  (BarTender / NiceLabel / ZebraDesigner) и там массово генерировать QR и
  подписи «на основании полей».

Сегодня генерация QR есть только «сырьём» на бэкенде — публичный
`POST /api/util/printers/generate-qr` и standalone-страница
`GET /printer-qr` (`templates/printer_qr_generator.html`), обе **вне**
дизайн-системы и **не интегрированы** в panel/console (0 упоминаний в
`panel/src` и `web/src`). Печати/показа этих QR из админки нет.

Важно: это **не** про station-provisioning QR из мобильного брифа
(`docs/design-briefs/customer-web-panel-mobile.md`, строки 42/53/80) —
тот подключает устройство как check-in станцию и осознанно уходит от
печатных QR. Здесь другая сущность: pairing именно **принтера** (на какой
физический принтер устройство шлёт этикетки).

## Решение

Добавить в Equipment hub панели **выгрузку данных подключения сетевых
принтеров** — поштучно (PNG с QR) и массово (CSV с полями + готовым
`qr_payload`). Внешняя лейбл-программа сама рисует QR и текст. Сканирование
и подключение в мобильном не трогаем.

### Почему именно так (границы)

- **Источник — реестр оборудования** (`equipment_devices`), только
  `kind=network` (ethernet). У них есть `ip`/`port`, значит из них можно
  собрать валидный `PrinterQRData` (`printer_type: ethernet`), к которому
  телефон дотянется напрямую.
- **Bluetooth-принтеров в реестре нет** (в мобильном они живут в DataStore
  телефона; агент их не видит, `DiscoverSerialPrinters` пропускает BT) →
  вне scope.
- **system/CUPS-принтеры** привязаны к локальному агенту машины; мобильный
  до них не дотянется → QR для них бессмыслен → вне scope.
- **Формат — CSV** (не xlsx): ноль новых зависимостей, тот же паттерн, что
  `ExportAttendeesCSV`, а лейбл-программы импортируют CSV нативно.
- **Печать наклейки через агента — вне scope** (осознанно выбран экспорт, а
  не in-app печать).
- **Встраивание картинки QR в CSV — не нужно** (внешняя программа рендерит
  QR из поля `qr_payload`).

## Non-goals

- Bluetooth-принтеры, ручной ввод принтеров, отдельный генератор из
  произвольного списка.
- system/CUPS pairing QR.
- Печать pairing-этикетки через local agent.
- Изменение мобильного флоу сканирования/подключения.
- xlsx-формат (можно добавить позже, если реально понадобится).
- Хранение `model`/`location` принтера в реестре (сейчас их там нет).

## Архитектура

### Backend (Go)

**Общий хелпер — единственный источник правды маппинга.**
`buildPrinterQRPayload(device models.EquipmentDevice, hostname string)
(models.PrinterQRData, error)` собирает из строки реестра готовый
`PrinterQRData`:

- `Type = "idento_printer"`, `Version = "1.0"`, `PrinterType = "ethernet"`;
- `Name = device.DisplayName`;
- `IP`, `Port` — из `device.Config` (network-config `{agent_name, ip, port, dpi?}`);
- `Settings.DPI` — из `config.dpi`, если задан; иначе `Settings` не
  добавляем (`omitempty`);
- `Model`/`Location` — не заполняем (в реестре их нет).
- Возвращает ошибку, если `class != printer`, `kind != network`, или
  `ip`/`port` пустые.

Этот хелпер используют **и** PNG-эндпоинт, **и** CSV — так `qr_payload` в
таблице и QR на картинке получаются байт-в-байт одинаковыми (оба =
`json.Marshal(payload)`).

**Эндпоинты** (в authed `api`-группе, тенант берётся из JWT-контекста;
регистр рядом с прочими equipment-роутами в `handler.go`, где устройства
уже адресуются как `/api/equipment/devices/:device_id`):

1. `GET /api/equipment/devices/:device_id/pairing-qr.png`
   - `GetEquipmentDeviceForTenant(tenant, device_id)` → `buildPrinterQRPayload` →
     `json.Marshal` → `qrcode.Encode(json, qrcode.Medium, 512)` (переиспользуем
     логику из `GeneratePrinterQR`).
   - Ответ: `image/png`, `Content-Disposition: attachment;
     filename="<slug(name)>-pairing-qr.png"` (slug транслитерирует/чистит
     кириллицу; фолбэк — `device_id`).
   - Не-network / чужой тенант / нет ip-port → `422`/`404` с понятным
     сообщением.

2. `GET /api/equipment/printers/pairing-export.csv`
   - `ListEquipmentPrintersForTenant(tenant)` → для каждого
     `buildPrinterQRPayload` → строка CSV.
   - Ответ: `text/csv`, тело начинается с **UTF-8 BOM** (`﻿`, чтобы
     Excel корректно открыл кириллицу), `Content-Disposition: attachment;
     filename="printers-pairing.csv"`. Паттерн — как `ExportAttendeesCSV`
     (`encoding/csv`, stdlib).
   - Принтеры без валидного payload (нет ip/port) — пропускаем.
   - Нет сетевых принтеров → отдаём CSV с одними заголовками (`200`).

**Store** (`pg_store_equipment.go`): новый метод
`ListEquipmentPrintersForTenant(ctx, tenantID) → []PrinterWithHostname`:

```sql
SELECT d.id, d.display_name, d.config, m.hostname
FROM equipment_devices d
JOIN equipment_machines m
  ON m.tenant_id = d.tenant_id AND m.machine_id = d.machine_id
WHERE d.tenant_id = $1 AND d.class = 'printer' AND d.kind = 'network'
ORDER BY m.hostname, d.display_name;
```

**OpenAPI:** добавить оба пути в `backend/openapi.yaml`, затем
**обязательно** `npm run generate:api -w panel` и закоммитить
сгенерированный клиент — иначе CI drift-check («Test Panel») красный.

### Panel (React, `panel/src/features/equipment`)

- `DeviceCard.tsx`: для карточки принтера с `kind=network` — действие
  **«Скачать QR подключения»**. Реализация: authed `fetch` PNG-эндпоинта →
  `blob` → скачивание (переиспользовать существующий download-хелпер, если
  есть; иначе локальный `saveBlob`). Для не-network не показываем.
- `EquipmentPage.tsx`: кнопка **«Экспорт принтеров (CSV)»** → скачивание
  CSV-эндпоинта. Скрыта/disabled, если сетевых принтеров нет.
- i18n: строки RU/EN в существующие каталоги.
- Клиент — через сгенерированный `$api` (авторизация), не через прямой
  `agentClient` (данные из бэкенда, агент не нужен).

## CSV — формат

Заголовки латиницей (надёжный биндинг в лейбл-программах), значения могут
быть кириллицей. Одна строка на eligible-принтер:

| колонка | источник | пример |
|---|---|---|
| `name` | `display_name` | `Zebra ZD421 — Вход` |
| `machine` | `hostname` машины | `checkin-pc-1` |
| `printer_type` | всегда `ethernet` | `ethernet` |
| `ip` | `config.ip` | `192.168.1.50` |
| `port` | `config.port` | `9100` |
| `dpi` | `config.dpi` (может быть пусто) | `203` |
| `qr_payload` | `json.Marshal(PrinterQRData)` | JSON (см. ниже) |
| `device_id` | UUID строки реестра | `a1b2c3d4-…` |

Пример `qr_payload` (`encoding/csv` сам заэкранирует кавычки/запятые):

```json
{"type":"idento_printer","version":"1.0","printer_type":"ethernet","name":"Zebra ZD421 — Вход","ip":"192.168.1.50","port":9100,"settings":{"dpi":203}}
```

В лейбл-программе: QR биндится на `qr_payload`; подписи — на `name` /
`machine`.

## Поток

1. Оператор открывает Equipment hub в панели.
2. Поштучно: «Скачать QR» на карточке сетевого принтера →
   `GET …/pairing-qr.png` → браузер сохраняет PNG (голый QR 512px) →
   оператор вставляет в свой шаблон.
3. Массово: «Экспорт принтеров (CSV)» → `GET …/pairing-export.csv` →
   импорт в BarTender/NiceLabel → биндинг QR на `qr_payload`, текста на
   `name`/`machine` → печать стикеров.
4. Стикер клеится на принтер.
5. Сотрудник в мобильном сканит стикер → `PrinterQRData` парсится →
   телефон подключается к этому ethernet-принтеру. **(Эта половина уже
   существует.)**

## Edge cases / обработка ошибок

- Устройство не найдено / чужой тенант → `404`.
- Устройство не сетевой принтер (system/CUPS, scanner) → `422`, текст
  «QR подключения доступен только для сетевых принтеров».
- В `config` нет `ip`/`port` → строку пропускаем в CSV; для PNG → `422`.
- Нет сетевых принтеров → CSV из одних заголовков; в панели кнопка
  disabled/скрыта.
- Кириллица в имени → slug для имени файла PNG транслитерирует/чистит,
  фолбэк на `device_id`.
- `qr_payload` и PNG строятся **одним** хелпером → расхождение исключено.

## Тестирование

- **Unit:** `buildPrinterQRPayload` — корректный маппинг network-принтера;
  отказ для system/scanner и для пустых ip/port.
- **Handler:** PNG (`image/png` + заголовки; `422` для не-network); CSV
  (`text/csv`, ровно ожидаемая строка заголовков, строка на каждый
  network-принтер, BOM в начале).
- **Round-trip (ключевой инвариант):** `qr_payload` из CSV парсится обратно
  в `PrinterQRData`, равный payload'у, который отдаёт PNG-эндпоинт для того
  же устройства → гарантия «что в CSV = что сканит мобильный».
- **Tenant-isolation:** оба эндпоинта не отдают чужие устройства (по образцу
  `tenant_isolation_test.go`).
- **Contract:** новые пути в openapi (по образцу
  `openapi_contract_attendees_test.go`).
- **Panel:** кнопки видны только при наличии сетевых принтеров; клик
  инициирует скачивание (MSW-мок эндпоинтов).

## Гейты / гочи при реализации

- Прямой push в `origin/main` заблокирован → работа в ветке
  `feat/printer-pairing-qr-export`, merge через PR.
- Правка `backend/openapi.yaml` → `npm run generate:api -w panel` +
  коммит клиента (drift-check).
- Panel typecheck — `npm run typecheck`, не голый `tsc`.

## Возможные продолжения (вне текущего scope)

- xlsx-формат (excelize) поверх той же выборки, если понадобится.
- Готовая PNG-этикетка (QR + подпись + рамка) вместо голого QR.
- Ручной ввод/добавление Bluetooth-принтеров в выгрузку.
- Печать pairing-этикетки прямо на принтер через local agent.
