# План: Фаза 2A — Обновление зависимостей Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Обновить все уязвимые и устаревшие зависимости во всех 6 подсистемах Idento до безопасных версий по 16 партиям из Раздела 5 отчёта аудита, малыми проверяемыми шагами.

**Architecture:** Работа в ветке `audit/phase2a-deps` от `main`. Каждая партия — отдельная задача: правка манифеста → пересборка/переразрешение → сборка → повторный прогон сканера, подтверждающий закрытие уязвимости → коммит. Обновления идут малыми партиями (партия = группа связанных пакетов), чтобы регрессия была видна сразу и откат был тривиален. Это Фаза 2A аудита; кодовые security-фиксы — отдельными планами 2B (Go) и 2C (frontend).

**Tech Stack:** Go 1.26 (`go get`, `govulncheck`), npm (`npm audit`, `npm install`), Cargo (`cargo update`), Gradle (version catalog / build.gradle.kts).

## Global Constraints

- Ветка: `audit/phase2a-deps` от `main`. Все коммиты Фазы 2A — в неё.
- **Только обновление зависимостей.** Кодовые правки логики в этой фазе не выполняются (они в планах 2B/2C). Единственные разрешённые правки кода — вынужденные адаптации к breaking changes при minor-обновлении, и только если без них не собирается; каждую такую правку отметить в отчёте задачи.
- **Политика обновления (дословно из спека):** «все minor/patch и все security-фиксы обязательны; мажорные версии — только если текущая версия уязвима или больше не поддерживается». Опциональные мажоры (React 18→19, AGP 9.x, retrofit 3.x, okhttp 5.x, i18next major) в этот план НЕ входят — они без CVE.
- **Критерий готовности партии:** манифест обновлён + подсистема собирается + для security-партий сканер (`govulncheck` / `npm audit` / OSV-проверка) подтверждает закрытие целевых уязвимостей + существующие тесты (где есть) зелёные.
- **Тестов в репозитории почти нет** (0 тестовых файлов в backend, agent, web, desktop, mobile; в landing — 1 Playwright-тест, сейчас сломанный и не подключённый к CI). Поэтому основной критерий для большинства задач — **сборка проходит + сканер чист**. Где тестов нет, это указано в задаче явно.
- **Mobile-сборка — best-effort:** Android-сборка Gradle обязательна, если тулчейн доступен; при отсутствии Android SDK/тулчейна факт фиксируется в отчёте задачи и не блокирует партию (сверка версий в манифесте остаётся обязательной). iOS-сборка не требуется.
- **Приоритет партий (из Раздела 6 отчёта):** обязательные security-партии 1, 2/5, 7, 8, 10 — вперёд; рутинные 3, 6, 9, 11, 14, 15 — плановая работа; крупные 12, 13, 16 — в конце, с явными предупреждениями об объёме.
- Целевые версии — дословно из `docs/audit/raw/versions-current.md` и Раздела 5 отчёта `docs/audit/2026-07-09-audit-report.md`.

---

### Task 1: Ветка и baseline-проверка сканеров

**Files:**
- Create (git): ветка `audit/phase2a-deps`

**Interfaces:**
- Produces: чистая ветка от `main` + зафиксированные исходные показания сканеров (для сравнения «до/после»).

- [ ] **Step 1: Создать ветку от main**

```bash
cd /Users/thevladbog/PRSOME/idento
git fetch origin
git checkout -b audit/phase2a-deps origin/main
```

- [ ] **Step 2: Зафиксировать baseline govulncheck (backend + agent)**

Run:
```bash
(cd backend && govulncheck ./... 2>&1 | grep -E 'Vulnerability #|No vulnerabilities' | head)
(cd agent && govulncheck ./... 2>&1 | grep -E 'Vulnerability #|No vulnerabilities' | head)
```
Expected: backend показывает 3 достижимые уязвимости (GO-2026-5856, GO-2026-5004, GO-2026-4970); agent — 2 (GO-2026-5856, GO-2026-4970). Это исходное состояние — запомнить, задачи 2–4 будут его улучшать.

