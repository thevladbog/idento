# MOBILE-SEC-03 — Шифрование JWT на диске (High)

Дата: 2026-07-10. Ветка: `audit/mobile-sec-03-token-encryption`.

## Проблема

JWT (и данные пользователя) хранились в **незашифрованном** Jetpack Preferences DataStore на обеих платформах — читаемо на root-устройствах, через `adb backup`, незашифрованные бэкапы iTunes/Finder или криминалистическое извлечение. Полный доступ к аккаунту до истечения токена.

Как и в SEC-01/02, чинится в **обоих стеках** (`:app` Hilt / `:shared` Koin+iOS).

## Решение — токен переезжает в платформенное защищённое хранилище

| Стек | Механизм |
|---|---|
| **Android `:app`** (`TokenManager`) | Новый `CryptoManager`: AES-256/GCM ключ в **Android Keystore** (hardware-backed где есть, `setUserAuthenticationRequired` НЕ ставится). Значения токена/email/имени шифруются перед записью в DataStore, расшифровываются при чтении. На диск идёт `Base64(iv ‖ ciphertext)`. |
| **iOS `:shared`** | Новый `expect class SecureStore`; iOS-actual — **Keychain** (`SecItem*`, `kSecClassGenericPassword`, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` — не синхронизируется в iCloud, не мигрирует на другое устройство). `AuthPreferences` хранит **токен** в SecureStore; данные пользователя (id/email/name/role) остаются в DataStore. |
| Android-actual `SecureStore` (для `:shared`, iOS-only потребление; но корректен) | Android Keystore AES/GCM + SharedPreferences. |

**Fail-closed везде:** любая ошибка шифрования/дешифрования → `null`/`false`; вызывающий трактует это как «нет сессии» → перелогин. Это же покрывает апгрейд со старого формата.

**Миграция апгрейда:** при первом создании `AuthPreferences` фоновая best-effort миграция переносит легаси-плейнтекст-токен из DataStore (`auth_token`) в SecureStore и **удаляет плейнтекст с диска** — устраняя ровно тот незашифрованный артефакт, против которого направлен фикс, для уже установленных копий.

## Устойчивость (проверено ревью)

- **iOS cinterop**: каждый `CFDictionaryCreateMutable`/`CFBridgingRetain` сбалансирован ровно одним `CFRelease` на всех путях (включая ранние return в `memScoped`); ни утечек, ни double-free. Методы `SecureStore` не пробрасывают исключения через ObjC-границу.
- **Android GCM**: свежий 12-байтный IV на каждое шифрование, `iv‖ct` фрейминг, `@Synchronized` генерация ключа + кэш, `.commit()`.
- `putString`: кодирование значения ДО удаления старого элемента (ошибка кодирования не разрушит сохранённую сессию).

## Проверка

| Проверка | Результат |
|---|---|
| `:app:assembleDebug` (Android Keystore) | BUILD SUCCESSFUL (Hilt/KSP резолвит `CryptoManager`) |
| `:shared:compileDebugKotlinAndroid` | SUCCESSFUL |
| `:shared:compileKotlinIosSimulatorArm64` | SUCCESSFUL |
| `:shared:compileKotlinIosArm64` (device) | SUCCESSFUL |

**Ограничение верификации (честно):** Android Keystore недоступен в plain-JVM unit-тестах, а хост iOS-симулятора без entitlement’а не даёт доступ к Keychain (`SecItemAdd` → `errSecNotAvailable` / −25291). Поэтому раунд-трип Keychain/Keystore проверен **компиляцией обоих таргетов + ревью кода**, а не автотестом. Изначально добавленный `iosSimulatorArm64Test` (который не может пройти на bare-хосте) и обходной `disableNativeCache` в `build.gradle.kts` **удалены**, чтобы не коммитить заведомо красный тест и хак сборки. **Follow-up:** ручной smoke-тест в подписанном iOS-приложении (там entitlement Keychain по умолчанию есть).

## Заметки

- `authToken` теперь одноэмиссионный `flow{}` (единственный ре-экспортёр `AuthRepository.getAuthToken()` не имеет вызывающих — задокументировано).
- `:app` не зависит от `:shared`, поэтому фактически на Android работает Keystore-путь `TokenManager`, а на iOS — Keychain-путь `SecureStore`.
