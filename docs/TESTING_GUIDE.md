# Руководство по тестированию системы зон

## ✅ Что уже работает

### Backend (100%)
- Database schema с поддержкой зон
- API endpoints для управления зонами
- Логика проверки доступа
- QR-коды для зон
- История перемещений

### Frontend Web (70%)
- Страница управления зонами
- Компонент истории перемещений
- Интеграция в меню событий

## 🚀 Быстрый старт

### 1. Backend запущен
```bash
# Backend уже запущен на порту 8080
# Проверка: curl http://localhost:8080/api/me
```

### 2. Запустите Web UI
```bash
cd /Users/thevladbog/PRSOME/idento/web
npm run dev
# Откроется на http://localhost:5173
```

## 📋 Тестовые сценарии

### Тест 1: Создание зон
1. Войдите в систему
2. Откройте любое событие
3. Перейдите на вкладку **"Zones"** (новая вкладка в меню)
4. Нажмите **"Create Zone"**
5. Создайте зону регистрации:
   - Name: `Registration`
   - Type: `Registration`
   - Is Registration Zone: ✅ ON
   - Is Active: ✅ ON
6. Создайте VIP зону:
   - Name: `VIP Lounge`
   - Type: `VIP`
   - Open Time: `14:00`
   - Close Time: `18:00`
   - Requires Registration: ✅ ON

### Тест 2: QR-коды зон
1. На странице Zones найдите созданную зону
2. Нажмите кнопку с иконкой QR
3. Просмотрите QR-код зоны
4. Нажмите **"Download QR"**
5. QR-код содержит JSON: `{"zone_id":"...", "event_id":"...", "zone_name":"...", "type":"zone_select"}`

### Тест 3: API тестирование (через curl или Postman)

#### Получить список зон события
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8080/api/events/{event_id}/zones?with_stats=true
```

#### Создать зону
```bash
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Workshop Area",
    "zone_type": "workshop",
    "order_index": 2,
    "is_registration_zone": false,
    "requires_registration": true,
    "is_active": true
  }' \
  http://localhost:8080/api/events/{event_id}/zones
```

#### Получить QR-код зоны
```bash
# Получить PNG напрямую
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8080/api/zones/{zone_id}/qr > zone-qr.png
```

### Тест 4: История перемещений (когда будут check-ins)
1. После создания zone check-ins через API
2. Откройте профиль участника
3. Компонент `AttendeeMovementTimeline` покажет историю

## 🔧 API Endpoints (Ready to use)

### Управление зонами
```
POST   /api/events/:event_id/zones              # Создать зону
GET    /api/events/:event_id/zones              # Список зон
GET    /api/zones/:id                           # Получить зону
PUT    /api/zones/:id                           # Обновить зону
DELETE /api/zones/:id                           # Удалить зону
GET    /api/zones/:id/qr                        # QR-код зоны (PNG)
```

### Правила доступа (Backend ready, UI pending)
```
POST   /api/zones/:zone_id/access-rules         # Создать правило
GET    /api/zones/:zone_id/access-rules         # Список правил
PUT    /api/zones/:zone_id/access-rules         # Bulk update
```

### Назначение персонала (Backend ready, UI pending)
```
POST   /api/zones/:zone_id/staff                # Назначить персонал
GET    /api/zones/:zone_id/staff                # Список персонала зоны
DELETE /api/zones/:zone_id/staff/:user_id       # Удалить назначение
GET    /api/users/:user_id/zones                # Зоны пользователя
```

### Check-in в зоны (Backend ready)
```bash
# Zone check-in
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "attendee_code": "ABC123",
    "zone_id": "zone-uuid",
    "event_day": "2024-12-15T00:00:00Z"
  }' \
  http://localhost:8080/api/zones/checkin

# История перемещений участника
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8080/api/attendees/{attendee_id}/zone-history
```

### Mobile API (Backend ready)
```
GET    /api/mobile/events/:event_id/zones       # Зоны (отфильтрованные по персоналу)
GET    /api/mobile/zones/:zone_id/days          # Дни события
```

## ✨ Что можно протестировать прямо сейчас

### ✅ Работает полностью
- [x] Создание/редактирование/удаление зон через Web UI
- [x] Визуализация зон с статистикой
- [x] Настройка времени работы зон
- [x] QR-коды для зон (генерация и скачивание)
- [x] Все Backend API endpoints
- [x] Проверка доступа (backend логика)
- [x] История перемещений (backend endpoint)

### ⏳ В разработке (UI pending, Backend готов)
- [ ] Компонент настройки правил доступа по категориям
- [ ] Компонент назначения персонала на зоны
- [ ] Фильтр участников по категориям
- [ ] Интеграция истории перемещений в UI участников

## 🐛 Известные ограничения

1. **Web UI**: Некоторые компоненты требуют доработки:
   - `ZoneAccessRules` - UI для настройки доступа
   - `StaffZoneAssignments` - UI для назначения персонала
   - Category filter в списке участников

2. **Mobile App**: Требует обновления для работы с зонами

3. **Testing**: E2E тесты ещё не написаны

## 📊 Структура данных

### EventZone
```typescript
{
  id: string
  event_id: string
  name: string
  zone_type: "general" | "registration" | "vip" | "workshop" | "speaker"
  order_index: number
  open_time?: string      // "14:00"
  close_time?: string     // "18:00"
  is_registration_zone: boolean
  requires_registration: boolean
  is_active: boolean
  settings?: object
  created_at: string
  updated_at: string
}
```

### Zone Check-in Request
```json
{
  "attendee_code": "ABC123",
  "zone_id": "zone-uuid",
  "event_day": "2024-12-15T00:00:00Z"
}
```

### Zone Check-in Response
```json
{
  "success": true,
  "attendee": { /* attendee object */ },
  "zone": { /* zone object */ },
  "checked_in_at": "2024-12-15T14:30:00Z",
  "packet_delivered": true,
  "message": "Check-in successful"
}
```

## 🔐 Логика проверки доступа

Приоритет проверки:
1. **Individual Override** (highest) - Индивидуальное переопределение для участника
2. **Category Rule** - Правило для категории участника
3. **Default Allow** - Разрешено по умолчанию, если нет правил

Дополнительные проверки:
- Блокировка участника
- Статус зоны (is_active)
- Временные ограничения (open_time, close_time)
- Требование регистрации (requires_registration)

## 🎯 Следующие шаги

1. **Web UI** (2-3 часа):
   - Создать `ZoneAccessRules` компонент
   - Создать `StaffZoneAssignments` компонент
   - Добавить category filter в EventAttendees

2. **Testing** (1-2 часа):
   - E2E тесты для zone management
   - API integration tests
   - Тестирование логики доступа

3. **Mobile App** (опционально, 8-12 часов):
   - Navigation updates
   - Zone check-in screen
   - Offline mode

## 💡 Полезные команды

```bash
# Проверить статус backend
curl http://localhost:8080/api/me

# Остановить backend
lsof -ti:8080 | xargs kill -9

# Запустить backend
cd /Users/thevladbog/PRSOME/idento/backend && go run main.go

# Запустить web
cd /Users/thevladbog/PRSOME/idento/web && npm run dev

# Посмотреть логи миграций (если есть проблемы с БД)
psql -U postgres -d idento -c "SELECT * FROM schema_migrations;"
```

## 📝 Примечания

- Backend использует pgx/v5 (PostgreSQL)
- Frontend использует React + TypeScript + Vite
- i18n поддержка (EN/RU) уже добавлена
- Все API endpoints требуют JWT авторизации
- QR-коды генерируются с помощью go-qrcode library

