# LANDING-QUAL — landing/src/, качество кода

## Метод проверки

Прочитаны все файлы `landing/src/**` (24 файла, ни один не превышает 400 строк — самый
большой `dropdown-menu.tsx` на 201 строку), `landing/messages/{en,ru}.json`,
`landing/proxy.ts`, `landing/tests/landing.spec.ts`, `landing/playwright.config.ts`,
`landing/package.json`, `landing/next-sitemap.config.js`, `.github/workflows/ci.yml`.
Проверено: переиспользование секций/анимаций, хардкод текста вместо i18n-каталога,
согласованность внутренних ссылок/якорей, мёртвый код (компоненты, CSS-переменные,
i18n-неймспейсы), покрытие Playwright-тестами и их соответствие реальной разметке,
подключение тестов к CI.

---

### LANDING-QUAL-01: Footer не использует next-intl — весь текст на английском захардкожен, хук перевода не используется
- Файл: landing/src/components/layout/Footer.tsx:7 (объявление `const _t = useTranslations("Navigation")`), 13-33 (текст "Built by… The source code is available on… GitHub"), 40 ("Privacy Policy"), 46 ("Terms of Service")
- Описание: Компонент импортирует `useTranslations("Navigation")` и присваивает результат переменной `_t`, но нигде её не вызывает (подчёркивание в имени явно означает "заведомо неиспользуемая"). Весь видимый текст футера — "Built by", "The source code is available on", "GitHub", "Privacy Policy", "Terms of Service" — вставлен в JSX как литералы, а не через `t(...)`. При этом остальной сайт (Hero, Features, Header и т.д.) последовательно тянет текст из `messages/en.json`/`ru.json`.
- Влияние: На русской версии сайта (`/ru/...`) футер, который отображается абсолютно на каждой странице, остаётся полностью на английском — ломает заявленную двуязычность продукта. Мёртвый вызов хука вводит в заблуждение читающего код (выглядит как "перевод подключен").
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Добавить ключи в `Navigation` (или отдельный `Footer`) неймспейс `messages/*.json` и заменить литералы на `t(...)`; удалить неиспользуемую переменную `_t`, если перевод в итоге не нужен — либо использовать её.
- Вердикт: ПОДТВЕРЖДЕНО — `Footer.tsx:7` объявляет `_t`, которая нигде не вызывается; текст на строках 13-33/40/46 — литералы; `messages/en.json` не содержит неймспейса `Footer`, а `Navigation` содержит только `features/pricing/faq/docs`.

### LANDING-QUAL-02: ThemeToggle — подписи пунктов меню темы захардкожены на английском
- Файл: landing/src/components/ThemeToggle.tsx:24 (`Toggle theme`), 29 (`Light`), 32 (`Dark`), 35 (`System`)
- Описание: `DropdownMenuItem` для переключения темы и sr-only подпись кнопки содержат литеральные строки "Light"/"Dark"/"System"/"Toggle theme" без обращения к `useTranslations`, хотя рядом (`LanguageSwitcher`, `Header`) весь остальной UI переведён.
- Влияние: На `/ru` меню выбора темы остаётся англоязычным — минорная, но заметная несогласованность интерфейса для не-английских пользователей и для скринридеров (aria-label на английском).
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Добавить неймспейс (например `Theme.light/dark/system/toggle`) в оба JSON-каталога и подключить `useTranslations`.
- Вердикт: ПОДТВЕРЖДЕНО — `ThemeToggle.tsx:24,29,32,35` содержат литералы `"Toggle theme"/"Light"/"Dark"/"System"`, компонент не импортирует `useTranslations`.

### LANDING-QUAL-03: Страница /pricing содержит собственный захардкоженный заголовок вместо i18n-сообщений
- Файл: landing/src/app/[locale]/pricing/page.tsx:10 (`Choose Your Plan`), 13 (`Simple, transparent pricing for events of all sizes`)
- Описание: Локальный `<h1>`/`<p>` в `PricingPage` заданы литералами прямо в JSX, в то время как секция `<Pricing />`, рендерящаяся чуть ниже на этой же странице, полностью переведена через `useTranslations("Pricing")`.
- Влияние: На `/ru/pricing` заголовок страницы останется на английском, а подзаголовок секции Pricing — на русском: визуально несогласованный, наполовину переведённый экран.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Вынести заголовок/подзаголовок в `messages/*.json` (например `PricingPage.title/subtitle`) и рендерить через `t(...)`.
- Вердикт: ПОДТВЕРЖДЕНО — `pricing/page.tsx:10,13` содержат английские литералы `"Choose Your Plan"`/`"Simple, transparent pricing for events of all sizes"`, а рендерящийся ниже `<Pricing />` использует `useTranslations("Pricing")`.

