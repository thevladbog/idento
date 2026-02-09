<div align="center">
  <img src="./web/public/logo-ru.svg" alt="Логотип Idento" width="200"/>
  
# Idento - Система Регистрации на Мероприятиях
  
### Полнофункциональная система регистрации и чекина участников на мероприятиях с печатью бейджей
  
  [![CI](https://img.shields.io/github/actions/workflow/status/thevladbog/idento/ci.yml?branch=main&label=CI&logo=github)](https://github.com/thevladbog/idento/actions/workflows/ci.yml)
  [![GitHub Stars](https://img.shields.io/github/stars/thevladbog/idento?style=social)](https://github.com/thevladbog/idento/stargazers)
  [![GitHub Issues](https://img.shields.io/github/issues/thevladbog/idento)](https://github.com/thevladbog/idento/issues)
  [![GitHub Pull Requests](https://img.shields.io/github/issues-pr/thevladbog/idento)](https://github.com/thevladbog/idento/pulls)
  [![License](https://img.shields.io/badge/license-Proprietary-red)](LICENSE)
  
  [![Made with Go](https://img.shields.io/badge/Go-1.25+-00ADD8?logo=go&logoColor=white)](https://golang.org)
  [![Made with React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://reactjs.org)
  [![Made with Kotlin](https://img.shields.io/badge/Kotlin-2.1-7F52FF?logo=kotlin&logoColor=white)](https://kotlinlang.org)
  [![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
  
  [![Windows](https://img.shields.io/badge/Windows-0078D6?logo=windows&logoColor=white)](DEVELOPMENT.md#windows-setup)
  [![macOS](https://img.shields.io/badge/macOS-000000?logo=apple&logoColor=white)](DEVELOPMENT.md#macos-setup)
  [![Linux](https://img.shields.io/badge/Linux-FCC624?logo=linux&logoColor=black)](DEVELOPMENT.md#linux-setup)
  
  [English](README.md) • [Русский](README.ru.md)
</div>

---

## ✨ Возможности

- 🎪 **Управление мероприятиями** - создание и настройка событий
- 📊 **Гибкий импорт CSV** - любые поля, автоопределение структуры
- 🎟️ **Генерация кодов** - автоматические уникальные коды билетов
- 🏷️ **Визуальный редактор бейджей** - конструктор с динамическими полями
- ✅ **Быстрый чекин** - QR/штрих-коды, поиск, оффлайн-режим
- 🖨️ **Печать** - USB, Bluetooth, Ethernet принтеры
- 👥 **Управление персоналом** - роли, QR-вход для сотрудников
- 🌍 **Мультиязычность** - EN/RU
- 🌓 **Темная тема** - итальянский зеленый акцент

## 🚀 Быстрый старт

Idento поддерживает разработку на **Windows**, **macOS** и **Linux**.

### Windows

**Требования:** Docker Desktop, Go 1.25+, Node 20+, Git

```powershell
# Клонируйте репозиторий
git clone https://github.com/thevladbog/idento.git
cd idento

# Запустите ВСЁ одной командой!
.\scripts\start-all.ps1

# Или через Batch
.\scripts\start-all.bat

# С Make (если установлен)
make dev
```

### macOS / Linux

**Требования:** Docker, Go 1.25+, Node 20+

```bash
# Клонируйте репозиторий
git clone https://github.com/thevladbog/idento.git
cd idento

# Запустите ВСЁ одной командой!
bash scripts/start-all.sh

# Или через Make
make dev
```

### Что происходит при старте?

Команда автоматически:

- ✅ Запустит Docker (PostgreSQL, Redis, PgAdmin)
- ✅ Применит миграции БД
- ✅ Загрузит тестовые данные
- ✅ Запустит Backend (Go)
- ✅ Запустит Web Frontend (React)
- ✅ Запустит Printing Agent (Go)

### Доступ к системе

🌐 **Web Admin**: <http://localhost:5173>  
🔑 **Login**: `admin@test.com` / `password`

🔧 **Backend API**: <http://localhost:8008>  
🖨️ **Printing Agent**: <http://localhost:3000>  
🗄️ **PgAdmin**: <http://localhost:50050> (`admin@idento.com` / `admin`)

Подсказка: установите `IDENTO_SKIP_PASSWORD_RESET=1`, чтобы пропустить сброс тестовых паролей при `make dev`.

### Остановка

```bash
# Windows PowerShell
.\scripts\stop-all.ps1

# macOS / Linux
bash scripts/stop-all.sh

# Или через Make (все платформы)
make docker-down

# Примечание: stop-all сохраняет контейнеры/volumes, docker-down удаляет их.
```

## 📖 Как использовать

### 1️⃣ Импорт участников

1. Откройте мероприятие
2. Нажмите **"Import CSV"**
3. Загрузите CSV с **любыми колонками**! (пример: `examples/sample-attendees.csv`)
4. Система автоматически определит все поля
5. Просмотрите превью и нажмите **"Import"**

### 2️⃣ Генерация кодов

Если в CSV не было колонки "code":

- Нажмите **"Generate Ticket Codes"**
- Готово! Уникальные коды созданы

### 3️⃣ Создание шаблона бейджа

1. Нажмите **"Edit Template"**
2. Добавьте текстовые поля и QR-код
3. Для каждого поля выберите **Data Source** из выпадающего списка
   - Доступны ВСЕ поля из вашего CSV!
4. Настройте дизайн и сохраните

### 4️⃣ Чекин

**Web**: `/checkin` - поиск, сканирование, одна кнопка  
**Mobile**: Оффлайн-режим, встроенный сканер, синхронизация

## 🏗️ Архитектура

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Web Admin     │     │  Mobile Check-in │     │  Desktop Agent  │
│  (React + TS)   │────▶│    (Kotlin)      │────▶│  (Go + Serial)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                        │
         │                       │                        │
         └───────────────────────┴────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │   Backend (Go + Echo)    │
                    │  ┌─────────────────────┐ │
                    │  │   PostgreSQL        │ │
                    │  │   Redis Cache       │ │
                    │  └─────────────────────┘ │
                    └─────────────────────────┘
```

## 📦 Структура проекта

```
idento/
├── backend/          # Go API (Echo, PostgreSQL, Redis)
├── web/             # React Admin (Vite, TailwindCSS, shadcn/ui)
├── mobile/          # Kotlin Android приложение (offline-first)
├── agent/           # Printing Agent (Go, serial ports)
├── docs/            # Документация (руководства, миграции, статусы)
├── scripts/         # Утилиты (start-all.sh, stop-all.sh, seed.sh)
├── examples/        # Примеры CSV для импорта
└── docker-compose.yml
```

## 🛠️ Tech Stack

| Компонент | Технологии |
|-----------|-------------|
| **Backend** | Go 1.25, Echo, PostgreSQL, Redis, JWT |
| **Web** | React 18, TypeScript, Vite, TailwindCSS v4, shadcn/ui, React Konva |
| **Mobile** | Kotlin, Jetpack Compose, Room Database (SQLite) |
| **Agent** | Go, Serial port (`go.bug.st/serial`) |
| **DevOps** | Docker, Docker Compose, GitHub Actions |

## 📚 Документация

- **Руководство разработчика**: [DEVELOPMENT.md](./DEVELOPMENT.md) — детальная инструкция по разработке на Windows, macOS, и Linux
- **Документация проекта**: [docs/](./docs/) — руководства по настройке, тестированию, миграциям и статусам реализации
- **CI/CD**: [.github/CI.md](./.github/CI.md) — информация о пайплайнах и проверках
- **API Docs**: <http://localhost:8008/docs> (после запуска)

## 🎨 Функции

### Импорт CSV с динамическими полями

```csv
first_name,last_name,email,company,custom_field_1,custom_field_2
John,Doe,john@example.com,Acme,Value1,Value2
```

✅ Любые колонки - система адаптируется!

### Редактор бейджей

- Drag & Drop элементов
- Выбор полей из выпадающего списка
- QR-коды
- Настройка размеров, шрифтов, цветов

### Оффлайн-режим (Mobile)

- SQLite база данных
- Работает без интернета
- Автосинхронизация

### Управление пользователями

- Роли: Admin, Manager, Staff
- QR-токены для быстрого входа персонала
- Назначение на мероприятия

## 🧪 Разработка

### Команды Make (кросс-платформенные)

```bash
# Показать все команды
make help

# Проверить зависимости
make check-deps

# Линт
make lint

# Тесты
make test
make test-coverage

# Сборка
make build-backend    # Создаёт build/idento-backend(.exe)
make build-agent      # Создаёт build/idento-agent(.exe)
make build-all

# Docker
make docker-up
make docker-down

# Очистка
make clean
```

### Платформа-специфичные скрипты

**Windows:**

```powershell
.\scripts\start-all.ps1    # Запуск всех сервисов
.\scripts\stop-all.ps1     # Остановка
.\scripts\lint-backend.ps1 # Линт Go кода
.\scripts\seed.ps1         # Миграции и seed
```

**macOS/Linux:**

```bash
bash scripts/start-all.sh    # Запуск всех сервисов
bash scripts/stop-all.sh     # Остановка
bash scripts/lint-backend.sh # Линт Go кода
bash scripts/seed.sh         # Миграции и seed
```

### Детальная информация

См. [DEVELOPMENT.md](./DEVELOPMENT.md) для:

- Установки зависимостей на каждой платформе
- Troubleshooting по ОС
- Советов по разработке
- Команд для каждой платформы

## 📝 Примеры использования

**Загрузка CSV**:

```bash
curl -X POST http://localhost:8008/api/events/{event_id}/attendees/bulk \
  -H "Authorization: Bearer {token}" \
  -F "file=@examples/sample-attendees.csv"
```

**Генерация кодов**:

```bash
curl -X POST http://localhost:8008/api/events/{event_id}/attendees/generate-codes \
  -H "Authorization: Bearer {token}"
```

**Экспорт CSV**:

```bash
curl -X GET http://localhost:8008/api/events/{event_id}/attendees/export \
  -H "Authorization: Bearer {token}" \
  --output attendees.csv
```

## 🤝 Контрибьюция

Этот проект использует проприетарную лицензию. Для получения разрешения на использование или внесение изменений, пожалуйста, свяжитесь с владельцем репозитория.

Если у вас есть предложения или вы нашли баг:

1. Создайте [Issue](https://github.com/thevladbog/idento/issues/new/choose)
2. Опишите проблему или предложение подробно
3. При необходимости приложите скриншоты или логи

См. [CONTRIBUTING.md](CONTRIBUTING.md) для детальных инструкций по контрибуции.

## 📄 Лицензия

Proprietary — All Rights Reserved. Использование без письменного разрешения правообладателя запрещено. Подробности в [LICENSE](LICENSE).

---

<div align="center">
  
  **Сделано с ❤️ используя Go, React и Kotlin**
  
  [⭐ Star на GitHub](https://github.com/thevladbog/idento) • [📝 Сообщить об ошибке](https://github.com/thevladbog/idento/issues/new/choose) • [💡 Предложить улучшение](https://github.com/thevladbog/idento/issues/new/choose)
  
</div>
