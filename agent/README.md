# 🖨️ Idento Hardware Agent

Агент для работы с принтерами и сканерами штрих-кодов через USB/COM порты.

## Возможности

### Принтеры
- ✅ **Системные принтеры** - автоматическое обнаружение через CUPS (macOS/Linux) или WMI (Windows)
- ✅ **Serial/USB принтеры** - прямое подключение через COM-порты
- ✅ **Сетевые принтеры** - добавление через IP:port
- ✅ **Поддержка протоколов** - ZPL, TSPL, ESC/POS

### Сканеры
- ✅ **COM-порт сканеры** - автоматическое обнаружение
- ✅ **USB сканеры** - через serial порты (ttyUSB, ttyACM, usbmodem)
- ✅ **Режим реального времени** - непрерывное чтение данных
- ✅ **Callback система** - мгновенная передача отсканированных данных

## Быстрый старт

### Запуск

```bash
cd agent

# Режим с реальным оборудованием
go run main.go

# Режим с mock-устройствами (для тестирования)
go run main.go --mock

# Кастомный порт
go run main.go --port 3000
```

### Build

```bash
go build -o idento-agent
./idento-agent
```

## API

Полную документацию API агент отдаёт сам:

- **`GET /docs`** — интерактивная документация (Scalar UI): http://localhost:12345/docs
- **`GET /openapi.yaml`** — OpenAPI-спецификация (источник правды — [openapi.yaml](openapi.yaml))

### Обзор эндпоинтов

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/health` | Проверка работоспособности (без авторизации) |
| GET | `/info` | Идентификация агента: `{machine_id, hostname, version, uptime_seconds}` (без авторизации) |
| GET | `/printers` | Список принтеров: массив `{name, type}`, `type` = `system` \| `network` |
| POST | `/print` | Печать ZPL: `{printer_name, zpl}` (legacy-форма: `{printer_name, template, data}`) |
| POST | `/print-pdf` | Печать PDF: `{printer_name, pdf_base64}` — только системные принтеры |
| POST | `/printers/add` | Добавить сетевой принтер: `{name, ip, port}` |
| POST | `/printers/remove` | Удалить сетевой принтер: `{name}` |
| GET, POST | `/printers/default` | Получить / установить принтер по умолчанию |
| GET | `/printers/fonts` | Справочник стандартных ZPL-шрифтов |
| GET | `/printers/{name}/fonts` | Шрифты конкретного принтера |
| GET | `/scanners` | Активные сканеры: массив `{name, port_name}` |
| GET | `/scanners/ports` | Доступные COM/USB порты |
| POST | `/scanners/add` | Добавить сканер: `{port_name}` |
| POST | `/scanners/remove` | Удалить сканер: `{port_name}` |
| GET | `/scan/last` | Последний отсканированный код: `{code, time}` (не атомарно с `/scan/clear`, см. `/docs`) |
| POST | `/scan/clear` | Очистить буфер последнего скана (безусловно) |
| POST | `/scan/consume` | Атомарно получить и очистить последний скан — без риска потерять скан, пришедший между чтением и очисткой |

Схемы запросов/ответов и коды ошибок — в `/docs`.

### Авторизация

Все эндпоинты, кроме `GET /health`, `GET /docs`, `GET /openapi.yaml` и `GET /info`, требуют авторизации (реализация — [internal/httpauth/httpauth.go](internal/httpauth/httpauth.go)). Исключённые эндпоинты read-only и не содержат секретов; их эффективная защита — привязка агента к loopback-адресу. Запрос к защищённым эндпоинтам пропускается одним из двух способов:

1. **Bearer-токен** — заголовок `Authorization: Bearer <token>`. Токен генерируется автоматически при первом запуске и хранится в `~/.idento/agent_config.json` (права `0600`). Используется desktop-приложением.
2. **Браузерный fallback (без токена)** — запрос должен идти на loopback-хост (`localhost` / `127.0.0.1`), мутации (`POST`/`PUT`/`PATCH`/`DELETE`) — с `Content-Type: application/json`, а заголовок `Origin` должен входить в allowlist. По умолчанию: `http://localhost:5173`, `http://localhost:5174`, `http://localhost:3000`; переопределяется переменной окружения `AGENT_ALLOWED_ORIGINS` (CSV) или полем `allowed_origins` в конфиге.

## Обнаружение оборудования

### Системные принтеры

**macOS/Linux:**
```bash
lpstat -p
```

**Windows:**
```bash
wmic printer get name
```

### Serial порты (принтеры/сканеры)

Агент автоматически сканирует:
- **Windows**: `COM1`, `COM2`, `COM3`, ...
- **macOS**: `/dev/tty.usbserial*`, `/dev/tty.usbmodem*`
- **Linux**: `/dev/ttyUSB*`, `/dev/ttyACM*`