### LANDING-QUAL-04: SEO-метаданные (title/description) дублируют контент отдельно от общего i18n-каталога
- Файл: landing/src/app/[locale]/layout.tsx:18-26 (`titles`/`descriptions` объекты внутри `generateMetadata`)
- Описание: `generateMetadata` держит собственные объекты `titles`/`descriptions` для en/ru, продублированные вручную и никак не связанные с `messages/en.json` / `messages/ru.json`. Это второй, независимый источник переводного контента для одних и тех же представлений о продукте.
- Влияние: При обновлении маркетингового текста в `messages/*.json` разработчик с высокой вероятностью забудет обновить копию в `layout.tsx` (и наоборот) — тексты разойдутся; next-intl прямо поддерживает `getTranslations` внутри `generateMetadata` для таких случаев.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Перенести SEO title/description в `messages/*.json` (отдельный неймспейс `Metadata`) и получать их через `getTranslations({ locale, namespace: "Metadata" })` внутри `generateMetadata`.
- Вердикт: ПОДТВЕРЖДЕНО — `[locale]/layout.tsx:18-26` объявляет собственные объекты `titles`/`descriptions` по locale, не связанные с `messages/en.json`/`messages/ru.json`.

### LANDING-QUAL-05: Ссылки на несуществующие якоря `#signup` и `#demo` — главные CTA никуда не ведут
- Файл: landing/src/components/sections/Pricing.tsx:113, landing/src/components/sections/FinalCTA.tsx:68, landing/src/components/sections/Hero.tsx:74
- Описание: Кнопки `t("plans.${key}.cta")` (Pricing), `t("cta")` (FinalCTA, "Start Your Free Trial") и `t("cta.secondary")` (Hero, "Watch Demo") указывают на `href="#signup"` / `href="#demo"`. По всему `landing/src` нет ни одного элемента с `id="signup"` или `id="demo"` (проверено grep по всем `.tsx`) — есть только `id="features"`, `id="pricing"`, `id="download"`, `id="how-it-works"`, `id="comparison"`, `id="faq"`.
- Влияние: Клик по кнопкам "Start Free Trial" (Hero и Pricing), "Watch Demo" и финальному CTA "Start Your Free Trial" на всех трёх страницах, где они встречаются, не производит вообще никакого эффекта — самые важные conversion-кнопки лендинга нерабочие.
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Либо добавить реальные секции/модалки с `id="signup"`/`id="demo"`, либо временно указывать существующий якорь (`#pricing`, `#download`) до готовности регистрации/демо.
- Вердикт: ПОДТВЕРЖДЕНО — `Pricing.tsx:113`, `FinalCTA.tsx:68` и `Hero.tsx:74` ссылаются на `#signup`/`#demo`; grep по `id="signup"`/`id="demo"` в `landing/src` не даёт совпадений (это же дублирует LANDING-BUG-02/07, но детали корректны).

