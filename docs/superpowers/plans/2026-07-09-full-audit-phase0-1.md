# План: Полный аудит Idento — Фазы 0–1 (baseline + аудит)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Зафиксировать baseline (`landing/` в git), просканировать все 6 подсистем на уязвимости и устаревшие зависимости, провести ручной обзор кода параллельными агентами и собрать приоритизированный отчёт находок.

**Architecture:** Работа идёт в ветке `audit/full-audit-spec`. Сначала baseline-коммит `landing/`, затем автоматические сканеры (govulncheck, npm audit, анализ Gradle), проверка актуальности версий через Context7, ручной обзор кода агентами (подсистема × измерение), адверсариальная верификация находок и сборка единого отчёта. Спек: `docs/superpowers/specs/2026-07-09-full-audit-design.md`.

**Tech Stack:** Go 1.25/1.26 + govulncheck; npm (audit/outdated); Gradle version catalog; Context7 MCP; субагенты для ревью кода.

## Global Constraints

- Ветка: `audit/full-audit-spec` (уже создана, содержит спек). Все коммиты Фаз 0–1 — в неё.
- В этих фазах **никакие исправления кода не выполняются** — только фиксация baseline, сканирование, анализ и отчёт. Исправления — Фазы 2–4 по отдельным планам.
- Политика обновлений (для рекомендаций в отчёте, дословно из спека): «все minor/patch и все security-фиксы обязательны; мажорные версии — только если текущая версия уязвима или больше не поддерживается».
- Шкала серьёзности (дословно из спека): **Critical** — эксплуатируемая уязвимость или потеря/порча данных; **High** — уязвимость с ограничивающими условиями или баг, ломающий ключевой сценарий (чек-ин, печать, логин); **Medium** — баг или слабость с обходным путём, устаревшая уязвимая зависимость без известного эксплойта; **Low** — качество кода, tech debt, некритичные устаревания.
- Артефакты аудита: сырые выводы сканеров — `docs/audit/raw/`; находки ручного обзора — `docs/audit/findings/`; итоговый отчёт — `docs/audit/2026-07-09-audit-report.md`.
- **Формат находки** (единый для всех findings-файлов, одна находка — один блок):

  ```markdown
  ### <SUBSYSTEM>-<DIM>-<NN>: <краткий заголовок>
  - Файл: <путь/к/файлу.go:строка>
  - Описание: <что не так, конкретно>
  - Влияние: <что может произойти, при каких условиях>
  - Серьёзность: Critical | High | Medium | Low
  - Уверенность: высокая | средняя | низкая
  - Рекомендация: <как чинить, 1-3 предложения>
  ```

  где `<SUBSYSTEM>` ∈ {BACKEND, AGENT, WEB, LANDING, DESKTOP, MOBILE}, `<DIM>` ∈ {SEC, BUG, QUAL}, `<NN>` — порядковый номер с 01.
- **Шаблон промпта ревью-агента** (используется в Задачах 6–8; подставить значения из таблицы задачи; агент типа `general-purpose`, режим read-only — агенту запрещено менять файлы):

  ```text
  Ты проводишь аудит подсистемы <PATH> проекта Idento (event check-in system:
  Go backend + React web + Tauri desktop + Kotlin mobile + принтер-агент).
  Измерение аудита: <DIMENSION_DESCRIPTION>.
  Прочитай код подсистемы (все исходники, начиная с точек входа: <ENTRYPOINTS>).
  Найди реальные проблемы этого измерения. НЕ выдумывай проблемы ради количества:
  лучше 3 подтверждённые находки, чем 15 спекулятивных. Для каждой находки укажи
  точный файл и строку, проверь, что код действительно ведёт себя так, как ты
  утверждаешь (прочитай вызывающий и вызываемый код).
  НЕ изменяй никакие файлы. Верни находки в формате markdown-блоков:
  ### <PREFIX>-NN: <краткий заголовок>
  - Файл: <путь:строка>
  - Описание: ...
  - Влияние: ...
  - Серьёзность: Critical | High | Medium | Low (шкала: Critical — эксплуатируемая
    уязвимость или потеря данных; High — уязвимость с условиями или баг ключевого
    сценария; Medium — проблема с обходным путём; Low — качество кода)
  - Уверенность: высокая | средняя | низкая
  - Рекомендация: ...
  Если находок нет — верни строку "Находок нет" и краткое обоснование, что именно проверено.
  ```

  Описания измерений (`<DIMENSION_DESCRIPTION>`):
  - **SEC:** «безопасность — аутентификация/авторизация (JWT, роли, QR-логин), инъекции (SQL через pgx, командные), секреты/пароли/токены в коде или логах, CORS, валидация входных данных, небезопасная работа с файлами, IDOR (доступ к чужим событиям/участникам), хранение паролей»
  - **BUG:** «корректность — логические ошибки, race conditions (горутины, конкурентный чек-ин), необработанные ошибки, nil-разыменования, краевые случаи (пустой CSV, дубликаты кодов, offline-режим), целостность данных, ошибки в транзакциях БД»
  - **QUAL:** «качество кода — дублирование, файлы >500 строк с несколькими ответственностями, слабые границы модулей, отсутствие тестов в критичных местах (что именно не покрыто), мёртвый код, несогласованная обработка ошибок»