- [ ] **Step 3: Зафиксировать baseline npm audit (web, landing, desktop)**

Run:
```bash
for p in web landing desktop; do echo "== $p =="; (cd $p && npm audit 2>/dev/null | grep -E 'vulnerabilities' | tail -1); done
```
Expected: web ~16, desktop ~16, landing ~11 уязвимостей. Исходное состояние.

- [ ] **Step 4: Коммит-маркер (пустой) для читаемой истории — пропустить, если нечего коммитить**

Ветка создана; переходим к Задаче 2. (Коммитов на этом шаге нет — только фиксация показаний в отчёте задачи.)

---

### Task 2: Backend — pgx v5.7.6 → v5.10.0 (Партия 1, обязательно, безопасность)

**Files:**
- Modify: `backend/go.mod`, `backend/go.sum`

**Interfaces:**
- Consumes: ветка из Task 1.
- Produces: pgx на v5.10.0; закрыты GO-2026-5004 (достижимая SQL-инъекция) и CVE-2026-33816 (недостижимая memory-safety).

- [ ] **Step 1: Обновить pgx**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/backend
go get github.com/jackc/pgx/v5@v5.10.0
go mod tidy
```

- [ ] **Step 2: Собрать backend**

Run: `cd /Users/thevladbog/PRSOME/idento/backend && go build ./...`
Expected: сборка без ошибок. Если pgx v5.10.0 внёс breaking change в используемый API (маловероятно для minor), зафиксировать в отчёте и внести минимальную адаптацию.

- [ ] **Step 3: Подтвердить закрытие уязвимости сканером**

Run: `cd /Users/thevladbog/PRSOME/idento/backend && govulncheck ./... 2>&1 | grep -E 'GO-2026-5004|GHSA-9jj7|No vulnerabilities|Vulnerability #'`
Expected: GO-2026-5004 больше НЕ в списке достижимых; остаются только два stdlib-ID (GO-2026-5856, GO-2026-4970) — их закроет Task 3.

- [ ] **Step 4: Коммит**

```bash
cd /Users/thevladbog/PRSOME/idento
git add backend/go.mod backend/go.sum
git commit -m "deps(backend): bump pgx v5.7.6 -> v5.10.0 (fixes GO-2026-5004 SQL injection, CVE-2026-33816)"
```

---

### Task 3: Backend + Agent — Go toolchain go1.26.4 → go1.26.5 (Партии 2 и 5, обязательно, безопасность)

**Files:**
- Modify: `backend/go.mod` (директива `toolchain`), `agent/go.mod` (директива `toolchain`), `go.work` при необходимости

**Interfaces:**
- Consumes: ветка с обновлённым pgx (Task 2).
- Produces: обе Go-подсистемы собираются go1.26.5; закрыты GO-2026-5856 (`crypto/tls`) и GO-2026-4970 (`os`) в backend и agent.

- [ ] **Step 1: Закрепить тулчейн go1.26.5 в обоих модулях**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/backend && go get go@1.26.5 && go mod tidy
cd /Users/thevladbog/PRSOME/idento/agent && go get go@1.26.5 && go mod tidy
```
Это добавит/обновит директиву `toolchain go1.26.5` в обоих `go.mod`. Go при необходимости сам скачает тулчейн. Если `go get go@1.26.5` не поддерживается локальной версией go, вручную добавить строку `toolchain go1.26.5` в оба `backend/go.mod` и `agent/go.mod` после строки `go 1.25.4`.

- [ ] **Step 2: Собрать обе подсистемы**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/backend && go build ./...
cd /Users/thevladbog/PRSOME/idento/agent && go build ./...
```
Expected: обе собираются без ошибок на go1.26.5.

- [ ] **Step 3: Подтвердить закрытие stdlib-уязвимостей**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/backend && govulncheck ./... 2>&1 | grep -E 'GO-2026-5856|GO-2026-4970|No vulnerabilities' 
cd /Users/thevladbog/PRSOME/idento/agent && govulncheck ./... 2>&1 | grep -E 'GO-2026-5856|GO-2026-4970|No vulnerabilities'
```
Expected: backend — «No vulnerabilities found» (после Task 2 pgx уже закрыт, теперь и stdlib); agent — «No vulnerabilities found». Если что-то осталось достижимым — зафиксировать в отчёте.

