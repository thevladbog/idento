# Актуальность версий ключевых библиотек (проверено 2026-07-09)

Методология: базовый список библиотек взят из брифа Задачи 5 (манифесты `backend/go.mod`,
`agent/go.mod`, `web/package.json`, `landing/package.json`, `desktop/package.json`,
`desktop/src-tauri/Cargo.toml`, `docs/audit/raw/mobile-deps.md`). Дополнительно в таблицу
включён каждый пакет, помеченный уязвимым сканерами Задач 2–3
(`govulncheck-backend.txt`, `govulncheck-agent.txt`, `npm-audit-web/landing/desktop.json`),
включая транзитивные зависимости, не входившие в исходный список брифа.

Для mobile "версия в проекте" взята из **фактических** значений в `build.gradle.kts`
(Задача 4, разделы 4–6), а не из неиспользуемого `libs.versions.toml` — см. находку
Задачи 4 о мёртвом каталоге версий.

Источники (живые, дата снятия — 2026-07-09):
- Go: `proxy.golang.org` (`@latest` для каждого модуля), `api.osv.dev` (CVE/GHSA/GO-ID),
  `go.dev/dl/?mode=json` (актуальность тулчейна), плюс уже живые данные Задачи 2
  (`go-outdated-backend.txt`/`go-outdated-agent.txt` — результат `go list -m -u all` от 2026-07-09,
  `govulncheck-*.txt`).
- JS/npm: `npm view <pkg> version` (реестр npm, живой запрос), уже живые данные Задачи 3
  (`npm-outdated-*.json`, `npm-audit-*.json` — результаты `npm outdated`/`npm audit` от 2026-07-09),
  `api.osv.dev` (ecosystem npm) для CVE/фикс-версий.
- Rust: `crates.io` API (`max_stable_version`), `api.osv.dev` (ecosystem crates.io) — покрывает
  требование явно проверить `github.com/tauri-apps/tauri/security/advisories`, т.к.
  `cargo-audit` был недоступен в Задаче 3 (см. `cargo-audit-desktop.txt`) и это единственная
  проверка безопасности Rust-стороны Tauri в этом аудите.
- Mobile (Kotlin/AGP/Compose/сетевой стек): `repo1.maven.org` и `dl.google.com`
  maven-metadata.xml (поле `<release>`/`<latest>` + список версий), `api.github.com/repos/JetBrains/kotlin/releases/latest`
  для Kotlin, `api.osv.dev` (ecosystem Maven) для CVE.

Условные обозначения в колонке «Разрыв»: `major`/`minor`/`patch` — по семверу между
«в проекте» и «актуальная stable»; если запись про обязательное обновление из-за уязвимости —
дополнительно помечено «(обязательно)».

---

## 1. Go — backend

