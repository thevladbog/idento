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

## API Endpoints

### Принтеры

#### `GET /health`
Проверка работоспособности агента.

**Response:**
```
Idento Agent is running
```

#### `GET /printers`
Список доступных принтеров.

**Response:**
```json
[
  "HP_LaserJet_Pro",
  "Zebra_ZD420",
  "Serial_ttyUSB0"
]
```

#### `POST /print`
Отправка задания на печать.

**Request:**
```json
{
  "printer_name": "Zebra_ZD420",
  "template": "^XA^FO50,50^A0N,50,50^FD{{first_name}} {{last_name}}^FS^XZ",
  "data": {
    "first_name": "John",
    "last_name": "Doe",
    "company": "Acme Inc"
  }
}
```

**Response:**
```json
{
  "status": "printed"
}
```

### Сканеры

#### `GET /scanners`
Список доступных сканеров.

**Response:**
```json
[
  "Scanner_COM3",
  "Scanner_ttyUSB0"
]
```

#### `GET /scan/last`
Получить последний отсканированный код.

**Response:**
```json
{
  "code": "ABC123XYZ",
  "time": "2025-12-08T17:30:45Z"
}
```

#### `POST /scan/clear`
Очистить последний отсканированный код.

**Response:**
```json
{
  "status": "cleared"
}
```

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

### CORS
Агент настроен на прием запросов только от:
- `http://localhost:5173` (dev web)
- `http://localhost:3000` (другие локальные сервисы)

Для production обновите настройки CORS в `main.go`.

### Доступ к портам
Убедитесь, что приложение имеет права на доступ к serial портам.

---

Made with ❤️ using Go and go.bug.st/serial