- [ ] **Step 4: Коммит**

```bash
cd /Users/thevladbog/PRSOME/idento
git add backend/go.mod agent/go.mod go.work go.work.sum
git commit -m "deps(backend,agent): bump Go toolchain go1.26.4 -> go1.26.5 (fixes GO-2026-5856 crypto/tls, GO-2026-4970 os)"
```

---

### Task 4: Backend + Agent — рутинные minor/patch (Партии 3 и 6)

**Files:**
- Modify: `backend/go.mod`, `backend/go.sum`, `agent/go.mod`, `agent/go.sum`

**Interfaces:**
- Consumes: ветка после Task 3 (govulncheck чист).
- Produces: echo, golang-jwt, x/crypto, serial подняты до актуальных minor/patch; сканер остаётся чистым.

- [ ] **Step 1: Обновить рутинные пакеты backend**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/backend
go get github.com/labstack/echo/v4@v4.15.4
go get github.com/golang-jwt/jwt/v5@v5.3.1
go get golang.org/x/crypto@v0.54.0
go mod tidy
```

- [ ] **Step 2: Обновить рутинный пакет agent**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/agent
go get go.bug.st/serial@v1.7.1
go mod tidy
```

- [ ] **Step 3: Собрать обе подсистемы**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/backend && go build ./...
cd /Users/thevladbog/PRSOME/idento/agent && go build ./...
```
Expected: обе собираются. Echo v4.13→v4.15 — minor, breaking changes маловероятны; при ошибке компиляции внести минимальную адаптацию и отметить в отчёте.

- [ ] **Step 4: Подтвердить, что сканер по-прежнему чист**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/backend && govulncheck ./... 2>&1 | tail -1
cd /Users/thevladbog/PRSOME/idento/agent && govulncheck ./... 2>&1 | tail -1
```
Expected: «No vulnerabilities found» в обеих.

- [ ] **Step 5: Коммит**

```bash
cd /Users/thevladbog/PRSOME/idento
git add backend/go.mod backend/go.sum agent/go.mod agent/go.sum
git commit -m "deps(backend,agent): routine minor/patch bumps (echo 4.15.4, jwt 5.3.1, x/crypto 0.54.0, serial 1.7.1)"
```

Примечание по Партии 4 (`skip2/go-qrcode`): версия НЕ обновляется (новых тегов с 2020 нет) — это риск сопровождения, не CVE. Оставить как есть; оценка замены — отдельным тикетом из Backlog (Раздел 7 отчёта). В этой задаче ничего не делаем.

---

### Task 5: JS — прямые security-зависимости (Партия 7, обязательно, безопасность)

**Files:**
- Modify: `web/package.json`, `web/package-lock.json`, `desktop/package.json`, `desktop/package-lock.json`, `landing/package.json`, `landing/package-lock.json`

**Interfaces:**
- Consumes: ветка после Task 4.
- Produces: vite, axios, react-router-dom (web+desktop), next, next-intl (landing) подняты до безопасных версий.

- [ ] **Step 1: Обновить прямые зависимости web и desktop**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/web
npm install vite@^7.3.6 axios@^1.18.1 react-router-dom@^7.18.1
cd /Users/thevladbog/PRSOME/idento/desktop
npm install vite@^7.3.6 axios@^1.18.1 react-router-dom@^7.18.1
```

- [ ] **Step 2: Обновить прямые зависимости landing**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/landing
npm install next@^16.2.10 next-intl@^4.9.2
```