### LANDING-QUAL-06: Пункты навигации Header — якоря без пути, не работают вне главной страницы
- Файл: landing/src/components/layout/Header.tsx:17-19 (`navItems` с `href: "#features"|"#pricing"|"#faq"`), 34-41 и 79-87 (рендер как обычный `<a href={item.href}>`)
- Описание: Навигация в Header использует относительные фрагменты (`#features`, `#pricing`, `#faq`) как plain `<a>` вместо `Link` из `@/i18n/routing` с абсолютным путём. Header общий для всех страниц (`layout.tsx`), а секции Features/Pricing/FAQ существуют только на `page.tsx` (главная) и частично на `pricing/page.tsx` (Pricing+FAQ, без Features).
- Влияние: Находясь на `/download` (там нет ни одной из этих секций) или на `/pricing` (там нет `#features`), клик по "Features"/"Pricing"/"FAQ" в шапке просто дописывает хэш к текущему URL и не делает ничего — пункт меню выглядит рабочим, но не выполняет навигацию на главную.
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Использовать `Link href={`/#${anchor}`}` из `@/i18n/routing`, чтобы переход с любой страницы сначала вёл на главную с нужным якорем.
- Вердикт: ПОДТВЕРЖДЕНО — `Header.tsx:17-19` задаёт `navItems` с относительными `#features`/`#pricing`/`#faq`, рендерящимися как `<a href={item.href}>` на строках 34-41 и 79-87; `download/page.tsx` не содержит ни одной из этих секций, `pricing/page.tsx` не содержит `Features` (нет `id="features"`).

### LANDING-QUAL-07: Footer ссылается на несуществующие страницы /privacy и /terms
- Файл: landing/src/components/layout/Footer.tsx:37 (`href="/privacy"`), 43 (`href="/terms"`)
- Описание: В `landing/src/app/[locale]/` существуют только `page.tsx`, `pricing/page.tsx`, `download/page.tsx`. Маршрутов `privacy` и `terms` нет.
- Влияние: Клик по "Privacy Policy" или "Terms of Service" в футере (виден на каждой странице сайта) приводит к 404 — критично для страницы, которая должна внушать доверие (upsell на "Secure & Private" в маркетинговых текстах).
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Добавить страницы `privacy`/`terms` (даже минимальные) либо временно скрыть ссылки до готовности контента.
- Вердикт: ПОДТВЕРЖДЕНО — `Footer.tsx:37,43` ссылаются на `/privacy`/`/terms`; в `landing/src/app/[locale]/` таких маршрутов нет (дублирует LANDING-BUG-06, детали совпадают).

### LANDING-QUAL-08: Дефолтная локаль захардкожена трижды и разошлась с логикой next-intl
- Файл: landing/proxy.ts:11-13, landing/src/app/not-found.tsx:4, landing/src/i18n/routing.ts:9
- Описание: `routing.ts` объявляет единственный источник истины `defaultLocale: 'en'`. Но `proxy.ts` перед вызовом `handleI18nRouting(request)` вручную перехватывает `pathname === '/'` и жёстко редиректит на `/en`, а `not-found.tsx` отдельно делает `redirect('/en')`. Оба места дублируют литерал `'en'` вместо использования `routing.defaultLocale`, и (что важнее) ручной редирект в `proxy.ts` срабатывает раньше встроенного middleware `next-intl`, которое как раз умеет определять локаль пользователя по `Accept-Language`/куки (`localeDetection` не выключен в `routing.ts`, то есть по умолчанию включён).
- Влияние: Пользователь с русским браузером, впервые открывший корень сайта, всегда получит `/en` вместо ожидаемого автоматического определения `/ru` — ручной код в `proxy.ts` полностью нейтрализует эту фичу next-intl. Плюс если когда-либо поменять `defaultLocale`, оба места придётся руками синхронизировать.
- Серьёзность: Medium
- Уверенность: средняя
- Рекомендация: Убрать ручной блок `if (pathname === '/')` из `proxy.ts` и довериться `handleI18nRouting` (next-intl сам сделает редирект на определённую или дефолтную локаль); в `not-found.tsx` использовать `routing.defaultLocale` вместо литерала `'en'`.
- Вердикт: ПОДТВЕРЖДЕНО — `routing.ts:9` объявляет `defaultLocale: 'en'`, `proxy.ts:11-13` и `not-found.tsx:4` независимо дублируют литерал `'en'` без ссылки на `routing.defaultLocale`, и `proxy.ts` перехватывает `'/'` до вызова `handleI18nRouting`.