---

### Task 1: Фаза 0 — gitignore + baseline-коммит landing/

**Files:**
- Modify: `.gitignore` (корень репозитория)
- Create (в git): всё содержимое `landing/` кроме игнорируемого

**Interfaces:**
- Produces: чистый `git status` — дальнейшие задачи коммитят только артефакты аудита.

- [ ] **Step 1: Добавить в корневой `.gitignore` правила для Watchman и Next.js**

В конец файла `.gitignore` добавить:

```gitignore

# Watchman (mobile dev)
.watchman-cookie-*

# Next.js build output (landing)
.next/
out/
next-env.d.ts
```

- [ ] **Step 2: Проверить, что мусор игнорируется, а нужное — нет**

Run: `git check-ignore mobile/.watchman-cookie-thevladbog-osx-898-12473 landing/.next landing/node_modules && git status --porcelain landing/ | head -3`
Expected: первые три пути выведены (игнорируются); `git status` показывает `?? landing/`.

- [ ] **Step 3: Закоммитить gitignore**

```bash
git add .gitignore
git commit -m "chore: ignore watchman cookies and Next.js build output"
```

- [ ] **Step 4: Baseline-коммит landing/**

```bash
git add landing/
git commit -m "feat(landing): add landing site baseline (pre-audit snapshot)"
```

- [ ] **Step 5: Проверить состав коммита**

Run: `git show --stat HEAD | tail -5 && git show --stat HEAD | grep -cE "landing/" && git show --stat HEAD | grep -E "node_modules|\.next/" | wc -l`
Expected: ~50 файлов из `landing/` (без `node_modules` и `.next` — последняя команда выводит `0`). Если в коммит попали лишние файлы — `git reset --soft HEAD~1` и исправить .gitignore.

---

### Task 2: Сканеры Go (backend + agent)

**Files:**
- Create: `docs/audit/raw/govulncheck-backend.txt`, `docs/audit/raw/govulncheck-agent.txt`, `docs/audit/raw/go-outdated-backend.txt`, `docs/audit/raw/go-outdated-agent.txt`

**Interfaces:**
- Produces: сырые отчёты сканеров для Задачи 10 (сборка отчёта).

- [ ] **Step 1: Создать каталог и запустить govulncheck**

```bash
mkdir -p docs/audit/raw
(cd backend && govulncheck ./...) > docs/audit/raw/govulncheck-backend.txt 2>&1 || true
(cd agent && govulncheck ./...) > docs/audit/raw/govulncheck-agent.txt 2>&1 || true
```

`|| true` обязателен: govulncheck возвращает ненулевой код при найденных уязвимостях — это ожидаемый результат, а не ошибка запуска.

- [ ] **Step 2: Проверить, что вывод осмысленный**

Run: `head -20 docs/audit/raw/govulncheck-backend.txt`
Expected: либо `No vulnerabilities found`, либо список `Vulnerability #N: GO-...`. Если в файле ошибка запуска (`command not found`, ошибка компиляции) — остановиться и разобраться, прежде чем продолжать.

- [ ] **Step 3: Снять список устаревших модулей**

```bash
(cd backend && go list -m -u all) > docs/audit/raw/go-outdated-backend.txt 2>&1
(cd agent && go list -m -u all) > docs/audit/raw/go-outdated-agent.txt 2>&1
```

- [ ] **Step 4: Проверить и закоммитить**

Run: `grep -c "\[" docs/audit/raw/go-outdated-backend.txt || true` (строки с `[v...]` — модули с доступным обновлением)
Expected: число ≥ 0; файлы непустые.

```bash
git add docs/audit/raw/
git commit -m "audit: raw Go scanner results (govulncheck, outdated modules)"
```

---

### Task 3: Сканеры JS (web, landing, desktop) + Rust (desktop/src-tauri)

**Files:**
- Create: `docs/audit/raw/npm-audit-web.json`, `docs/audit/raw/npm-audit-landing.json`, `docs/audit/raw/npm-audit-desktop.json`, `docs/audit/raw/npm-outdated-web.json`, `docs/audit/raw/npm-outdated-landing.json`, `docs/audit/raw/npm-outdated-desktop.json`, `docs/audit/raw/cargo-audit-desktop.txt`

**Interfaces:**
- Produces: сырые отчёты сканеров для Задачи 10.

- [ ] **Step 1: npm audit по трём проектам**

```bash
for p in web landing desktop; do
  (cd "$p" && npm audit --json) > "docs/audit/raw/npm-audit-$p.json" 2>&1 || true
done
```

- [ ] **Step 2: npm outdated по трём проектам**

```bash
for p in web landing desktop; do
  (cd "$p" && npm outdated --json) > "docs/audit/raw/npm-outdated-$p.json" 2>&1 || true
done
```

`npm outdated` возвращает код 1, когда есть устаревшие пакеты — `|| true` обязателен.

- [ ] **Step 3: Проверить валидность JSON**

Run: `for f in docs/audit/raw/npm-*.json; do python3 -c "import json;json.load(open('$f'))" && echo "OK $f"; done`
Expected: `OK` для всех шести файлов. Если какой-то файл не JSON (например, npm упал из-за отсутствия сети) — прочитать файл, устранить причину, перезапустить шаг.

- [ ] **Step 4: cargo audit для Rust-части desktop (best-effort)**

```bash
if command -v cargo-audit >/dev/null 2>&1; then
  (cd desktop/src-tauri && cargo audit) > docs/audit/raw/cargo-audit-desktop.txt 2>&1 || true
else
  echo "cargo-audit не установлен; Rust-зависимости Tauri проверены только через Context7 (Задача 5)" > docs/audit/raw/cargo-audit-desktop.txt
fi
```

- [ ] **Step 5: Закоммитить**

```bash
git add docs/audit/raw/
git commit -m "audit: raw JS/Rust scanner results (npm audit, npm outdated, cargo audit)"
```

---

### Task 4: Инвентаризация зависимостей mobile (Gradle)

**Files:**
- Create: `docs/audit/raw/mobile-deps.md`
- Read: `mobile/android-app/gradle/libs.versions.toml`, `mobile/android-app/build.gradle.kts`, `mobile/android-app/app/build.gradle.kts`, `mobile/shared/build.gradle.kts`

**Interfaces:**
- Produces: `docs/audit/raw/mobile-deps.md` — таблица зависимостей для Задач 5 и 10.

- [ ] **Step 1: Прочитать Gradle-манифесты и составить инвентарь**

Прочитать четыре файла из списка выше. Составить `docs/audit/raw/mobile-deps.md`:

```markdown
# Mobile: инвентарь зависимостей (Gradle)

Источники: mobile/android-app/gradle/libs.versions.toml,
mobile/android-app/build.gradle.kts, mobile/android-app/app/build.gradle.kts,
mobile/shared/build.gradle.kts

| Библиотека | Версия в проекте | Где объявлена |
|---|---|---|
| kotlin | <из toml> | libs.versions.toml |
| ... | ... | ... |

## Плагины
| Плагин | Версия |
|---|---|
| ... | ... |
```

Включить ВСЕ записи из `[versions]` каталога и версии из `build.gradle.kts`, объявленные вне каталога (если такие есть).

- [ ] **Step 2: Проверить полноту**

Run: `grep -c '=' mobile/android-app/gradle/libs.versions.toml && grep -c '^|' docs/audit/raw/mobile-deps.md`
Expected: число строк таблицы соизмеримо с числом записей toml (таблица не может быть в разы короче секции `[versions]` + `[plugins]`).

- [ ] **Step 3: Закоммитить**

```bash
git add docs/audit/raw/mobile-deps.md
git commit -m "audit: mobile Gradle dependency inventory"
```

---

### Task 5: Проверка актуальности версий через Context7

**Files:**
- Create: `docs/audit/raw/versions-current.md`
- Read: `backend/go.mod`, `agent/go.mod`, `web/package.json`, `landing/package.json`, `desktop/package.json`, `desktop/src-tauri/Cargo.toml`, `docs/audit/raw/mobile-deps.md`

**Interfaces:**
- Consumes: `docs/audit/raw/mobile-deps.md` (Задача 4).
- Produces: `docs/audit/raw/versions-current.md` — таблица «версия в проекте / актуальная версия / security-примечания» для Задачи 10.

- [ ] **Step 1: Собрать список ключевых библиотек с текущими версиями**

Из манифестов выписать минимум эти библиотеки (плюс всё, что сканеры пометили уязвимым):

- Go: `labstack/echo/v4`, `jackc/pgx/v5`, `golang-jwt/jwt/v5`, `golang.org/x/crypto`, `swaggo/swag`, `skip2/go-qrcode`, `go.bug.st/serial`, `rs/cors`
- JS: `react`, `react-dom`, `vite`, `axios`, `@radix-ui/*` (диапазон), `tailwindcss`, `next`, `next-intl`, `framer-motion`, `@tauri-apps/api`, `react-router-dom`, `i18next`, `react-i18next`
- Rust (Tauri): `tauri`, `tauri-build` из `desktop/src-tauri/Cargo.toml`
- Mobile: `kotlin`, AGP (`com.android.tools.build`), Compose (BOM/compiler), сетевой стек (ktor или okhttp/retrofit — что есть в инвентаре), `kotlinx-serialization`, `kotlinx-coroutines`

- [ ] **Step 2: Для каждой библиотеки получить актуальную стабильную версию и security-заметки через Context7**

Использовать MCP-инструменты Context7: `resolve-library-id` → `query-docs` (запросы вида «latest stable version», «security advisories», «migration notes from vX»). Для библиотек, которых нет в Context7, использовать WebSearch по официальным release-страницам (github releases / npm / pkg.go.dev). Источник каждой строки фиксировать.

- [ ] **Step 3: Записать результат**

Создать `docs/audit/raw/versions-current.md`:

```markdown
# Актуальность версий ключевых библиотек (проверено 2026-07-09)

| Библиотека | В проекте | Актуальная stable | Разрыв | Security-примечания | Источник |
|---|---|---|---|---|---|
| labstack/echo/v4 | v4.13.4 | <...> | minor/patch/major | <CVE или «нет известных»> | Context7 / <url> |
| ... | | | | | |

## Выводы для политики обновлений
- Обязательные (уязвимость): <список или «нет»>
- Мажор из-за прекращения поддержки: <список или «нет»>
- Обычные minor/patch: <список>
```

- [ ] **Step 4: Проверить полноту и закоммитить**

Run: `grep -c '^|' docs/audit/raw/versions-current.md`
Expected: ≥ 22 строк (все библиотеки Step 1 присутствуют).

```bash
git add docs/audit/raw/versions-current.md
git commit -m "audit: current-version check for key libraries (Context7)"
```

---

### Task 6: Ручной обзор кода — Go (backend, agent)

**Files:**
- Create: `docs/audit/findings/backend-sec.md`, `docs/audit/findings/backend-bug.md`, `docs/audit/findings/backend-qual.md`, `docs/audit/findings/agent-sec.md`, `docs/audit/findings/agent-bug.md`, `docs/audit/findings/agent-qual.md`

**Interfaces:**
- Produces: findings-файлы в едином формате (см. Global Constraints) для Задач 9–10.

- [ ] **Step 1: Запустить 6 параллельных ревью-агентов**

Использовать шаблон промпта из Global Constraints. Параметры запусков:

| Файл результата | `<PATH>` | `<DIM>` | `<PREFIX>` | `<ENTRYPOINTS>` |
|---|---|---|---|---|
| backend-sec.md | `backend/` | SEC | BACKEND-SEC | `backend/cmd/`, `backend/internal/handler/`, `backend/internal/middleware/` |
| backend-bug.md | `backend/` | BUG | BACKEND-BUG | `backend/internal/handler/`, `backend/internal/store/` |
| backend-qual.md | `backend/` | QUAL | BACKEND-QUAL | `backend/internal/` |
| agent-sec.md | `agent/` | SEC | AGENT-SEC | `agent/internal/server/` |
| agent-bug.md | `agent/` | BUG | AGENT-BUG | `agent/internal/printer/`, `agent/internal/scanner/` |
| agent-qual.md | `agent/` | QUAL | AGENT-QUAL | `agent/internal/` |

Все 6 агентов запустить одним сообщением (параллельно). Результат каждого агента записать в соответствующий файл `docs/audit/findings/` без редактирования содержимого.

- [ ] **Step 2: Проверить формат**

Run: `grep -l "^### " docs/audit/findings/backend-*.md docs/audit/findings/agent-*.md; grep -c "Серьёзность:" docs/audit/findings/backend-sec.md || true`
Expected: каждый файл либо содержит блоки `### <PREFIX>-NN`, либо строку «Находок нет» с обоснованием. Если агент вернул текст не по формату — переформатировать в единый формат, не меняя сути находок.

- [ ] **Step 3: Закоммитить**

```bash
git add docs/audit/findings/
git commit -m "audit: manual review findings for Go subsystems (backend, agent)"
```

---

### Task 7: Ручной обзор кода — JS (web, landing, desktop)

**Files:**
- Create: `docs/audit/findings/web-sec.md`, `docs/audit/findings/web-bug.md`, `docs/audit/findings/web-qual.md`, `docs/audit/findings/landing-sec.md`, `docs/audit/findings/landing-bug.md`, `docs/audit/findings/landing-qual.md`, `docs/audit/findings/desktop-sec.md`, `docs/audit/findings/desktop-bug.md`, `docs/audit/findings/desktop-qual.md`

**Interfaces:**
- Produces: findings-файлы в едином формате для Задач 9–10.

- [ ] **Step 1: Запустить 9 параллельных ревью-агентов**

Шаблон промпта — из Global Constraints. Параметры:

| Файл результата | `<PATH>` | `<DIM>` | `<PREFIX>` | `<ENTRYPOINTS>` |
|---|---|---|---|---|
| web-sec.md | `web/src/` | SEC | WEB-SEC | `web/src/` (роутинг, api-клиент, хранение токенов) |
| web-bug.md | `web/src/` | BUG | WEB-BUG | `web/src/` (чек-ин, импорт CSV, редактор бейджей) |
| web-qual.md | `web/src/` | QUAL | WEB-QUAL | `web/src/` |
| landing-sec.md | `landing/src/` + `landing/proxy.ts` | SEC | LANDING-SEC | `landing/src/app/`, `landing/proxy.ts`, `landing/next.config.mjs` |
| landing-bug.md | `landing/src/` | BUG | LANDING-BUG | `landing/src/` |
| landing-qual.md | `landing/src/` | QUAL | LANDING-QUAL | `landing/src/` |
| desktop-sec.md | `desktop/src/` + `desktop/src-tauri/` | SEC | DESKTOP-SEC | `desktop/src-tauri/` (capabilities, IPC-команды), `desktop/src/` |
| desktop-bug.md | `desktop/src/` + `desktop/src-tauri/` | BUG | DESKTOP-BUG | `desktop/src/` (сканирование QR, киоск-режим) |
| desktop-qual.md | `desktop/src/` | QUAL | DESKTOP-QUAL | `desktop/src/` |

Для SEC-агентов web и desktop добавить к промпту предложение: «Особое внимание: хранение JWT (localStorage vs cookie), настройка axios (baseURL, интерсепторы, обработка 401), Tauri capabilities/permissions в desktop/src-tauri/capabilities/ и tauri.conf.json (CSP, allowlist IPC-команд)».

- [ ] **Step 2: Проверить формат**

Run: `ls docs/audit/findings/{web,landing,desktop}-*.md | wc -l`
Expected: `9`. Каждый файл содержит блоки `### <PREFIX>-NN` или «Находок нет» с обоснованием.

- [ ] **Step 3: Закоммитить**

```bash
git add docs/audit/findings/
git commit -m "audit: manual review findings for JS subsystems (web, landing, desktop)"
```

---

### Task 8: Ручной обзор кода — mobile (Kotlin Multiplatform)

**Files:**
- Create: `docs/audit/findings/mobile-sec.md`, `docs/audit/findings/mobile-bug.md`, `docs/audit/findings/mobile-qual.md`

**Interfaces:**
- Produces: findings-файлы в едином формате для Задач 9–10.

- [ ] **Step 1: Запустить 3 параллельных ревью-агентов**

Шаблон промпта — из Global Constraints. Параметры:

| Файл результата | `<PATH>` | `<DIM>` | `<PREFIX>` | `<ENTRYPOINTS>` |
|---|---|---|---|---|
| mobile-sec.md | `mobile/shared/src/`, `mobile/android-app/app/src/`, `mobile/iosApp/` | SEC | MOBILE-SEC | `mobile/shared/src/` (api-клиент, хранение токена), `mobile/android-app/app/src/main/AndroidManifest.xml` |
| mobile-bug.md | `mobile/shared/src/`, `mobile/android-app/app/src/` | BUG | MOBILE-BUG | `mobile/shared/src/` (offline-режим, синхронизация чек-инов) |
| mobile-qual.md | `mobile/shared/src/`, `mobile/android-app/app/src/` | QUAL | MOBILE-QUAL | `mobile/shared/src/` |

Для SEC-агента добавить к промпту: «Особое внимание: cleartext-трафик в AndroidManifest/network security config, хранение JWT (SharedPreferences vs EncryptedSharedPreferences/Keychain), логирование чувствительных данных».

- [ ] **Step 2: Проверить формат**

Run: `ls docs/audit/findings/mobile-*.md | wc -l`
Expected: `3`; формат блоков как в Global Constraints.

- [ ] **Step 3: Закоммитить**

```bash
git add docs/audit/findings/
git commit -m "audit: manual review findings for mobile subsystem"
```

---

### Task 9: Адверсариальная верификация находок

**Files:**
- Modify: все 18 файлов `docs/audit/findings/*.md` (добавляется поле «Вердикт»)

**Interfaces:**
- Consumes: findings-файлы Задач 6–8.
- Produces: те же файлы, где каждая находка получает строку `- Вердикт: ПОДТВЕРЖДЕНО | ОПРОВЕРГНУТО (<причина>) | НЕ ПРОВЕРЯЕМО (<причина>)`.

- [ ] **Step 1: Запустить верификаторов по подсистемам**

6 параллельных агентов (по одному на подсистему: backend, agent, web, landing, desktop, mobile). Промпт каждого:

```text
Ты — скептик-верификатор аудита. Ниже находки по подсистеме <PATH> проекта Idento.
Для КАЖДОЙ находки: открой указанный файл и строку, прочитай окружающий код
(включая вызывающие места) и попытайся ОПРОВЕРГНУТЬ находку. Находка опровергнута,
если код на самом деле ведёт себя иначе, чем утверждается, или описанное условие
недостижимо. НЕ изменяй никакие файлы.
Верни для каждой находки ровно одну строку:
<ID>: ПОДТВЕРЖДЕНО | ОПРОВЕРГНУТО (<одно предложение почему>) | НЕ ПРОВЕРЯЕМО (<почему>)
Если сомневаешься — ставь ОПРОВЕРГНУТО или НЕ ПРОВЕРЯЕМО, не ПОДТВЕРЖДЕНО.

<далее вставить полное содержимое трёх findings-файлов подсистемы>
```

- [ ] **Step 2: Вписать вердикты в findings-файлы**

В каждый блок находки добавить строку `- Вердикт: ...` из ответа верификатора. Находки без вердикта (агент пропустил) помечать `- Вердикт: НЕ ПРОВЕРЯЕМО (верификатор не дал ответа)`.

- [ ] **Step 3: Проверить покрытие**

Run: `echo "находок: $(grep -h '^### ' docs/audit/findings/*.md | wc -l), вердиктов: $(grep -h 'Вердикт:' docs/audit/findings/*.md | wc -l)"`
Expected: числа равны.

- [ ] **Step 4: Закоммитить**

```bash
git add docs/audit/findings/
git commit -m "audit: adversarial verification verdicts for all findings"
```

---

### Task 10: Сборка итогового отчёта

**Files:**
- Create: `docs/audit/2026-07-09-audit-report.md`
- Read: всё из `docs/audit/raw/` и `docs/audit/findings/`

**Interfaces:**
- Consumes: артефакты Задач 2–9.
- Produces: отчёт — вход для гейта владельца и планов Фаз 2–4.

- [ ] **Step 1: Собрать отчёт**

Создать `docs/audit/2026-07-09-audit-report.md` со структурой:

```markdown
# Отчёт аудита Idento — 2026-07-09

## 1. Резюме
<5-10 предложений: общее состояние, число находок по серьёзности,
самые опасные проблемы, объём обновлений зависимостей>

## 2. Сводная таблица находок (только ПОДТВЕРЖДЕНО)
| ID | Подсистема | Серьёзность | Заголовок | Файл |
|---|---|---|---|---|
<отсортировано: Critical, High, Medium, Low; внутри — по подсистеме>

## 3. Детали находок
<полные блоки подтверждённых находок, сгруппированные по серьёзности>

## 4. Уязвимости из сканеров
<govulncheck / npm audit / cargo audit: пакет, CVE/GO-ID, серьёзность,
затронутая подсистема, фикс-версия>

## 5. План обновления зависимостей (для Фазы 2)
<по подсистемам, партиями: партия = группа связанных пакетов;
для каждой: текущая → целевая версия, тип (minor/patch/major),
обоснование мажоров согласно политике>

## 6. Предложение волн исправлений
<Фаза 2: security-находки + партии обновлений; Фаза 3: BUG-находки;
Фаза 4: QUAL-находки — каждая со ссылкой на ID>

## 7. Backlog (вне охвата)
<ОПРОВЕРГНУТЫЕ и НЕ ПРОВЕРЯЕМО находки — списком, с причинами;
Low-находки, не попавшие в волны; прочее найденное по ходу>
```

Правила сборки: в разделы 2–3 попадают только находки с вердиктом ПОДТВЕРЖДЕНО; дубликаты (одна проблема из разных измерений/сканеров) объединяются с перечислением всех ID; серьёзность при слиянии — максимальная из объединяемых.

- [ ] **Step 2: Самопроверка отчёта**

Run: `grep -c "ПОДТВЕРЖДЕНО" docs/audit/findings/*.md | awk -F: '{s+=$2} END {print s}'`
Сверить: каждая подтверждённая находка либо в разделах 2–3, либо явно объединена с другой (ID указан в объединённом блоке). Каждый уязвимый пакет из раздела 4 присутствует в плане обновлений раздела 5.

- [ ] **Step 3: Закоммитить**

```bash
git add docs/audit/2026-07-09-audit-report.md
git commit -m "audit: consolidated prioritized audit report"
```

- [ ] **Step 4: Гейт владельца**

Показать владельцу резюме отчёта и сводную таблицу, попросить: утвердить приоритеты, вычеркнуть ненужное, решить судьбу трудоёмких Medium-находок (чинить в Фазе 2 или backlog). До решения владельца Фазы 2–4 не начинать.