- [ ] **Step 3: Собрать все три проекта**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/web && npm run build
cd /Users/thevladbog/PRSOME/idento/desktop && npm run build
cd /Users/thevladbog/PRSOME/idento/landing && npm run build
```
Expected: все три собираются (`tsc -b && vite build` для web/desktop; `next build` для landing). vite 7.x — patch внутри мажора, breaking changes не ожидаются. При ошибке — минимальная адаптация, отметить в отчёте.

- [ ] **Step 4: Проверить снижение уязвимостей**

Run:
```bash
for p in web desktop landing; do echo "== $p =="; (cd /Users/thevladbog/PRSOME/idento/$p && npm audit 2>/dev/null | grep -iE 'high|vulnerabilities' | tail -2); done
```
Expected: число high-уязвимостей заметно снизилось (axios/vite/react-router/next high закрыты). Часть транзитивных останется до Task 6.

- [ ] **Step 5: Коммит**

```bash
cd /Users/thevladbog/PRSOME/idento
git add web/package.json web/package-lock.json desktop/package.json desktop/package-lock.json landing/package.json landing/package-lock.json
git commit -m "deps(js): bump direct security deps (vite 7.3.6, axios 1.18.1, react-router-dom 7.18.1, next 16.2.10, next-intl 4.9.2)"
```

---

### Task 6: JS — транзитивные security-зависимости через npm audit fix (Партия 8, обязательно, безопасность)

**Files:**
- Modify: `web/package-lock.json`, `desktop/package-lock.json`, `landing/package-lock.json` (и, возможно, `package.json` при использовании overrides)

**Interfaces:**
- Consumes: ветка после Task 5.
- Produces: транзитивные пакеты (flatted, minimatch, picomatch, form-data, rollup, ajv, brace-expansion, follow-redirects, js-yaml, postcss, @babel/core, esbuild, icu-minify) подняты до безопасных версий; `npm audit` без high.

- [ ] **Step 1: Прогнать npm audit fix в каждом проекте**

Run:
```bash
for p in web desktop landing; do echo "== $p =="; (cd /Users/thevladbog/PRSOME/idento/$p && npm audit fix); done
```
`npm audit fix` (без `--force`) поднимает только совместимые (non-breaking) версии — именно то, что нужно.

- [ ] **Step 2: Для оставшихся high добавить overrides при необходимости**

Run: `for p in web desktop landing; do echo "== $p =="; (cd /Users/thevladbog/PRSOME/idento/$p && npm audit 2>/dev/null | grep -iE 'high' | tail -3); done`

Если после `npm audit fix` остаются high-уязвимости в транзитивных пакетах (частая причина — родитель ещё не выпустил релиз), добавить в `package.json` соответствующего проекта секцию `overrides` с минимальной безопасной версией из Раздела 4.2 отчёта. Пример для web (вставить целевые версии из отчёта):

```jsonc
// в web/package.json и/или desktop/package.json, landing/package.json
"overrides": {
  "flatted": ">=3.4.2",
  "minimatch": ">=9.0.7",
  "picomatch": ">=4.0.4",
  "form-data": ">=4.0.6",
  "rollup": ">=4.62.2",
  "ajv": ">=6.14.0",
  "brace-expansion": ">=2.0.3",
  "follow-redirects": ">=1.16.0",
  "js-yaml": ">=4.2.0",
  "postcss": ">=8.5.16",
  "@babel/core": ">=7.29.6",
  "esbuild": ">=0.28.1"
}
```
Затем `npm install` в этом проекте. Для landing добавить `"icu-minify": ">=4.9.2"`. Добавлять в `overrides` ТОЛЬКО те пакеты, что реально остались в `npm audit` данного проекта — не копировать список вслепую.

- [ ] **Step 3: Пересобрать все три проекта**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/web && npm run build
cd /Users/thevladbog/PRSOME/idento/desktop && npm run build
cd /Users/thevladbog/PRSOME/idento/landing && npm run build
```
Expected: все три собираются. overrides транзитивных build-инструментов могут потребовать проверки, что сборка не сломалась — это и есть смысл шага.

- [ ] **Step 4: Подтвердить отсутствие high/critical**

Run: `for p in web desktop landing; do echo "== $p =="; (cd /Users/thevladbog/PRSOME/idento/$p && npm audit 2>/dev/null | grep -E 'vulnerabilities' | tail -1); done`
Expected: 0 high и 0 critical во всех трёх (moderate/low допустимы — они не входят в обязательную политику; отметить остаток в отчёте).

- [ ] **Step 5: Коммит**