### LANDING-QUAL-09: Мёртвый компонент — весь `select.tsx` (161 строка) нигде не используется
- Файл: landing/src/components/ui/select.tsx:1-161
- Описание: Grep по `landing/src` не находит ни одного импорта из `@/components/ui/select` за пределами самого файла. `LanguageSwitcher.tsx` (единственное место, где логически мог бы использоваться Select) реализован через обычные `<a>`-ссылки, не через Radix Select.
- Влияние: Мёртвый код увеличивает объём для чтения/поддержки; зависимость `@radix-ui/react-select` тянется в бандл ради компонента, который никогда не рендерится.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Удалить `select.tsx`, пока он не понадобится, либо, если Select планировался для `LanguageSwitcher` (см. следующую находку про тесты), — использовать его по назначению.
- Вердикт: ПОДТВЕРЖДЕНО — `LanguageSwitcher.tsx` рендерит обычные `<a>` (строки 25-37), а grep по `@/components/ui/select`/`react-select` за пределами `select.tsx` в `landing/src` не даёт совпадений.

### LANDING-QUAL-10: Playwright-тест не соответствует реальной разметке LanguageSwitcher
- Файл: landing/tests/landing.spec.ts:91-93 (тест "4. Language switching EN -> RU"); фактическая реализация — landing/src/components/LanguageSwitcher.tsx:22-39
- Описание: Тест ищет `page.locator("button[role='combobox']").first()`, кликает по нему и затем `page.locator("[role='option']:has-text('Русский')").click()` — это API, характерное для Radix `Select`/shadcn комбобокса. Но `LanguageSwitcher.tsx` рендерит группу простых `<a href=...>EN</a>` / `<a href=...>RU</a>` без `role="combobox"`, без `role="option"` и без текста "Русский" (используются лейблы "EN"/"RU").
- Влияние: Тест №4 обязан падать (или бесконечно ждать/таймаутиться на `.click()` несуществующего элемента) при любом реальном запуске — тестовый набор не отражает текущую реализацию переключателя языка и не даёт никакой гарантии, что переключение локали работает.
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Переписать тест под реальную разметку (`page.locator('a', { hasText: 'RU' }).click()` и проверка URL) или, если ожидался combobox-стиль переключателя, реализовать его в `LanguageSwitcher.tsx` и синхронизировать с тестом.
- Вердикт: ПОДТВЕРЖДЕНО — `landing.spec.ts:91-93` ищет `button[role='combobox']` и `[role='option']:has-text('Русский')`, а `LanguageSwitcher.tsx:22-39` рендерит `<a>`-ссылки с лейблами `"EN"/"RU"` без `role="combobox"`/`role="option"` — локатор не найдёт элемент, тест обязан упасть/зависнуть на `.click()`.

### LANDING-QUAL-11: Тесты landing не подключены ни к npm-скриптам, ни к CI
- Файл: landing/package.json:6-10 (секция `scripts`), .github/workflows/ci.yml (нет ни одного шага/джобы с `landing`)
- Описание: В `package.json` нет скрипта `test`/`test:e2e`, вызывающего Playwright — единственный способ прогнать `landing/tests/landing.spec.ts` руками через `npx playwright test`. В `.github/workflows/ci.yml` есть отдельные джобы для `web/`, `mobile/`, `desktop/`, Go-бэкенда, но ни одного упоминания `landing` (проверено grep) — ни lint, ни typecheck, ни build, ни e2e-тесты каталога `landing/` не выполняются в CI.
- Влияние: Единственный тестовый файл лендинга (и найденная в LANDING-QUAL-10 поломка) может годами оставаться незамеченным, поскольку никто и ничто не запускает эти тесты автоматически; регрессии в лендинге не будут пойманы перед мержем.
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Добавить `"test": "playwright test"` в `landing/package.json` и job в `ci.yml` (по аналогии с `web`), запускающийся при изменениях в `landing/**`.
- Вердикт: ПОДТВЕРЖДЕНО — `package.json` scripts (строки 6-11) не содержат `test`/`test:e2e`; `grep -n "landing" .github/workflows/ci.yml` не даёт ни одного совпадения (нет ни job, ни path-filter для `landing/**`).

