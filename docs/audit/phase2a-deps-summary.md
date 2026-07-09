# Фаза 2A — Сводка обновления зависимостей (2026-07-09)

Обновление зависимостей по Разделу 5 отчёта аудита. Каждая партия проверена
сборкой + повторным прогоном сканера. Кодовые security-фиксы — отдельные планы
2B/2C.

## Результат сканеров: до → после

| Подсистема | Сканер | Было | Стало |
|---|---|---|---|
| backend | govulncheck | 3 достижимые (GO-2026-5856, GO-2026-5004, GO-2026-4970) | **No vulnerabilities found** |
| agent | govulncheck | 2 достижимые (GO-2026-5856, GO-2026-4970) | **No vulnerabilities found** |
| web | npm audit | 16 (9 high / 5 mod / 2 low) | **0 vulnerabilities** |
| desktop | npm audit | 16 (9 high / 5 mod / 2 low) | **0 vulnerabilities** |
| landing | npm audit | 11 (4 high / 5 mod / 2 low) | **0 vulnerabilities** (сделано при мерже PR #12) |
| desktop (tauri) | OSV / ручная | CVE-2026-42184 (2.9.1) | **закрыт** (tauri 2.11.5) |

Все уязвимости, помеченные сканерами в Разделе 4 отчёта, закрыты.

## Выполненные партии

| Партия | Что | Проверка |
|---|---|---|
| 1 | pgx v5.7.6 → v5.10.0 (backend) | build + govulncheck: GO-2026-5004 закрыт |
| 2/5 | Go directive 1.25.4 → 1.26.5 (backend+agent) | build + govulncheck: stdlib closed |
| 3/6 | echo 4.15.4, jwt 5.3.1, x/crypto 0.54.0, serial 1.7.1 | build + govulncheck clean |
| 7/8 | vite 7.3.6, axios 1.18.1, react-router-dom 7.18.1 + транзитивные (web/desktop) | build + npm audit: 0 |
| 9 | рутинные minor/patch (radix, tailwind, framer-motion, @tauri-apps/api 2.11.1) | build + npm audit: 0 |
| 10/11 | tauri 2.9.1 → 2.11.5, tauri-build 2.6.3 (desktop) | cargo build green; CVE-2026-42184 закрыт |
| 15 | retrofit 2.11.0 → 2.12.0 (mobile) | :app:assembleDebug green |
| 16 | удалён мёртвый version catalog (MOBILE-QUAL-11) | grep: 0 ссылок `libs.`; build green |

## Отложено (отдельной задачей)

**Партии 12, 13, 14 — координированная миграция Kotlin-тулчейна mobile.**
Причина: `kotlinx-serialization 1.11.0` / `coroutines 1.11.0` / `ktor 3.5.1`
скомпилированы под Kotlin ≥2.3 (проверено: сборка падает с «Module was compiled
with an incompatible version of Kotlin. binary version 2.3.0, expected 2.1.0»),
поэтому их нельзя обновить в отрыве от Kotlin 2.1 → 2.4. А бамп Kotlin тянет
координацию: matching KSP (2.4.0-x.y.z), Compose-плагин 2.4.0, Compose MP 1.11.1,
AGP 8.13.2 (требует Gradle wrapper ≥8.13). Всё это **не security** — аудит не
нашёл CVE в mobile-стеке. Вынесено в отдельную задачу «Mobile Kotlin 2.4 toolchain
migration», чтобы не смешивать рискованную координированную миграцию с этой
security-фокусной волной.

Сюда же отнесено выравнивание расходящегося артефакта навигации
(`org.jetbrains.androidx.navigation:navigation-compose:2.8.0-alpha10` в shared vs
`androidx.navigation:navigation-compose:2.8.4` в android-app — MOBILE-QUAL-02/11).

## Остаточные не-обязательные пункты

- Опциональные мажоры без CVE не брались (React 18→19 в web/desktop, retrofit 3.x,
  okhttp 5.x, i18next major, AGP 9.x) — вне политики Фазы 2A.
- `github.com/skip2/go-qrcode` — риск сопровождения (нет тегов с 2020), не CVE;
  оценка замены — отдельным тикетом (Backlog отчёта).
- `cargo-audit` не установлен — Rust-сторона Tauri проверена только по прямой
  зависимости `tauri` через OSV; рекомендуется добавить cargo-audit в CI.
