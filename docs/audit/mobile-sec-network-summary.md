# Mobile High-sec — сеть и логирование (MOBILE-SEC-01, MOBILE-SEC-02)

Дата: 2026-07-10. Ветка: `audit/mobile-sec-01-02-network`.

## Ключевой структурный факт

Мобильный код — **два параллельных стека**:

- **`mobile/android-app` (`:app`)** — реально отгружаемое Android-приложение: **Hilt + Retrofit + OkHttp + обычный DataStore**. Не зависит от `:shared`.
- **`mobile/shared` (`:shared`)** — **Koin + Ktor**, это код iOS-приложения (iOS целиком работает через `:shared`). Android-часть `:shared` — мёртвый код (не потребляется `:app`).

Поэтому каждая находка чинится **в обоих стеках**.

## MOBILE-SEC-01 — Cleartext-трафик + prod-URL нигде не используется (High)

| Стек | Было | Стало |
|---|---|---|
| Android `:app` | `usesCleartextTraffic="true"` глобально; `NetworkModule` хардкодит `http://10.0.2.2:8080/` | Удалён `usesCleartextTraffic`; `network_security_config.xml` через **variant-split**: `src/main` (release) полностью запрещает cleartext (`base-config cleartextTrafficPermitted="false"`); `src/debug` дополнительно разрешает cleartext только для `10.0.2.2`/`localhost`/`127.0.0.1`. (Первоначальный `debug-overrides`-подход отклоняется Android-линтом — вложенный `domain-config` там запрещён; variant-split даёт полностью cleartext-free release.) `BuildConfig.BASE_URL`: debug=`http://10.0.2.2:8080/`, release=`https://api.idento.app/`; Retrofit читает его |
| iOS `:shared` | `getDefaultBaseUrl()` всегда dev HTTP; `PROD_BASE_URL` объявлен, но не используется | Введён `expect/actual isDebugBuild()` (iOS → `Platform.isDebugBinary`, Android → `BuildConfig.DEBUG`); `getDefaultBaseUrl()` = `resolveBaseUrl(isDebugBuild(), dev, PROD_BASE_URL)` → в release отдаёт prod HTTPS. (На iOS cleartext и так блокируется ATS по умолчанию — ATS-исключений в Info.plist нет.) |

## MOBILE-SEC-02 — Полное логирование тела/заголовков HTTP (JWT + пароль) без гейтинга (High)

| Стек | Было | Стало |
|---|---|---|
| Android `:app` | `HttpLoggingInterceptor.Level.BODY` безусловно (логировал `Authorization: Bearer …` и тело логина с паролем в Logcat, в т.ч. в release) | `Level.HEADERS` в debug / `Level.NONE` в release + `redactHeader("Authorization")` + `redactHeader("Cookie")` |
| iOS `:shared` | Ktor `LogLevel.BODY` безусловно | `logLevelFor(isDebugBuild())` = `HEADERS`/`NONE` + `sanitizeHeader { it == Authorization }` |

**Почему HEADERS, а не BODY даже в debug:** пароль передаётся в теле запроса логина, JWT — в теле ответа; `HEADERS` не логирует тела вовсе, а bearer-токен в заголовке редактируется. Так требование находки «никогда не логировать сырые пароли/токены даже в debug» выполняется полностью.

## Проверка

| Проверка | Результат |
|---|---|
| `:app:assembleDebug` | BUILD SUCCESSFUL |
| release-манифест | `networkSecurityConfig` присутствует, `usesCleartextTraffic` отсутствует |
| debug/release `BuildConfig.BASE_URL` | `http://10.0.2.2:8080/` / `https://api.idento.app/` |
| `:shared:compileDebugKotlinAndroid` | BUILD SUCCESSFUL |
| `:shared:compileKotlinIosSimulatorArm64` | BUILD SUCCESSFUL |
| `:shared:testDebugUnitTest` (`NetworkConfigTest`) | 3 passed / 0 failed (dev-в-debug, prod-HTTPS-в-release, HEADERS/NONE + `HEADERS.body==false`) |

Проверка выполнена на macOS с Android SDK (`~/Library/Android/sdk`) и Xcode 26.2. Оба стека собираются; чистые pure-функции (`resolveBaseUrl`, `logLevelFor`) покрыты unit-тестами в `commonTest`.

## Осознанно отложено

- **MOBILE-SEC-03** (шифрование JWT на диске — Android Keystore + iOS Keychain) — отдельным PR (риск выше, верификация только на уровне компиляции).
- Debug-сборки не доверяют пользовательским CA (нельзя MITM-снифать HTTPS прокси на устройстве в debug) — сознательно, это не регрессия безопасности.
- `RECEIVE_BOOT_COMPLETED` без ресивера (MOBILE-SEC-05, Low), backup-правила (MOBILE-SEC-04, Low) — Фаза Low.