## Типы принтеров

### 1. Системные принтеры
Установлены в ОС, доступны через драйверы.

**Преимущества:**
- Не требуют настройки портов
- Работают через стандартные драйверы
- Поддержка статуса печати

**Использование:**
```go
printer := printer.NewSystemPrinter("HP_LaserJet_Pro")
printer.SendRaw(zplData)
```

### 2. Serial/USB принтеры
Прямое подключение через COM-порт.

**Преимущества:**
- Прямой доступ к оборудованию
- Поддержка специальных команд
- Работает без драйверов

**Использование:**
```go
printer, err := printer.NewSerialPrinter("Zebra", "/dev/ttyUSB0")
printer.SendRaw(zplData)
```

## Работа со сканерами

### Инициализация

```go
scanner := scanner.NewScanner("Barcode Scanner", "COM3", 9600)

// Регистрация callback
scanner.OnScan(func(data string) {
    fmt.Printf("Scanned: %s\n", data)
})

// Открыть соединение
scanner.Open()
```

### Настройки COM-порта

Типичные настройки для сканеров:
- **Baud Rate**: 9600 (стандарт)
- **Data Bits**: 8
- **Parity**: None
- **Stop Bits**: 1

## Протоколы печати

### ZPL (Zebra Programming Language)

```zpl
^XA
^FO50,50^A0N,50,50^FDJohn Doe^FS
^FO50,120^A0N,30,30^FDAcme Inc^FS
^FO300,50^BQN,2,6^FDABC123^FS
^XZ
```

### TSPL (TSC Printer Language)

```tspl
SIZE 80 mm, 50 mm
GAP 2 mm, 0 mm
DIRECTION 1
CLS
TEXT 50,50,"3",0,1,1,"John Doe"
TEXT 50,120,"2",0,1,1,"Acme Inc"
QRCODE 300,50,M,5,A,0,"ABC123"
PRINT 1
```

### ESC/POS (Epson/Star)

```
ESC @ (initialize)
GS ! 0x01 (double height)
John Doe
LF LF
Acme Inc
LF LF LF
ESC d 5 (feed 5 lines)
```

## Troubleshooting

### Принтер не обнаружен

**macOS/Linux:**
```bash
# Проверить список принтеров
lpstat -p

# Проверить CUPS
system_profiler SPPrintersDataType
```

**Windows:**
```bash
# Проверить принтеры
wmic printer list brief
```

### Сканер не работает

```bash
# Проверить доступные порты
ls /dev/tty* | grep -E "USB|ACM|usbserial|usbmodem"

# Дать права доступа (Linux)
sudo chmod 666 /dev/ttyUSB0

# Проверить подключение
screen /dev/ttyUSB0 9600
```

### Права доступа (macOS/Linux)

```bash
# Добавить пользователя в группу dialout (Linux)
sudo usermod -a -G dialout $USER

# Дать права на порты (macOS)
sudo chmod 666 /dev/tty.usbserial*
```

## Рекомендуемое оборудование

### Принтеры этикеток
- **Zebra ZD420/ZD620** - ZPL, USB/Ethernet/Bluetooth
- **TSC TE200** - TSPL, USB/Serial
- **Brother QL-820NWB** - ESC/POS, WiFi/Bluetooth
- **Dymo LabelWriter** - ESC/POS, USB

### Сканеры штрих-кодов
- **Honeywell Voyager 1200g** - USB/COM
- **Zebra DS2208** - USB
- **Datalogic QuickScan** - USB/COM
- **Symbol LS2208** - USB/Serial

## Production Deployment

### Запуск как служба (systemd на Linux)

```ini
[Unit]
Description=Idento Hardware Agent
After=network.target

[Service]
Type=simple
User=idento
WorkingDirectory=/opt/idento/agent
ExecStart=/opt/idento/agent/idento-agent --port 12345
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable idento-agent
sudo systemctl start idento-agent
```

### Запуск как служба (macOS launchd)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.idento.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/idento-agent</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

## Безопасность

### Авторизация и CORS
Доступ к API контролируется bearer-токеном либо Origin-allowlist для браузерных клиентов — см. раздел [Авторизация](#авторизация). CORS-заголовки используют тот же allowlist. Для production задайте свои origins через переменную окружения `AGENT_ALLOWED_ORIGINS` (CSV) или поле `allowed_origins` в `~/.idento/agent_config.json` — правки в `main.go` не требуются.

### Доступ к портам
Убедитесь, что приложение имеет права на доступ к serial портам.

---

Made with ❤️ using Go and go.bug.st/serial