### LANDING-QUAL-12: Заголовок секции (motion-обёртка + h2 + p) скопирован почти дословно в 7 файлах
- Файл: landing/src/components/sections/Features.tsx:33-46, HowItWorks.tsx:19-32, UseCases.tsx:20-33, Comparison.tsx:23-36, Pricing.tsx:23-35, FAQ.tsx:28-41, Download.tsx:21-34
- Описание: Во всех перечисленных секциях повторяется практически идентичный блок: `motion.div` с `className="mx-auto flex max-w-[58rem] flex-col items-center space-y-4 text-center [mb-12]"`, `initial={{ opacity: 0, y: 20 }}`, `whileInView={{ opacity: 1, y: 0 }}`, `viewport={{ once: true }}`, `transition={{ duration: 0.5 }}`, содержащий `<h2 className="font-bold text-3xl leading-[1.1] sm:text-3xl md:text-5xl">{t("title")}</h2>` и `<p className="max-w-[42rem] leading-normal text-muted-foreground sm:text-lg sm:leading-7">{t("subtitle")}</p>`.
- Влияние: Любое изменение типографики/анимации заголовков секций требует правки в 7 разных файлах вручную — уже сейчас Features.tsx отличается от остальных отсутствием `mb-12` (несогласованность отступов между секциями, вероятно случайная).
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Вынести общий `<SectionHeader title subtitle />` компонент (и/или общий объект framer-motion variants `fadeInUp`) и переиспользовать во всех секциях.
- Вердикт: ПОДТВЕРЖДЕНО — идентичный блок (`motion.div` + `h2`/`p` с теми же классами/анимацией) присутствует во всех 7 перечисленных файлов; `Features.tsx:34` действительно не содержит `mb-12` в className, в отличие от остальных 6 секций.

### LANDING-QUAL-13: Магические числовые диапазоны жёстко привязывают код к длине массивов в i18n-каталоге
- Файл: landing/src/components/sections/UseCases.tsx:56 (`[1, 2, 3].map(...)` для `items.${key}.benefits.${i}`), landing/src/components/sections/Pricing.tsx:94 (`[1, 2, 3, 4, 5].map(...)` для `plans.${key}.features.${i}`)
- Описание: Число пунктов "benefits"/"features" на карточку жёстко зашито как литеральный массив индексов, без опоры на фактическую структуру `messages/*.json`. В Pricing есть защита через `t(..., { default: "" })` и `if (!feature) return null`, но в UseCases такой защиты нет — `t()` вызывается для ключей `1`, `2`, `3` безусловно.
- Влияние: Если контент-редактор добавит 4-й "benefit" в JSON (актуально, все use-cases сейчас ограничены тремя пунктами), он не отобразится, пока кто-то не найдёт и не поправит хардкод `[1, 2, 3]` в коде — тихая потеря контента без ошибки сборки.
- Серьёзность: Low
- Уверенность: средняя
- Рекомендация: Либо хранить количество пунктов как массив строк в самом JSON (`benefits: ["...", "...", "..."]`) и мапить по `.length`, либо явно документировать инвариант и добавить защиту от отсутствующего ключа, как уже сделано в Pricing.tsx.
- Вердикт: ПОДТВЕРЖДЕНО — `UseCases.tsx:56` вызывает `t()` для `[1,2,3]` без `{ default: "" }`/проверки, тогда как `Pricing.tsx:94-96` использует `t(..., { default: "" })` + `if (!feature) return null`; `messages/en.json` подтверждает, что у всех `UseCases.items.*` сейчас ровно 3 benefit-ключа (`1`,`2`,`3`).

### LANDING-QUAL-14: Ключи сравнительной таблицы Comparison продублированы в трёх местах
- Файл: landing/src/components/sections/Comparison.tsx:7-16 (массив `features`), 76 (`["offlineFirst", "selfHosted", "openApi"].includes(feature)`), 83 (`["offlineFirst", "selfHosted", "perAttendee"].includes(feature)`)
- Описание: Список фич хранится один раз в массиве `features`, но какие фичи отсутствуют у "Traditional Solutions" и "Competitors" задаётся отдельными литеральными массивами строк-ключей внутри JSX, без какой-либо связи с исходным массивом (TypeScript не проверяет, что строки из `.includes([...])` вообще существуют в `features`).
- Влияние: Переименование или удаление ключа фичи (например `openApi`) в массиве `features` не даст ошибки компиляции в местах `.includes(...)` — сравнение просто перестанет совпадать, и колонка "Traditional"/"Competitors" молча покажет неверную галочку/крестик.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Заменить на единую структуру данных вида `{ key, idento: true, traditional: boolean, competitors: boolean }[]`, чтобы значения для каждой колонки лежали рядом с самим ключом фичи.
- Вердикт: ПОДТВЕРЖДЕНО — `Comparison.tsx:7-16` объявляет массив `features` строк, а `:76` и `:83` независимо переопределяют пересекающиеся, но не идентичные литеральные массивы ключей через `.includes(...)` без типовой связи с исходным массивом.

