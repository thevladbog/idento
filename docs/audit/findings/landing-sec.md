# LANDING-SEC — landing/ (Next.js marketing site), БЕЗОПАСНОСТЬ

Область проверки: `landing/src/app/**`, `landing/src/components/**`, `landing/src/i18n/**`,
`landing/proxy.ts`, `landing/next.config.mjs`, `landing/next-sitemap.config.js`,
`landing/package.json`, `landing/public/**`.

Контекст: `landing/proxy.ts` в Next.js 16 — это переименованный файл `middleware.ts`
(константа `PROXY_FILENAME = 'proxy'` в `node_modules/next/dist/lib/constants.js`),
а не HTTP-реверс-прокси, форвардящий произвольные URL. Он не проксирует
запросы к сторонним хостам, не принимает URL от клиента для форвардинга —
поэтому классы уязвимостей "SSRF через прокси" / "проксирование произвольных
хостов без allowlist" к нему неприменимы: весь код прокси ограничен вызовом
`next-intl`-мидлвара и редиректом `'/'` → `'/en'` с жёстко заданным путём
назначения (не из пользовательского ввода). Серверных API-роутов (`app/api/**`),
server actions (`"use server"`), форм обратной связи/подписки и вызовов
`fetch`/`axios` к бэкенду в подсистеме нет — сайт полностью статический
(next-intl рендеринг + client components), поэтому связанные категории
находок (утечка секретов через API, небезопасная обработка пользовательского
ввода форм, XSS через ответы сервера) не применимы за неимением такого кода.

### LANDING-SEC-01: В next.config.mjs не заданы security-заголовки (CSP, X-Frame-Options, HSTS и др.)
- Файл: landing/next.config.mjs:5-8
- Описание: `nextConfig` — пустой объект (`const nextConfig = {};`), обёрнутый только `withNextIntl`. Функция `headers()` не определена, поэтому приложение не отправляет `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy` или `Permissions-Policy`. Next.js эти заголовки по умолчанию не добавляет.
- Влияние: Отсутствие `X-Frame-Options`/CSP `frame-ancestors` допускает встраивание сайта в `<iframe>` на стороннем домене (clickjacking на CTA/кнопки "Скачать", "Купить"). Отсутствие CSP убирает второй рубеж защиты от XSS (в т.ч. на случай будущего добавления форм/скриптов третьих сторон, например аналитики). Отсутствие HSTS повышает риск downgrade/SSL-stripping атак при первом посещении по HTTP, если это не компенсируется на уровне CDN/хостинга.
- Серьёзность: Medium
- Уверенность: высокая
- Рекомендация: Добавить в `next.config.mjs` асинхронную функцию `headers()`, возвращающую для всех путей (`source: '/(.*)'`) как минимум `X-Frame-Options: DENY` (или `Content-Security-Policy: frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, и разумный `Content-Security-Policy` под используемые скрипты/шрифты.
- Вердикт: ПОДТВЕРЖДЕНО — `next.config.mjs:5-6` содержит только `const nextConfig = {};` без `headers()`, заголовки безопасности действительно не заданы.

### LANDING-SEC-02: Внешняя ссылка с target="_blank" без rel="noopener noreferrer" (reverse tabnabbing)
- Файл: landing/src/components/layout/Header.tsx:44-52 (десктоп-навигация) и 89-99 (мобильное меню); ссылка задаётся в navItems на строке 20 (`href: "https://docs.idento.app"`)
- Описание: Для внешнего пункта меню `docs.idento.app` (`item.external === true`) компонент `Link` из `next-intl`/`next/link` рендерится с `target={item.external ? "_blank" : undefined}`, но без атрибута `rel="noopener noreferrer"`. Проверено, что `next/link` (node_modules/next/dist/client/app-dir/link.js) не проставляет `rel` автоматически при `target="_blank"`. Для сравнения, в landing/src/components/layout/Footer.tsx:15-31 обычные `<a target="_blank">` корректно содержат `rel="noreferrer"`.
- Влияние: Открытая через `window.open`-подобный переход страница (`docs.idento.app`) получает доступ к `window.opener` и теоретически может переопределить `window.opener.location`, подменив исходную вкладку landing-страницы на фишинговую страницу (reverse tabnabbing). Практический риск снижен тем, что целевой домен — тот же продукт (Idento docs), но при компрометации поддомена документации или добавлении на него пользовательского контента риск станет реальным.
- Серьёзность: Low
- Уверенность: высокая
- Рекомендация: Добавить `rel="noopener noreferrer"` к обеим ссылкам с `target="_blank"` в Header.tsx (аналогично уже сделанному в Footer.tsx), либо вынести общий helper-компонент `ExternalLink` с этим атрибутом по умолчанию.
- Вердикт: ПОДТВЕРЖДЕНО — `Header.tsx:44-52` и `:89-99` рендерят `Link ... target={item.external ? "_blank" : undefined}` без `rel`; в `node_modules/next/dist/client/app-dir/link.js` нет автоподстановки `rel`/`noopener`; для сравнения `Footer.tsx:15-31` корректно содержит `rel="noreferrer"`.