```bash
cd /Users/thevladbog/PRSOME/idento
git add web/package.json web/package-lock.json desktop/package.json desktop/package-lock.json landing/package.json landing/package-lock.json
git commit -m "deps(js): fix transitive vulnerabilities via npm audit fix + overrides (0 high/critical)"
```

---

### Task 7: Rust/Tauri — tauri =2.9.1 → 2.11.5 + tauri-build (Партии 10 и 11, обязательно, безопасность)

**Files:**
- Modify: `desktop/src-tauri/Cargo.toml`, `desktop/src-tauri/Cargo.lock`

**Interfaces:**
- Consumes: ветка после Task 6.
- Produces: tauri на 2.11.5 (закрыт CVE-2026-42184 Origin Confusion), tauri-build на 2.6.3.

- [ ] **Step 1: Обновить версии в Cargo.toml**

В `desktop/src-tauri/Cargo.toml` изменить закреплённую версию `tauri = { version = "=2.9.1", ... }` на `tauri = { version = "2.11.5", ... }` (сохранив список features как есть). Обновить `tauri-build = { version = "2.5", ... }` на `tauri-build = { version = "2.6.3", ... }`.

- [ ] **Step 2: Переразрешить Cargo.lock**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/desktop/src-tauri
cargo update -p tauri --precise 2.11.5
cargo update -p tauri-build --precise 2.6.3
```

- [ ] **Step 3: Собрать Rust-часть**

Run: `cd /Users/thevladbog/PRSOME/idento/desktop/src-tauri && cargo build`
Expected: сборка проходит. tauri 2.9→2.11 — minor, публичный API стабилен; при ошибке компиляции внести минимальную адаптацию и отметить в отчёте. Если тулчейн Rust/системные зависимости webkit недоступны локально — зафиксировать best-effort в отчёте (аналогично mobile), но версии в Cargo.toml/Cargo.lock должны быть обновлены и корректны.

- [ ] **Step 4: Подтвердить целевую версию**

Run: `cd /Users/thevladbog/PRSOME/idento/desktop/src-tauri && grep -A1 '^name = "tauri"' Cargo.lock | grep version`
Expected: `version = "2.11.5"` (или выше в рамках 2.11.x) — CVE-2026-42184 закрыт (fix ≥2.11.1).

- [ ] **Step 5: Коммит**

```bash
cd /Users/thevladbog/PRSOME/idento
git add desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock
git commit -m "deps(desktop): bump tauri 2.9.1 -> 2.11.5 (fixes CVE-2026-42184), tauri-build 2.6.3"
```

---

### Task 8: JS — рутинные minor/patch (Партия 9, housekeeping)

**Files:**
- Modify: `web/package.json`, `web/package-lock.json`, `desktop/package.json`, `desktop/package-lock.json`, `landing/package.json`, `landing/package-lock.json`

**Interfaces:**
- Consumes: ветка после Task 7.
- Produces: Radix UI, tailwindcss, framer-motion, @tauri-apps/api, react/react-dom (patch), i18next (в рамках мажора) подняты до актуальных minor/patch. Опциональные мажоры НЕ трогаем.

- [ ] **Step 1: Обновить minor/patch, не пересекая мажорные границы**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/web && npm update
cd /Users/thevladbog/PRSOME/idento/desktop && npm update && npm install @tauri-apps/api@^2.11.1
cd /Users/thevladbog/PRSOME/idento/landing && npm update
```
`npm update` соблюдает семвер-диапазоны из package.json и НЕ переходит на новый мажор — ровно то, что требует политика (react 18→19, i18next major остаются нетронутыми). tailwindcss/framer-motion/@radix-ui поднимутся в рамках своих мажоров.