### LANDING-QUAL-15: Мёртвые CSS-переменные для градиентов
- Файл: landing/src/styles/globals.css:52-53 (`--gradient-primary`, `--gradient-hero`)
- Описание: Обе custom properties объявлены в `:root`, но не встречаются больше нигде в `landing/src` (проверено grep) — ни в Tailwind-классах, ни в inline-стилях.
- Влияние: Незначительно — лишний неиспользуемый код в глобальном CSS, который может ввести в заблуждение при попытке переиспользовать "готовый" градиент.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Удалить неиспользуемые переменные либо реально применить их в Hero/FinalCTA вместо инлайновых `bg-gradient-to-*` классов, которые сейчас дублируют похожую идею через Tailwind-утилиты.
- Вердикт: ПОДТВЕРЖДЕНО — `globals.css:52-53` объявляет `--gradient-primary`/`--gradient-hero`; grep по `gradient-primary`/`gradient-hero` в `landing/src` не находит использований за пределами объявления.

### LANDING-QUAL-16: Неиспользуемый неймспейс "HomePage" в обоих i18n-каталогах
- Файл: landing/messages/en.json:2-19, landing/messages/ru.json:2-19 (аналогично)
- Описание: Неймспейс `HomePage` (title, hero.title/subtitle/cta_download/cta_pro, features.title/offline/secure/fast) не запрашивается ни разу через `useTranslations("HomePage")` нигде в `landing/src` (проверено grep) — используется только `Hero`/`Features` с другим, актуальным текстом.
- Влияние: Мёртвый контент в каталоге переводов, который придётся поддерживать переводчикам "на всякий случай"; расходится по смыслу с реально используемыми `Hero`/`Features` (например разные CTA: "Get Pro Version" в HomePage против "Start Free Trial" в Hero) — риск, что кто-то по ошибке начнёт править не тот неймспейс.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Удалить неймспейс `HomePage` из обоих файлов сообщений либо, если он зарезервирован под будущий редизайн, пометить комментарием/TODO с причиной.
- Вердикт: ПОДТВЕРЖДЕНО — `messages/en.json` содержит неймспейс `HomePage` (title/hero/features), grep по `useTranslations("HomePage")` в `landing/src` не даёт совпадений; CTA действительно расходится ("Get Pro Version" в HomePage vs "Start Free Trial"-подобный текст в `Hero`).

### LANDING-QUAL-17: Кнопки скачивания и "View Full Changelog" не имеют ни ссылки, ни обработчика
- Файл: landing/src/components/sections/Download.tsx:54-57 (`<Button className="w-full" variant="outline">...{t("cta")}</Button>`), 84-86 (`<Button variant="link" className="p-0 h-auto">{t("info.viewChangelog")} →</Button>`)
- Описание: Обе кнопки — не `asChild`-обёртки над `Link`/`<a>` (как это сделано, например, в Pricing.tsx и FinalCTA.tsx для их CTA), и не содержат `onClick`. Это просто `<button>` без какого-либо действия.
- Влияние: На странице, чья единственная задача — дать пользователю скачать десктопное/мобильное приложение, кнопки "Download" под каждой платформой и "View Full Changelog" визуально выглядят кликабельными, но ничего не делают при клике.
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Добавить реальные `href` на артефакты сборки (или временную страницу "скоро") через `asChild`+`Link`/`<a>`, по аналогии с остальными CTA в кодовой базе.
- Вердикт: ЧАСТИЧНО — код подтверждён (`Download.tsx:54-57,84-86` — `Button` без `asChild`/`href`/`onClick`), но это дублирует LANDING-BUG-01 один в один (тот же файл/строки/влияние); имеет смысл считать одной находкой, а не двумя независимыми.