| Библиотека | В проекте | Актуальная stable | Разрыв | Security-примечания | Источник |
|---|---|---|---|---|---|
| github.com/labstack/echo/v4 | v4.13.4 | v4.15.4 | minor | Нет известных уязвимостей (OSV.dev, ecosystem Go, запрос по v4.13.4 — пусто) | proxy.golang.org (`@latest`) + go-outdated-backend.txt |
| github.com/jackc/pgx/v5 | v5.7.6 | v5.10.0 | minor (**обязательно**) | 2 уязвимости: GO-2026-5004 / GHSA-j88v-2chj-qfwx (SQL injection через путаницу плейсхолдеров с dollar-quoted строками, fixed 5.9.2) — **достижима** по трассе govulncheck (`store.PGStore.GetAuditLog` → `sanitize.SanitizeSQL`); GHSA-9jj7-4m8r-rfcm / CVE-2026-33816 / GO-2026-4772 (CRITICAL, memory-safety, fixed 5.9.0) — присутствует в зависимости, но **достижимость govulncheck не подтвердил** (нет трассы в symbol results — категория «imported but not called»). Обязательное обновление обосновано уже одной достижимой SQL injection | api.osv.dev + govulncheck-backend.txt + go-outdated-backend.txt |
| github.com/golang-jwt/jwt/v5 | v5.3.0 | v5.3.1 | patch | Нет известных уязвимостей (OSV.dev, пусто) | proxy.golang.org + go-outdated-backend.txt |
| golang.org/x/crypto | v0.45.0 | v0.54.0 | minor (в рамках v0.x) | В версии 0.45.0 есть 13 GHSA/CVE (несколько CRITICAL: GHSA-5cgq-3rg8-m6cv, GHSA-89gr-r52h-f8rx, GHSA-f5wc-c3c7-36mc, GHSA-jppx-rxg9-jmrx, GHSA-rm3j-f69w-wqmq, GHSA-vgwf-h737-ff37, GHSA-x527-x647-q7gg и др.), все — в подпакете `x/crypto/ssh` (+agent/knownhosts), fixed в v0.52.0. Проверено: `grep -rn "x/crypto" backend` показывает импорт только `x/crypto/bcrypt` — подпакет `ssh` в проекте не используется, поэтому govulncheck (Задача 2) не поднял эти находки как достижимые. Обновление всё равно рекомендуется по общей гигиене | api.osv.dev + go-outdated-backend.txt |
| github.com/swaggo/swag | v1.16.6 | v1.16.6 | нет разрыва | Нет известных уязвимостей | proxy.golang.org (latest = current) |
| github.com/skip2/go-qrcode | v0.0.0-20200617195104-da1b6568686e | та же псевдо-версия (новых тегов нет) | нет новой версии для перехода | Нет известных CVE (OSV.dev — пусто), но репозиторий не тегирован с 2020-06-17; GitHub API: `archived=false`, но `pushed_at=2024-03-01` — то есть в апстриме есть коммиты 2020→2024, не попавшие в зависимость проекта, и новых релизов с 2020 нет. Риск сопровождения, не уязвимость | proxy.golang.org + api.osv.dev + api.github.com/repos/skip2/go-qrcode |

Примечание: `golang.org/x/crypto` присутствует только в module graph backend — в agent его нет
вовсе (`grep crypto agent/go.sum` → 0 совпадений; ни одна из 4 зависимостей agent его не тянет),
поэтому строка x/crypto выше относится исключительно к backend.

## 2. Go — agent

| Библиотека | В проекте | Актуальная stable | Разрыв | Security-примечания | Источник |
|---|---|---|---|---|---|
| github.com/rs/cors | v1.11.1 | v1.11.1 | нет разрыва | Нет известных уязвимостей | proxy.golang.org (latest = current) + go-outdated-agent.txt |
| go.bug.st/serial | v1.6.4 | v1.7.1 | minor | Нет известных уязвимостей | proxy.golang.org + go-outdated-agent.txt |

## 3. Go — тулчейн (stdlib, общее для backend и agent)

| Библиотека | В проекте | Актуальная stable | Разрыв | Security-примечания | Источник |
|---|---|---|---|---|---|
| Go toolchain (stdlib: `crypto/tls`, `os`) | go1.26.4 (локальный `go version`; go.mod объявляет `go 1.25.4` как минимум языка) | go1.26.5 | patch (**обязательно**) | GO-2026-5856 — утечка приватности Encrypted Client Hello в `crypto/tls` (достижимо в backend через `echo.Echo.Start`→TLS handshake и в agent через `http.Server.ListenAndServe`); GO-2026-4970 — обход root через symlink+trailing slash в `os` (достижимо в backend `PGStore.RunMigrations`, в agent `loadConfig`/`saveConfig`). Обе исправлены в go1.26.5 | govulncheck-backend.txt + govulncheck-agent.txt + go.dev/dl/?mode=json (go1.26.5 подтверждён как stable) |

## 4. JS — web / landing / desktop (базовый список брифа)