- [ ] **Step 2: Собрать все три проекта**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/web && npm run build
cd /Users/thevladbog/PRSOME/idento/desktop && npm run build
cd /Users/thevladbog/PRSOME/idento/landing && npm run build
```
Expected: все три собираются.

- [ ] **Step 3: Подтвердить, что аудит по-прежнему без high/critical**

Run: `for p in web desktop landing; do echo "== $p =="; (cd /Users/thevladbog/PRSOME/idento/$p && npm audit 2>/dev/null | grep -E 'vulnerabilities' | tail -1); done`
Expected: 0 high/critical сохраняется.

- [ ] **Step 4: Коммит**

```bash
cd /Users/thevladbog/PRSOME/idento
git add web/package.json web/package-lock.json desktop/package.json desktop/package-lock.json landing/package.json landing/package-lock.json
git commit -m "deps(js): routine minor/patch bumps (radix, tailwind, framer-motion, tauri-api, i18next within major)"
```

---

### Task 9: Mobile — Kotlin/AGP/Compose toolchain (Партия 12)

**Files:**
- Modify: `mobile/android-app/build.gradle.kts`, `mobile/android-app/app/build.gradle.kts`, `mobile/shared/build.gradle.kts` (версии, объявленные литералами — каталог `libs.versions.toml` не используется, см. Task 12)

**Interfaces:**
- Consumes: ветка после Task 8.
- Produces: kotlin 2.4.0, AGP 8.13.2 (в рамках 8.x), Compose MP gradle-плагин 1.11.1.

- [ ] **Step 1: Найти и обновить версии toolchain в build.gradle.kts**

В `mobile/android-app/build.gradle.kts`, `mobile/android-app/app/build.gradle.kts`, `mobile/shared/build.gradle.kts` найти жёстко прописанные версии и обновить:
- Kotlin plugin `2.1.0` → `2.4.0` (все места объявления `kotlin("...")` / `org.jetbrains.kotlin.*` version)
- AGP `com.android.application`/`com.android.library` `8.7.2` → `8.13.2`
- Compose Multiplatform gradle-плагин `org.jetbrains.compose` `1.7.3` → `1.11.1` (если объявлен)

Используй инвентарь `docs/audit/raw/mobile-deps.md` как карту точных мест объявления каждой версии.

- [ ] **Step 2: Собрать Android (best-effort)**

Run: `cd /Users/thevladbog/PRSOME/idento/mobile/android-app && ./gradlew :app:assembleDebug --offline 2>&1 | tail -20 || ./gradlew :app:assembleDebug 2>&1 | tail -20`
Expected: сборка проходит. Kotlin 2.1→2.4 может потребовать согласования версии Compose compiler (в Kotlin 2.x встроен в Kotlin Gradle Plugin) — если сборка ругается на compiler compatibility, согласовать по матрице совместимости и отметить в отчёте. **Если Android SDK/Gradle-тулчейн недоступен локально** — зафиксировать в отчёте как best-effort и подтвердить корректность версий в манифестах вручную (Step 3).

- [ ] **Step 3: Подтвердить версии в манифестах**

Run: `cd /Users/thevladbog/PRSOME/idento && grep -rnE '2\.4\.0|8\.13\.2|1\.11\.1' mobile/*/build.gradle.kts mobile/*/*/build.gradle.kts`
Expected: обновлённые версии присутствуют в ожидаемых местах.

- [ ] **Step 4: Коммит**

```bash
cd /Users/thevladbog/PRSOME/idento
git add mobile/android-app/build.gradle.kts mobile/android-app/app/build.gradle.kts mobile/shared/build.gradle.kts
git commit -m "deps(mobile): bump Kotlin 2.4.0, AGP 8.13.2, Compose MP 1.11.1"
```

---

### Task 10: Mobile — сетевой/сериализационный стек (Партия 14) + HTTP-клиент patch (Партия 15)

**Files:**
- Modify: `mobile/shared/build.gradle.kts`, `mobile/android-app/app/build.gradle.kts`

**Interfaces:**
- Consumes: ветка после Task 9.
- Produces: ktor 3.5.1, kotlinx-serialization-json 1.11.0, kotlinx-coroutines 1.11.0, retrofit 2.12.0 (в рамках 2.x). Опциональные мажоры (retrofit 3.x, okhttp 5.x) НЕ трогаем.

- [ ] **Step 1: Обновить сетевой стек в shared**

В `mobile/shared/build.gradle.kts` обновить литеральные версии:
- `io.ktor:ktor-client-*` `3.0.2` → `3.5.1` (все ktor-артефакты — одной версией)
- `org.jetbrains.kotlinx:kotlinx-serialization-json` `1.7.3` → `1.11.0`
- `org.jetbrains.kotlinx:kotlinx-coroutines-*` `1.9.0` → `1.11.0`

- [ ] **Step 2: Обновить retrofit в android-app (patch в рамках 2.x)**

В `mobile/android-app/app/build.gradle.kts` обновить `com.squareup.retrofit2:retrofit` (и связанные конвертеры) `2.11.0` → `2.12.0`. okhttp оставить `4.12.0` (уже актуальный в рамках 4.x; мажор 5.x опционален, без CVE — не трогаем).

- [ ] **Step 3: Собрать (best-effort)**

Run: `cd /Users/thevladbog/PRSOME/idento/mobile/android-app && ./gradlew :app:assembleDebug 2>&1 | tail -20`
Expected: сборка проходит (или best-effort, если тулчейн недоступен — зафиксировать). ktor 3.0→3.5 и coroutines/serialization minor — breaking changes маловероятны.

- [ ] **Step 4: Подтвердить версии**

Run: `cd /Users/thevladbog/PRSOME/idento && grep -rnE '3\.5\.1|1\.11\.0|2\.12\.0' mobile/shared/build.gradle.kts mobile/android-app/app/build.gradle.kts`
Expected: обновлённые версии присутствуют.

- [ ] **Step 5: Коммит**

```bash
cd /Users/thevladbog/PRSOME/idento
git add mobile/shared/build.gradle.kts mobile/android-app/app/build.gradle.kts
git commit -m "deps(mobile): bump ktor 3.5.1, kotlinx-serialization 1.11.0, coroutines 1.11.0, retrofit 2.12.0"
```

---

### Task 11: Mobile — Compose BOM 2024.11.00 → 2026.06.01 (Партия 13, крупная — с предупреждением)

**Files:**
- Modify: `mobile/android-app/app/build.gradle.kts`

**Interfaces:**
- Consumes: ветка после Task 10.
- Produces: Compose BOM на 2026.06.01 (~19 релизов вперёд).

⚠️ **Предупреждение об объёме:** BOM тянет за собой все compose-артефакты; скачок в ~19 релизов может задеть UI-код (deprecations в material3/foundation API). Это самая рискованная партия обновлений. Выполнять отдельной задачей, тщательно проверяя сборку. Если ломается много UI — остановиться, зафиксировать объём и вынести в отдельный тикет (как и предполагает Раздел 5.5 отчёта), не форсируя.

- [ ] **Step 1: Обновить BOM**

В `mobile/android-app/app/build.gradle.kts` обновить обе строки `platform("androidx.compose:compose-bom:2024.11.00")` (основная и `androidTest`) → `2026.06.01`.

- [ ] **Step 2: Собрать (best-effort) и оценить объём поломок**

Run: `cd /Users/thevladbog/PRSOME/idento/mobile/android-app && ./gradlew :app:assembleDebug 2>&1 | tail -40`
Expected: либо сборка проходит, либо список deprecation/breaking-ошибок. Если ошибок ≤ нескольких и они тривиальны (переименованные API) — исправить минимально, отметить в отчёте. **Если ошибок много** — вернуть BOM на 2024.11.00, зафиксировать в отчёте статус BLOCKED с оценкой объёма и рекомендацией отдельного тикета; НЕ форсировать в рамках этой партии.

- [ ] **Step 3: Коммит (только если сборка зелёная или правки тривиальны)**

```bash
cd /Users/thevladbog/PRSOME/idento
git add mobile/android-app/app/build.gradle.kts
git commit -m "deps(mobile): bump Compose BOM 2024.11.00 -> 2026.06.01"
```

---

### Task 12: Mobile — housekeeping version catalog (Партия 16, структурный)

**Files:**
- Modify: `mobile/android-app/settings.gradle.kts` (подключение каталога) или удаление `mobile/android-app/gradle/libs.versions.toml`

**Interfaces:**
- Consumes: ветка после Task 11.
- Produces: мёртвый `libs.versions.toml` либо подключён и используется, либо удалён — устранено расхождение «каталог vs реальные версии» (MOBILE-QUAL-11).

- [ ] **Step 1: Принять решение по каталогу и выполнить**

Каталог `mobile/android-app/gradle/libs.versions.toml` сейчас не используется (0 ссылок `libs.` в build-файлах), а его версии разошлись с реальными. Два допустимых исхода:
- **(a) Удалить каталог** (проще, если команда не планирует им пользоваться): `git rm mobile/android-app/gradle/libs.versions.toml`. Это устраняет расхождение и вводящий в заблуждение мёртвый файл.
- **(b) Актуализировать и оставить** каталог, приведя его версии в соответствие с реальными (обновлёнными в Task 9–11) — только если команда намерена мигрировать build-файлы на каталог позже.

По умолчанию выбрать **(a)** — удаление, т.к. миграция на каталог не входит в охват Фазы 2A и относится к Фазе 4 (MOBILE-QUAL-11). Зафиксировать выбор в отчёте задачи.

- [ ] **Step 2: Подтвердить, что сборка не зависела от каталога**

Run: `cd /Users/thevladbog/PRSOME/idento && grep -rn 'libs\.' mobile/*/build.gradle.kts mobile/*/*/build.gradle.kts mobile/*/settings.gradle.kts || echo 'нет ссылок на каталог — удаление безопасно'`
Expected: «нет ссылок на каталог» — подтверждает, что удаление ничего не ломает.

- [ ] **Step 3: Коммит**

```bash
cd /Users/thevladbog/PRSOME/idento
git add -A mobile/android-app/gradle/ mobile/android-app/settings.gradle.kts
git commit -m "deps(mobile): remove unused/divergent Gradle version catalog (MOBILE-QUAL-11)"
```

Примечание: выравнивание расходящегося артефакта навигации (`org.jetbrains.androidx.navigation:navigation-compose:2.8.0-alpha10` в shared vs `androidx.navigation:navigation-compose:2.8.4` в android-app) — это не дрейф версии, а другой артефакт в KMP-таргете (используется и для iOS). Требует отдельного решения (см. MOBILE-QUAL-02/11) и в эту задачу НЕ входит — вынести в план Фазы 4.

---

### Task 13: Финальная верификация Фазы 2A и итог

**Files:**
- Create: `docs/audit/phase2a-deps-summary.md`

**Interfaces:**
- Consumes: ветка со всеми обновлениями (Tasks 2–12).
- Produces: сводка «до/после» по сканерам + список отложенного, для PR-описания.

- [ ] **Step 1: Прогнать все сканеры на финальном состоянии**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/backend && echo "backend:" && govulncheck ./... 2>&1 | tail -1
cd /Users/thevladbog/PRSOME/idento/agent && echo "agent:" && govulncheck ./... 2>&1 | tail -1
for p in web desktop landing; do echo "$p:"; (cd /Users/thevladbog/PRSOME/idento/$p && npm audit 2>/dev/null | grep vulnerabilities | tail -1); done
cd /Users/thevladbog/PRSOME/idento/desktop/src-tauri && echo "tauri:" && grep -A1 '^name = "tauri"' Cargo.lock | grep version
```
Expected: backend/agent — «No vulnerabilities found»; web/desktop/landing — 0 high/critical; tauri ≥2.11.1.

- [ ] **Step 2: Записать сводку**

Создать `docs/audit/phase2a-deps-summary.md` с таблицей «подсистема / было / стало» по сканерам, списком партий (выполнено/отложено — Компонент BOM и navigation-артефакт, если отложены), и остаточными moderate/low npm-уязвимостями (вне обязательной политики). Это войдёт в описание PR.

- [ ] **Step 3: Коммит и готовность к PR**

```bash
cd /Users/thevladbog/PRSOME/idento
git add docs/audit/phase2a-deps-summary.md
git commit -m "docs(audit): Phase 2A dependency-update summary (before/after scanners)"
```
После этого ветка `audit/phase2a-deps` готова к PR в `main`. Кодовые security-фиксы — планы 2B (Go) и 2C (frontend).
