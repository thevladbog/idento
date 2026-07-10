# Web high-SEC — сводка (WEB-SEC-02/03/04)

| Находка | Серьёзность | Статус |
|---|---|---|
| WEB-SEC-02 ZPL-инъекция (QR/barcode) | High | ✅ закрыто — общий `escapeZplData` применён ко всем `^FD`-полям |
| WEB-SEC-03 stored XSS через Markdown | High | ✅ закрыто — `rehype-sanitize` в обоих `<ReactMarkdown>` (strip `javascript:`/raw HTML) |
| WEB-SEC-04 JWT в localStorage | High | ⚠️ частично — несущая митигация (устранение XSS-вектора) выполнена через SEC-03; добавлен строгий `referrer`-заголовок |

Гейты: `npm run build` (tsc+vite) + `eslint` зелёные; новых уязвимостей нет.

## WEB-SEC-04 — что осталось (backlog, требует решений)

Сама находка признаёт: httpOnly-cookie = backend-редизайн. Остаток:

1. **Миграция токена на httpOnly+Secure+SameSite cookie** — backend выставляет
   Set-Cookie на login, добавляется CSRF-защита, меняется axios-флоу. Крупный
   cross-cutting трек (backend+web), требует отдельного решения.
2. **Content-Security-Policy** — рекомендуемая политика:
   `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
   img-src 'self' data: blob:; connect-src 'self' https: http://localhost:8008
   http://localhost:12345; object-src 'none'; base-uri 'self';
   frame-ancestors 'none'`.
   **Почему не в этом PR:** статичный meta-CSP с `script-src 'self'` ломает Vite
   HMR в dev (Vite использует eval/inline); `connect-src` зависит от деплой-origin
   API (`VITE_API_URL`) и agent (`localhost:12345`). Нужен prod-only CSP (через
   заголовки хостинга или build-плагин) + проверка против запущенного стека
   (backend+agent). Оформить отдельно.

Понижение TTL `qr_token`/JWT — см. backlog модели токена (backend).