| Библиотека | В проекте | Актуальная stable | Разрыв | Security-примечания | Источник |
|---|---|---|---|---|---|
| react | 18.3.1 (web, desktop) / 19.2.4 (landing) | 19.2.7 | patch (landing) / major, не обязателен — нет CVE (web, desktop) | Нет известных уязвимостей (OSV.dev, ecosystem npm) | npm-outdated-web/landing/desktop.json (npm registry, снято 2026-07-09) |
| react-dom | 18.3.1 (web, desktop) / 19.2.4 (landing) | 19.2.7 | patch (landing) / major, не обязателен (web, desktop) | Нет известных уязвимостей | npm-outdated-*.json |
| vite | 7.3.1 (web, desktop) | 8.1.4 (в рамках 7.x фикс — 7.3.6) | patch до 7.3.6 (**обязательно**); major до 8.x не обязателен | 5 CVE, все в диапазоне `<=7.3.4`: GHSA-4w7w-66w2-5vf9, GHSA-v2wj-q39q-566r (HIGH, `server.fs.deny` bypass с query), GHSA-p9ff-h696-f583 (HIGH, чтение произвольных файлов через WS dev-сервера), GHSA-v6wh-96g9-6wx3, GHSA-fx2h-pf6j-xcff (HIGH, `fs.deny` bypass на Windows) | npm-audit-web/desktop.json + npm-outdated-web/desktop.json |
| axios | 1.13.2 (web) / 1.13.5 (desktop) | 1.18.1 | minor (**обязательно**) | Десятки CVE в диапазоне `<1.16.0`/`<1.15.x` (SSRF через NO_PROXY, prototype pollution → credential theft/RCE-подобные гаджеты, ReDoS, header injection и др.); наиболее опасные: GHSA-pf86-5x62-jrwf, GHSA-6chq-wfr3-2hj9, GHSA-q8qp-cvcw-x6jj, GHSA-35jp-ww65-95wh (CVSS до 8.7), GHSA-hfxv-24rg-xrqf, GHSA-777c-7fjr-54vf, GHSA-p92q-9vqr-4j8v, GHSA-j5f8-grm9-p9fc, GHSA-3g43-6gmg-66jw, GHSA-898c-q2cr-xwhg | npm-audit-web/desktop.json + npm-outdated-web/desktop.json |
| @radix-ui/* (диапазон: react-checkbox, react-dialog, react-dropdown-menu, react-popover, react-select, react-separator, react-slot, react-switch, react-tooltip, react-accordion) | 1.1.8–2.2.6 (по пакетам) | 1.2.16–2.3.3 (по пакетам) | minor/patch по каждому пакету | Нет известных уязвимостей ни в одном из 10 проверенных пакетов (OSV.dev, ecosystem npm, версии из проекта) | npm-outdated-web.json, npm-outdated-landing.json + api.osv.dev (10 запросов, все пустые) |
| tailwindcss | 4.1.17 (web, desktop) / 4.1.18 (landing) | 4.3.2 | minor | Нет известных уязвимостей | npm view tailwindcss / npm-outdated-*.json |
| next | 16.1.6 (landing) | 16.2.10 | minor (**обязательно**) | Множество CVE в диапазоне до `<16.2.5`/`<16.2.6`: HTTP request smuggling в rewrites (GHSA-ggv3-7p47-pfv8), несколько DoS (GHSA-q4gf-8mx6-v5v3, GHSA-8h8q-6873-q5fj, GHSA-mg66-mrh9-m8jx, GHSA-h64f-5h5j-jqjh), обход Middleware/Proxy (GHSA-26hh-7cqf-hhc6, GHSA-492v-c6pp-mqqv, GHSA-267c-6grr-h53f, GHSA-36qx-fr4f-26g5 — HIGH), SSRF через WebSocket upgrade (GHSA-c4j6-fc7j-m34r, CVSS 8.6), XSS (GHSA-ffhc-5mcf-pf4q, GHSA-gx5p-jg67-6x7h), CSRF (GHSA-mq59-m269-xvcx) | npm-audit-landing.json + npm view next / npm-outdated-landing.json |
| next-intl | 4.8.2 (landing) | 4.13.1 | minor (**обязательно**) | GHSA-8f24-v5vv-gm5j — open redirect (`<4.9.1`); GHSA-4c35-wcg5-mm9h — prototype pollution через `experimental.messages.precompile` (`<=4.9.1`) | npm-audit-landing.json + npm view next-intl |
| framer-motion | 12.34.0 (landing) | 12.42.2 | minor | Нет известных уязвимостей | npm-outdated-landing.json |
| @tauri-apps/api | ~2.9.0 → резолвится 2.9.1 (desktop) | 2.11.1 | minor | Нет известных уязвимостей в npm-пакете (проверено отдельно от Rust-крейта `tauri`, см. раздел 5 — там есть CVE) | npm-outdated-desktop.json + npm view @tauri-apps/api |
| react-router-dom | ^7.12.0 → резолвится 7.13.0 (web, desktop) | 7.18.1 | minor (**обязательно**) | Уязвимости в базовом пакете `react-router` (используется react-router-dom): GHSA-49rj-9fvp-4h2h (HIGH, десериализация turbo-stream → unauth RCE-подобный гаджет, CVSS 8.1, `<=7.14.1`), GHSA-8646-j5j9-6r62 (HIGH, XSS через `javascript:` redirect, CVSS 8), GHSA-8x6r-g9mw-2r78 (HIGH, DoS через unbounded path expansion, `<7.15.0`), GHSA-rxv8-25v2-qmq8 (HIGH, DoS single-fetch, `<7.14.0`), плюс moderate/low (open redirect, stored XSS, CSRF) | npm-audit-web/desktop.json + npm-outdated-web/desktop.json |
| i18next | 25.7.2 (web) / 25.8.4 (desktop) | 26.3.6 (в рамках 25.x — 25.10.10) | minor (в рамках 25.x) / major, не обязателен | Нет известных уязвимостей | npm-outdated-web/desktop.json + npm view i18next |
| react-i18next | 16.4.0 (web) / 16.5.4 (desktop) | 17.0.9 (в рамках 16.x — 16.6.6) | minor (в рамках 16.x) / major, не обязателен | Нет известных уязвимостей | npm-outdated-web/desktop.json + npm view react-i18next |

## 5. Rust (Tauri, desktop/src-tauri)

| Библиотека | В проекте | Актуальная stable | Разрыв | Security-примечания | Источник |
|---|---|---|---|---|---|
| tauri | =2.9.1 (жёстко закреплено в Cargo.toml) | 2.11.5 | minor (**обязательно**) | CVE-2026-42184 / GHSA-7gmj-67g7-phm9 (MODERATE, CVSS3 не указан явно но UI:R/C:H/I:H/A:H) — Origin Confusion в `is_local_url()`: на Windows/Android проверка первой subdomain-метки URL позволяет удалённой странице (напр. `http://app.evil.com`) быть ошибочно классифицированной как локальный origin и вызывать IPC-команды, ограниченные `"local": true` в capabilities. Диапазон уязвимости `>=2.0.0 <2.11.1`, проект на 2.9.1 — уязвим. Это единственная проверка безопасности Rust-стороны в этом аудите, т.к. `cargo-audit` был недоступен (Задача 3, см. `cargo-audit-desktop.txt`) — проверено явно через `github.com/tauri-apps/tauri/security/advisories` (зеркалируется в OSV.dev) | api.osv.dev (ecosystem crates.io) + crates.io API (`max_stable_version`) + github.com/tauri-apps/tauri/security/advisories |
| tauri-build | 2.5 → резолвится 2.5.5 (Cargo.lock) | 2.6.3 | minor | Нет известных уязвимостей в OSV.dev (crates.io) для tauri-build | api.osv.dev + crates.io API + Cargo.lock |

## 6. Mobile — Kotlin/AGP/Compose/сетевой стек (версии из фактических build.gradle.kts, не из неиспользуемого libs.versions.toml)

| Библиотека | В проекте | Актуальная stable | Разрыв | Security-примечания | Источник |
|---|---|---|---|---|---|
| kotlin (org.jetbrains.kotlin, stdlib + плагины android/multiplatform/serialization/compose) | 2.1.0 | 2.4.0 | minor | Нет известных уязвимостей (OSV.dev, ecosystem Maven, `org.jetbrains.kotlin:kotlin-stdlib@2.1.0`) | repo1.maven.org/.../kotlin-stdlib/maven-metadata.xml + api.github.com/repos/JetBrains/kotlin/releases/latest + api.osv.dev |
| AGP (com.android.tools.build:gradle, плагины com.android.application/library) | 8.7.2 | 9.2.1 (в рамках 8.x — 8.13.2) | minor (до 8.13.2) / major до 9.x, не обязателен | Нет известных уязвимостей (OSV.dev, ecosystem Maven) | dl.google.com/.../gradle/maven-metadata.xml + api.osv.dev |
| Compose BOM (androidx.compose:compose-bom, фактически используется в app/build.gradle.kts) | 2024.11.00 (каталог объявляет 2024.12.01, но фактически подключён 2024.11.00 — см. находку Задачи 4, раздел 7) | 2026.06.01 | не применимо (calendar versioning) — существенное отставание (~19 релизов) | Явных отдельных CVE для BOM не публикуется (это агрегатор версий, а не сам код); проверка релевантных под-артефактов (`androidx.compose.ui:ui`, `material3`) через Google Maven не выявила отдельного CVE-фида для Compose | dl.google.com/.../compose-bom/maven-metadata.xml |
| Compose compiler (org.jetbrains.kotlin.plugin.compose, начиная с Kotlin 2.0 версия синхронизирована с Kotlin, а не с отдельным `androidx.compose.compiler:compiler`) | 2.1.0 (= версия kotlin) | 2.4.0 (= актуальная kotlin) | minor (см. строку kotlin) | См. kotlin выше — это один и тот же плагин/версия | Совпадает с kotlin |
| Compose Multiplatform gradle-плагин (org.jetbrains.compose, используется в mobile/shared для iOS/KMP-таргета) | 1.7.3 | 1.11.1 | minor | Нет известных уязвимостей | repo1.maven.org/.../compose-gradle-plugin/maven-metadata.xml |
| Сетевой стек — retrofit (com.squareup.retrofit2:retrofit, android-app/app) | 2.11.0 | 3.0.0 (в рамках 2.x — 2.12.0) | patch до 2.12.0 / major до 3.x, не обязателен | Нет известных уязвимостей на 2.11.0 (OSV.dev); исторические GHSA-8p8g-f9vg-r7xr и GHSA-j379-9jr9-w5cq (directory traversal, XXE) исправлены ещё в 2.5.0, не актуальны | repo1.maven.org/.../retrofit/maven-metadata.xml + api.osv.dev |
| Сетевой стек — okhttp (com.squareup.okhttp3:okhttp, android-app/app, транзитивно через retrofit) | 4.12.0 | 5.4.0 (в рамках 4.x — уже последняя, 4.12.0 = latest 4.x) | нет разрыва в рамках 4.x / major до 5.x, не обязателен | Нет известных уязвимостей на 4.12.0; исторические GHSA-3cqm-mf7h-prrj (fixed 4.9.2) и GHSA-4hc2-jh7r-wrc3 (fixed 2.7.4/3.1.2) не актуальны | repo1.maven.org/.../okhttp/maven-metadata.xml + api.osv.dev |
| Сетевой стек — ktor (io.ktor:ktor-client-*, mobile/shared, KMP-таргет включая iOS) | 3.0.2 | 3.5.1 | minor | Нет известных уязвимостей | repo1.maven.org/.../ktor-client-core/maven-metadata.xml + api.osv.dev |
| kotlinx-serialization (org.jetbrains.kotlinx:kotlinx-serialization-json) | 1.7.3 | 1.11.0 | minor | Нет известных уязвимостей | repo1.maven.org/.../kotlinx-serialization-json/maven-metadata.xml + api.osv.dev |
| kotlinx-coroutines (org.jetbrains.kotlinx:kotlinx-coroutines-core/-android) | 1.9.0 | 1.11.0 | minor | Нет известных уязвимостей | repo1.maven.org/.../kotlinx-coroutines-core/maven-metadata.xml + api.osv.dev |

## 7. Дополнительно: пакеты, помеченные уязвимыми сканерами Задач 2–3 (не входили в базовый список брифа)

Транзитивные npm-зависимости ниже не объявлены напрямую в `package.json` проектов — они подтягиваются
инструментами сборки/линта (eslint-тулчейн, vite/rollup, axios, next). Обновление достигается через
`npm audit fix` / обновление родительского прямого пакета, а не через прямое изменение версии.

| Библиотека | В проекте (резолвится) | Актуальная stable | Разрыв | Security-примечания | Источник |
|---|---|---|---|---|---|
| @babel/core | 7.29.0 (web, landing, desktop — транзит. babel-plugin-react-compiler/eslint) | 7.29.6 (8.0.0-rc.6 — pre-release major) | patch (**обязательно**) | GHSA-4x5r-pxfx-6jf8 (LOW) — произвольное чтение файлов через комментарий `sourceMappingURL`, `<=7.29.0` | npm-audit-web/landing/desktop.json + api.osv.dev |
| ajv | 6.12.6 (web, landing, desktop — транзит. eslint-конфиг) | 8.18.0 (в рамках 6.x — 6.14.0) | patch до 6.14.0 (**обязательно**) / major до 8.x приходит вместе с обновлением eslint | GHSA-2g4f-4pwh-qvx6 (MODERATE) — ReDoS при использовании опции `$data`, `<6.14.0` | npm-audit-web/landing/desktop.json + api.osv.dev |
| brace-expansion | 1.1.12 и 2.0.2 (web, landing) / 1.1.12 (desktop) — транзит. minimatch/glob | 5.0.5 (в рамках 1.x/2.x — 1.1.13/2.0.3) | patch (**обязательно**) | GHSA-f886-m6hf-6m8v (MODERATE) — зависание процесса/исчерпание памяти на zero-step последовательности, `<1.1.13` и `>=2.0.0 <2.0.3` | npm-audit-web/landing/desktop.json + api.osv.dev |
| esbuild | 0.27.3 (web, desktop — транзит. vite) | 0.28.1 | minor (**обязательно**) | GHSA-g7r4-m6w7-qqqr (LOW) — произвольное чтение файлов dev-сервером на Windows, `>=0.27.3 <0.28.1` | npm-audit-web/desktop.json + api.osv.dev |
| flatted | 3.3.3 (web, landing, desktop — транзит.) | 3.4.2 | minor (**обязательно**) | GHSA-25h7-pfq9-p65f (HIGH) — неограниченная рекурсия/DoS в `parse()`, `<3.4.0`; GHSA-rf6f-7fwh-wjgh (HIGH) — prototype pollution в `parse()`, `<=3.4.1` | npm-audit-web/landing/desktop.json + api.osv.dev |
| follow-redirects | 1.15.11 (web, desktop — транзит. axios) | 1.16.0 | minor (**обязательно**) | GHSA-r4q5-vmmm-2653 (MODERATE) — утечка кастомных auth-заголовков при кросс-доменном редиректе, `<=1.15.11` | npm-audit-web/desktop.json + api.osv.dev |
| form-data | 4.0.5 (web, desktop — транзит. axios) | 4.0.6 | patch (**обязательно**) | GHSA-hmw2-7cc7-3qxx (HIGH) — CRLF injection через неэкранированные имена полей/файлов в multipart, `>=4.0.0 <4.0.6` | npm-audit-web/desktop.json + api.osv.dev |
| js-yaml | 4.1.1 (web, landing, desktop — транзит. eslint-конфиг) | 5.2.1 (в рамках 4.x — 4.2.0) | patch до 4.2.0 (**обязательно**) / major до 5.x приходит вместе с обновлением eslint | GHSA-h67p-54hq-rp68 (MODERATE) — квадратичная сложность/DoS при обработке merge-ключей с повторными алиасами, `>=4.0.0 <=4.1.1` | npm-audit-web/landing/desktop.json + api.osv.dev |
| minimatch | 3.1.2 и 9.0.5 (web) / 3.1.2 (landing, desktop) — транзит. eslint/glob | 10.2.5 (в рамках 3.x/9.x — 3.1.4/9.0.7) | patch (**обязательно**) / major до 10.x приходит вместе с обновлением eslint | 3 CVE, все HIGH: GHSA-3ppc-4f35-3m26, GHSA-7r86-cg39-jmmj, GHSA-23c5-xmqv-rm74 — ReDoS через wildcard/GLOBSTAR/extglob паттерны, диапазоны `<3.1.3`/`<3.1.4` и `>=9.0.0 <9.0.6`/`<9.0.7` | npm-audit-web/landing/desktop.json + api.osv.dev |
| picomatch | 4.0.3 (web, landing, desktop) и 2.3.1 (landing — доп. путь) — транзит. vite/tinyglobby | 4.0.5 (в рамках 2.x/4.x — 2.3.2/4.0.4) | patch (**обязательно**) | GHSA-3v7f-55p6-f55p (MODERATE) — method injection в POSIX character classes; GHSA-c2c7-rcm5-vvqj (HIGH) — ReDoS через extglob-квантификаторы; диапазоны `<2.3.2` и `>=4.0.0 <4.0.4` | npm-audit-web/landing/desktop.json + api.osv.dev |
| postcss | 8.5.6 (web, landing, desktop — прямая devDependency) | 8.5.16 | patch (**обязательно**) | GHSA-qx2v-qp2m-jg93 (MODERATE) — XSS через неэкранированный `</style>` в CSS stringify, `<8.5.10` | npm-audit-web/landing/desktop.json + npm-outdated-*.json |
| react-router | 7.13.0 (web, desktop — транзит. react-router-dom) | 8.2.0 (в рамках 7.x — 7.18.1) | minor до 7.18.1 (**обязательно**) / major до 8.x не обязателен | Тот же набор уязвимостей, что указан в строке react-router-dom (раздел 4) — CVE живут именно в этом базовом пакете: GHSA-49rj-9fvp-4h2h (HIGH, unauth RCE-гаджет через turbo-stream, `<=7.14.1`), GHSA-8646-j5j9-6r62 (HIGH, XSS), GHSA-8x6r-g9mw-2r78 и GHSA-rxv8-25v2-qmq8 (HIGH, DoS), GHSA-2j2x-hqr9-3h42 (open redirect), GHSA-f22v-gfqf-p8f3 (stored XSS), GHSA-84g9-w2xq-vcv6 (CSRF, `<7.15.1`). Путь фикса тот же — обновление прямой зависимости react-router-dom до 7.18.1 подтягивает react-router 7.18.1 | npm-audit-web/desktop.json + npm view react-router (7.x latest = 7.18.1, latest overall = 8.2.0) |
| rollup | 4.53.3 (web) / 4.57.1 (desktop) — транзит. vite | 4.62.2 | minor (**обязательно**) | GHSA-mw96-cpmx-2vgc (HIGH) — произвольная запись файлов через path traversal, `>=4.0.0 <4.59.0` | npm-audit-web/desktop.json + api.osv.dev |
| icu-minify | 4.8.2 (landing — транзит.) | 4.13.1 (в рамках фикса — 4.9.2) | minor (**обязательно** до 4.9.2) | GHSA-r27j-894h-3w3p (LOW) — DoS через несанитизированный lookup ключа `select` на `Object.prototype` при `precompile: true`, `<=4.9.1` | npm-audit-landing.json + api.osv.dev |

---

## Выводы для политики обновлений

**Обязательные (уязвимость):**
- Go: `github.com/jackc/pgx/v5` (CRITICAL memory-safety CVE-2026-33816 + SQL injection GO-2026-5004 → минимум v5.9.2, рекомендовано v5.10.0); Go toolchain `crypto/tls`/`os` (GO-2026-5856, GO-2026-4970 → go1.26.5).
- JS: `vite` (→ ≥7.3.6), `axios` (→ 1.18.1), `next` (→ ≥16.2.6, рекомендовано 16.2.10), `next-intl` (→ ≥4.9.2), `react-router-dom`/`react-router` (→ 7.18.1), и транзитивные `@babel/core`, `ajv`, `brace-expansion`, `esbuild`, `flatted`, `follow-redirects`, `form-data`, `js-yaml`, `minimatch`, `picomatch`, `postcss`, `rollup`, `icu-minify` (см. раздел 7; большинство закрывается `npm audit fix`/обновлением родительского прямого пакета).
- Rust: `tauri` — CVE-2026-42184 (Origin Confusion, обход проверки локального origin в IPC на Windows/Android) → минимум 2.11.1, рекомендовано 2.11.5. Единственная проверка безопасности Rust-стороны в этом аудите (cargo-audit недоступен), поэтому обновление тут особенно приоритетно.

**Мажор из-за прекращения поддержки:** нет подтверждённых случаев (ни один пакет из базового списка или из сканеров не архивирован/не объявлен EOL официально на момент проверки). Отдельно отмечается риск сопровождения (не EOL) у `github.com/skip2/go-qrcode`: репозиторий не архивирован, но не тегировался с 2020-06-17 при наличии более поздних коммитов апстрима (последний push 2024-03-01) — стоит оценить замену в Задаче 6/10, хотя формально мажорного обновления для перехода не существует.

**Обычные minor/patch (без известных CVE, по общей политике):**
- Go: `labstack/echo/v4` (→ v4.15.4), `golang-jwt/jwt/v5` (→ v5.3.1), `golang.org/x/crypto` (→ v0.54.0 — известные критические CVE в подпакете `ssh`, но проект использует только `bcrypt`, недостижимо), `go.bug.st/serial` (→ v1.7.1). Уже актуальны: `swaggo/swag`, `github.com/rs/cors`.
- JS: `react`/`react-dom` (patch в landing, опциональный major в web/desktop), `@radix-ui/*` (весь диапазон), `tailwindcss`, `framer-motion`, `@tauri-apps/api`, `i18next`/`react-i18next` (minor в рамках текущего мажора, опциональный major).
- Rust: `tauri-build` (→ 2.6.3).
- Mobile: `kotlin` (→ 2.4.0), AGP (→ 8.13.2 в рамках 8.x; опциональный major 9.2.1), Compose BOM (существенное отставание, calendar-versioning, обновление рекомендовано отдельным тикетом из-за широкого влияния на UI-код), Compose Multiplatform plugin (→ 1.11.1), `retrofit` (→ 2.12.0 в рамках 2.x; опциональный major 3.0.0), `okhttp` (уже последняя в 4.x; опциональный major 5.4.0), `ktor` (→ 3.5.1), `kotlinx-serialization` (→ 1.11.0), `kotlinx-coroutines` (→ 1.11.0).
