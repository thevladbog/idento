# Idento Android - Нативное приложение на Kotlin

✅ **Стабильная нативная разработка** - без npm проблем!

## 🎯 Что реализовано

### Структура проекта
- ✅ Gradle конфигурация (Kotlin DSL)
- ✅ Hilt Dependency Injection
- ✅ Jetpack Compose UI
- ✅ Material 3 Design
- ✅ MVVM Architecture

### Модели данных
- ✅ User, Event, Attendee
- ✅ Login/QR Login Request/Response
- ✅ Checkin Request/Response

### API Layer
- ✅ Retrofit API интерфейс
- ✅ Все эндпоинты backend
- ✅ Готовы для интеграции

### UI/UX
- ✅ Тема с итальянским зеленым (#009246)
- ✅ Светлая и темная темы
- ✅ Переводы (EN/RU)
- ✅ Material 3 компоненты

## 📦 Технологический стек

- **Язык**: Kotlin
- **UI**: Jetpack Compose + Material 3
- **DI**: Hilt
- **Network**: Retrofit + OkHttp
- **Async**: Coroutines + Flow
- **Camera**: CameraX + ML Kit Barcode
- **Storage**: DataStore + Room
- **Architecture**: Clean Architecture + MVVM

## 🚀 Как запустить

### Требования
- Android Studio Hedgehog (2023.1.1) или новее
- JDK 17
- Android SDK 34
- Gradle 8.2+

### Шаги

1. **Откройте проект в Android Studio**:
   ```bash
   cd /Users/thevladbog/PRSOME/idento/android-app
   # Затем: File → Open → выбрать android-app
   ```

2. **Sync Gradle**:
   - Android Studio автоматически предложит sync
   - Или: File → Sync Project with Gradle Files

3. **Запустите на эмуляторе или устройстве**:
   - Создайте эмулятор: Tools → Device Manager → Create Device
   - Выберите API Level 34 (Android 14)
   - Нажмите Run ▶️

## 📱 Что нужно доделать

### Этап 1: DI и Repository (30 минут)
- [ ] `di/NetworkModule.kt` - Retrofit, OkHttp, API
- [ ] `di/RepositoryModule.kt` - Repositories
- [ ] `data/repository/AuthRepository.kt`
- [ ] `data/repository/EventRepository.kt`

### Этап 2: Navigation (15 минут)
- [ ] `presentation/navigation/IdentoNavHost.kt`
- [ ] `presentation/navigation/Screen.kt`

### Этап 3: Login Screen (1 час)
- [ ] `presentation/login/LoginScreen.kt`
- [ ] `presentation/login/LoginViewModel.kt`
- [ ] DataStore для токена

### Этап 4: Events Screen (1 час)
- [ ] `presentation/events/EventsScreen.kt`
- [ ] `presentation/events/EventsViewModel.kt`

### Этап 5: Checkin Screen (1.5 часа)
- [ ] `presentation/checkin/CheckinScreen.kt`
- [ ] `presentation/checkin/CheckinViewModel.kt`
- [ ] Camera QR scanning

### Этап 6: Bluetooth Printing (1 час)
- [ ] `util/bluetooth/BluetoothPrinter.kt`
- [ ] `util/print/ZplGenerator.kt`

## 🔧 Конфигурация Backend

Обновите базовый URL в `NetworkModule.kt`:

```kotlin
private const val BASE_URL = "http://10.0.2.2:8080/"  // Для эмулятора
// или
private const val BASE_URL = "http://192.168.1.100:8080/"  // Для реального устройства
```

## 📊 Текущий статус

| Компонент | Статус | Примечание |
|-----------|--------|------------|
| Gradle Setup | ✅ Готово | Все зависимости добавлены |
| Models | ✅ Готово | User, Event, Attendee |
| API Interface | ✅ Готово | Retrofit endpoints |
| Theme | ✅ Готово | Material 3 + IT green |
| Strings | ✅ Готово | EN + RU |
| DI Modules | ⏳ TODO | Hilt modules |
| Repositories | ⏳ TODO | Data layer |
| ViewModels | ⏳ TODO | Business logic |
| Screens | ⏳ TODO | UI screens |
| Navigation | ⏳ TODO | Compose navigation |

## 🎨 Дизайн

### Цвета
- Primary: Italian Green (#009246)
- Success: #10B981
- Warning: #F59E0B
- Error: #EF4444

### Экраны
1. **Login** - Email/Password + QR login
2. **Events List** - Список мероприятий
3. **Checkin** - Поиск и регистрация участников

## 🔥 Преимущества vs React Native

1. ✅ **Нет npm конфликтов** - стабильные Gradle зависимости
2. ✅ **Нативная производительность** - прямой Android код
3. ✅ **Bluetooth работает** - нативный Android Bluetooth API
4. ✅ **Меньший размер APK** - ~10-15 МБ vs 50+ МБ
5. ✅ **Лучшая отладка** - Android Studio инструменты
6. ✅ **Быстрая сборка** - без Metro bundler

## 📝 Следующие шаги

1. Создать DI modules (NetworkModule, RepositoryModule)
2. Создать Repositories (AuthRepository, EventRepository)
3. Создать Navigation (NavHost + Routes)
4. Создать LoginScreen + ViewModel
5. Создать EventsScreen + ViewModel
6. Создать CheckinScreen + ViewModel
7. Добавить Camera QR scanning
8. Добавить Bluetooth printing

## ⏱️ Оценка времени

- **DI + Repositories**: 30 минут
- **Navigation**: 15 минут  
- **Login Screen**: 1 час
- **Events Screen**: 1 час
- **Checkin Screen**: 1.5 часа
- **Camera QR**: 30 минут
- **Bluetooth**: 1 час

**Итого**: ~5.5 часов для полного функционала

## Lint

Run Android Lint from the project root:

```bash
./scripts/lint-mobile.sh
```

Or from this directory: `./gradlew lint`

## 🚀 Готово к разработке!

Базовая структура создана. Теперь можно открыть проект в Android Studio и продолжить разработку.

**Статус**: 🟢 Готов к разработке в Android Studio
