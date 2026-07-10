# План: Фаза 2C — Хардненинг принтер-агента Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть 3 Critical-находки принтер-агента (AGENT-SEC-01/02/03): добавить аутентификацию, привязать сервер к `127.0.0.1`, защитить от CSRF/relay — при минимальных правках клиентов (desktop шлёт токен, web остаётся на Origin).

**Architecture:** Работа в ветке `audit/phase2c-agent-hardening` от `main` (уже включает PR #14). Логика авторизации выносится в новый тестируемый пакет `agent/internal/httpauth` (первые тесты в `agent/`), который как middleware оборачивает существующий `http.ServeMux`. Агент генерирует shared-токен в `~/.idento/agent_config.json`; запрос авторизован, если он с loopback-Host, имеет `Content-Type: application/json` на мутациях, и предъявляет валидный Bearer-токен (desktop) ИЛИ Origin из allowlist (web). Desktop (Tauri Rust) читает токен из файла и шлёт `Authorization: Bearer`. Web не меняется (браузер сам шлёт Origin).

**Tech Stack:** Go 1.26 (stdlib `crypto/rand`, `crypto/subtle`, `net/http`, `net/http/httptest`), rs/cors (существующий), Rust/Tauri (reqwest, serde_json, std::fs).

## Global Constraints

- Ветка: `audit/phase2c-agent-hardening` от `main`. Все коммиты Фазы 2C — в неё.
- **Совместимость с CI (проверено в 2A/2B):** `go 1.25.4` + `toolchain go1.26.5` в `agent/go.mod` не менять; CI запускает `gosec` на backend+agent и `golangci-lint` (agent — `./...`). Каждая задача обязана оставлять `go build ./...`, `golangci-lint run ./...` (agent, 0 issues), `gosec ./...` (Issues:0), `govulncheck ./...` (чист) зелёными.
- **Дизайн (дословно из спека):** web — Origin-only (код web-аутентификации НЕ меняется); desktop — token; оба за localhost-bind + Origin/Content-Type.
- **Правила авторизации (из спека):** `/health` — без auth; для остальных: `Host` = loopback (анти-DNS-rebind); на POST/PUT/PATCH/DELETE — `Content-Type: application/json`; аутентификация = валидный `Authorization: Bearer <token>` ИЛИ `Origin` ∈ allowlist; иначе 401/403/415.
- **Дефолтный Origin allowlist:** `http://localhost:5173`, `http://localhost:5174`, `http://localhost:3000` (совпадает с текущим `rs/cors` в agent/main.go:1022). Переопределяется `AGENT_ALLOWED_ORIGINS` (CSV) и/или `allowed_origins` в конфиге.
- **Токен:** 32 случайных байта (`crypto/rand`) → hex; хранится в `~/.idento/agent_config.json` (`auth_token`), права файла `0600` (уже так в saveConfig). Логируется один раз при старте.
- **Точные факты (из разведки):** `agent/main.go` — `mux := http.NewServeMux()` (:234); `rs/cors` + `handler := c.Handler(mux)` (:1021-1028); `server.Addr = ":" + *port` (:1045); `AgentConfig{ NetworkPrinters, ScannerPorts, DefaultPrinter }` + loadConfig/saveConfig используют `~/.idento/agent_config.json`; `/health` хендлер существует. Desktop: `desktop/src-tauri/src/commands.rs` — `agent_request(method, path, body)` через reqwest на `http://127.0.0.1:12345{path}`, уже ставит `Content-Type: application/json` на POST с телом.
- **Вне охвата (backlog):** relay-валидация таргета `/printers/add`/`/print` (AGENT-SEC-04/05); AGENT-BUG/QUAL находки.

---

### Task 1: Пакет httpauth — middleware авторизации (TDD, первые тесты в agent/)

**Files:**
- Create: `agent/internal/httpauth/httpauth.go`
- Create: `agent/internal/httpauth/httpauth_test.go`

**Interfaces:**
- Produces:
  - `func New(token string, origins []string) *Authorizer`
  - `func (a *Authorizer) Middleware(next http.Handler) http.Handler`
  - (внутренняя, тестируется) `func (a *Authorizer) authorize(r *http.Request) (status int, ok bool)`

- [ ] **Step 1: Написать падающие тесты**

Создать `agent/internal/httpauth/httpauth_test.go`:

```go
package httpauth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func newReq(method, target, host, origin, contentType, auth string) *http.Request {
	r := httptest.NewRequest(method, target, nil)
	r.Host = host
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	if auth != "" {
		r.Header.Set("Authorization", auth)
	}
	return r
}

func TestAuthorize(t *testing.T) {
	a := New("secret-token-abc", []string{"http://localhost:5173"})

	cases := []struct {
		name   string
		req    *http.Request
		want   int
		wantOK bool
	}{
		{"health without auth", newReq("GET", "/health", "127.0.0.1:12345", "", "", ""), http.StatusOK, true},
		{"GET with allowlisted origin", newReq("GET", "/printers", "127.0.0.1:12345", "http://localhost:5173", "", ""), http.StatusOK, true},
		{"GET with valid token", newReq("GET", "/printers", "127.0.0.1:12345", "", "", "Bearer secret-token-abc"), http.StatusOK, true},
		{"POST json with token", newReq("POST", "/print", "127.0.0.1:12345", "", "application/json", "Bearer secret-token-abc"), http.StatusOK, true},
		{"POST json with allowlisted origin", newReq("POST", "/print", "127.0.0.1:12345", "http://localhost:5173", "application/json", ""), http.StatusOK, true},
		{"no auth at all", newReq("GET", "/printers", "127.0.0.1:12345", "", "", ""), http.StatusUnauthorized, false},
		{"foreign origin", newReq("GET", "/printers", "127.0.0.1:12345", "http://evil.example.com", "", ""), http.StatusUnauthorized, false},
		{"wrong token", newReq("GET", "/printers", "127.0.0.1:12345", "", "", "Bearer nope"), http.StatusUnauthorized, false},
		{"non-loopback host", newReq("GET", "/printers", "evil.example.com", "http://localhost:5173", "", "Bearer secret-token-abc"), http.StatusForbidden, false},
		{"POST without json content-type", newReq("POST", "/print", "127.0.0.1:12345", "http://localhost:5173", "text/plain", ""), http.StatusUnsupportedMediaType, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			status, ok := a.authorize(c.req)
			if ok != c.wantOK || status != c.want {
				t.Fatalf("authorize() = (%d, %v), want (%d, %v)", status, ok, c.want, c.wantOK)
			}
		})
	}
}

func TestMiddleware_RejectsUnauthorized(t *testing.T) {
	a := New("tok", []string{"http://localhost:5173"})
	called := false
	h := a.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true }))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, newReq("GET", "/printers", "127.0.0.1:12345", "", "", ""))
	if called {
		t.Fatal("next handler must not be called for unauthorized request")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}
```

- [ ] **Step 2: Запустить — RED**

Run: `cd /Users/thevladbog/PRSOME/idento/agent && go test ./internal/httpauth/ 2>&1 | tail -10`
Expected: ошибка компиляции — `undefined: New`. Это RED (пакет ещё не создан).

- [ ] **Step 3: Реализовать пакет**

Создать `agent/internal/httpauth/httpauth.go`:

```go
// Package httpauth guards the local printer agent's HTTP endpoints: it binds
// authorization to a loopback Host, requires JSON content-type on mutations,
// and accepts either a shared bearer token (desktop) or an allow-listed Origin
// (browser web app).
package httpauth

import (
	"crypto/subtle"
	"net"
	"net/http"
	"strings"
)

type Authorizer struct {
	token          string
	allowedOrigins map[string]struct{}
}

// New builds an Authorizer. An empty token disables token auth (Origin-only).
func New(token string, origins []string) *Authorizer {
	set := make(map[string]struct{}, len(origins))
	for _, o := range origins {
		if o = strings.TrimSpace(o); o != "" {
			set[o] = struct{}{}
		}
	}
	return &Authorizer{token: token, allowedOrigins: set}
}

// authorize decides whether a request may proceed. ok==true means allow;
// otherwise status is the HTTP rejection code.
func (a *Authorizer) authorize(r *http.Request) (int, bool) {
	if r.URL.Path == "/health" {
		return http.StatusOK, true
	}
	if !isLoopbackHost(r.Host) {
		return http.StatusForbidden, false
	}
	switch r.Method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			return http.StatusUnsupportedMediaType, false
		}
	}
	if a.validToken(r) || a.allowedOrigin(r) {
		return http.StatusOK, true
	}
	return http.StatusUnauthorized, false
}

func (a *Authorizer) validToken(r *http.Request) bool {
	if a.token == "" {
		return false
	}
	h := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if !strings.HasPrefix(h, prefix) {
		return false
	}
	got := strings.TrimPrefix(h, prefix)
	return subtle.ConstantTimeCompare([]byte(got), []byte(a.token)) == 1
}

func (a *Authorizer) allowedOrigin(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return false
	}
	_, ok := a.allowedOrigins[o]
	return ok
}

func isLoopbackHost(host string) bool {
	h := host
	if hh, _, err := net.SplitHostPort(host); err == nil {
		h = hh
	}
	if strings.EqualFold(h, "localhost") {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

// Middleware wraps next, rejecting unauthorized requests before they reach it.
func (a *Authorizer) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if status, ok := a.authorize(r); !ok {
			http.Error(w, http.StatusText(status), status)
			return
		}
		next.ServeHTTP(w, r)
	})
}
```

- [ ] **Step 4: GREEN**

Run: `cd /Users/thevladbog/PRSOME/idento/agent && go test ./internal/httpauth/ -v 2>&1 | tail -20`
Expected: все подтесты PASS.

- [ ] **Step 5: Гейты**

Run: `cd /Users/thevladbog/PRSOME/idento/agent && go build ./... && golangci-lint run ./... 2>&1 | tail -2 && gosec ./... 2>&1 | grep 'Issues :'`
Expected: сборка ок; линт 0; gosec `Issues : 0`.

- [ ] **Step 6: Commit**

```bash
cd /Users/thevladbog/PRSOME/idento
git add agent/internal/httpauth/
git commit -m "feat(agent): add httpauth middleware (loopback+json+token/origin) with tests (AGENT-SEC-01/03)"
```

---

### Task 2: Токен и allowlist в конфиге агента (TDD-хелперы)

**Files:**
- Modify: `agent/main.go` (структура `AgentConfig`; хелперы `ensureAuthToken`, `resolveAllowedOrigins`, `generateAuthToken`)
- Create: `agent/config_auth_test.go`

**Interfaces:**
- Produces:
  - `func generateAuthToken() (string, error)` — 64 hex-символа.
  - `func ensureAuthToken(cfg *AgentConfig) (bool, error)` — если `cfg.AuthToken` пуст, генерирует и ставит; возвращает `changed`.
  - `func resolveAllowedOrigins(cfg *AgentConfig) []string`
- Consumes: `AgentConfig` (main package).

- [ ] **Step 1: Падающие тесты**

Создать `agent/config_auth_test.go`:

```go
package main

import (
	"os"
	"testing"
)

func TestGenerateAuthToken(t *testing.T) {
	tok, err := generateAuthToken()
	if err != nil {
		t.Fatalf("generateAuthToken: %v", err)
	}
	if len(tok) != 64 { // 32 bytes hex
		t.Fatalf("want 64 hex chars, got %d (%q)", len(tok), tok)
	}
	tok2, _ := generateAuthToken()
	if tok == tok2 {
		t.Fatal("tokens must be random, got duplicate")
	}
}

func TestEnsureAuthToken(t *testing.T) {
	cfg := &AgentConfig{}
	changed, err := ensureAuthToken(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || cfg.AuthToken == "" {
		t.Fatalf("expected a token to be generated, changed=%v token=%q", changed, cfg.AuthToken)
	}
	// idempotent: second call keeps the existing token
	prev := cfg.AuthToken
	changed2, _ := ensureAuthToken(cfg)
	if changed2 || cfg.AuthToken != prev {
		t.Fatalf("second call must not change token")
	}
}

func TestResolveAllowedOrigins_Default(t *testing.T) {
	os.Unsetenv("AGENT_ALLOWED_ORIGINS")
	got := resolveAllowedOrigins(&AgentConfig{})
	if len(got) != 3 || got[0] != "http://localhost:5173" {
		t.Fatalf("unexpected default origins: %v", got)
	}
}

func TestResolveAllowedOrigins_EnvOverride(t *testing.T) {
	t.Setenv("AGENT_ALLOWED_ORIGINS", "https://app.example.com, https://kiosk.example.com ")
	got := resolveAllowedOrigins(&AgentConfig{})
	if len(got) != 2 || got[0] != "https://app.example.com" || got[1] != "https://kiosk.example.com" {
		t.Fatalf("env override not parsed: %v", got)
	}
}
```

- [ ] **Step 2: RED**

Run: `cd /Users/thevladbog/PRSOME/idento/agent && go test . -run 'TestGenerateAuthToken|TestEnsureAuthToken|TestResolveAllowedOrigins' 2>&1 | tail -10`
Expected: ошибка компиляции — `undefined: generateAuthToken` и т.д.

- [ ] **Step 3: Реализовать хелперы + расширить AgentConfig**

В `agent/main.go` добавить поля в `AgentConfig` (после существующих):

```go
type AgentConfig struct {
	NetworkPrinters []NetworkPrinterConfig `json:"network_printers"`
	ScannerPorts    []string               `json:"scanner_ports"`
	DefaultPrinter  string                 `json:"default_printer"`
	AuthToken       string                 `json:"auth_token,omitempty"`
	AllowedOrigins  []string               `json:"allowed_origins,omitempty"`
}
```

Добавить импорты `crypto/rand`, `encoding/hex` в main.go (сверить существующий блок импортов). Добавить хелперы:

```go
// generateAuthToken returns a 32-byte cryptographically-random token, hex-encoded.
func generateAuthToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// ensureAuthToken sets cfg.AuthToken if empty. Returns whether it changed cfg.
func ensureAuthToken(cfg *AgentConfig) (bool, error) {
	if cfg.AuthToken != "" {
		return false, nil
	}
	tok, err := generateAuthToken()
	if err != nil {
		return false, err
	}
	cfg.AuthToken = tok
	return true, nil
}

// resolveAllowedOrigins returns the browser Origin allowlist: env override
// (AGENT_ALLOWED_ORIGINS, CSV) first, then config, then dev defaults.
func resolveAllowedOrigins(cfg *AgentConfig) []string {
	if raw := os.Getenv("AGENT_ALLOWED_ORIGINS"); raw != "" {
		var out []string
		for _, o := range strings.Split(raw, ",") {
			if o = strings.TrimSpace(o); o != "" {
				out = append(out, o)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	if len(cfg.AllowedOrigins) > 0 {
		return cfg.AllowedOrigins
	}
	return []string{"http://localhost:5173", "http://localhost:5174", "http://localhost:3000"}
}
```

(`os` и `strings` уже импортированы в main.go.)

- [ ] **Step 4: GREEN + гейты**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/agent
go test . -run 'TestGenerateAuthToken|TestEnsureAuthToken|TestResolveAllowedOrigins' -v 2>&1 | tail -15
go build ./... && golangci-lint run ./... 2>&1 | tail -2 && gosec ./... 2>&1 | grep 'Issues :'
```
Expected: тесты PASS; сборка/линт/gosec чисты.

- [ ] **Step 5: Commit**

```bash
cd /Users/thevladbog/PRSOME/idento
git add agent/main.go agent/config_auth_test.go
git commit -m "feat(agent): auth_token + allowed_origins config with generation/resolution helpers"
```

---

### Task 3: Интеграция в main.go — localhost-bind, middleware, токен при старте

**Files:**
- Modify: `agent/main.go` (блок старта: bind, генерация токена, allowlist, обёртка mux, cors, лог)

**Interfaces:**
- Consumes: Task 1 (`httpauth.New`, `Middleware`), Task 2 (`ensureAuthToken`, `resolveAllowedOrigins`).

- [ ] **Step 1: Флаг host + bind на loopback (AGENT-SEC-02)**

В `agent/main.go` рядом с `port := flag.String("port", "12345", ...)` (:148) добавить:

```go
	host := flag.String("host", "127.0.0.1", "Host/interface to bind (default loopback; set 0.0.0.0 only if you understand the risk)")
```

Заменить `Addr: ":" + *port,` (:1045) на `Addr: *host + ":" + *port,`.

- [ ] **Step 2: Загрузить конфиг, сгенерировать токен, определить allowlist, обернуть mux**

Перед блоком `c := cors.New(...)` (:1021) добавить загрузку конфига и токена:

```go
	// Load config to obtain/create the agent auth token and origin allowlist.
	authCfg, err := loadConfig()
	if err != nil {
		authCfg = defaultConfig()
	}
	if changed, err := ensureAuthToken(authCfg); err != nil {
		log.Fatalf("Failed to generate agent auth token: %v", err)
	} else if changed {
		if err := saveConfig(authCfg); err != nil {
			log.Printf("Warning: could not persist agent auth token: %v", err)
		}
	}
	allowedOrigins := resolveAllowedOrigins(authCfg)
	authorizer := httpauth.New(authCfg.AuthToken, allowedOrigins)
```

Заменить блок cors + `handler := c.Handler(mux)` (:1021-1028) на согласованный с allowlist и обёрнутый авторизатором:

```go
	c := cors.New(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "Authorization"},
		AllowCredentials: true,
	})

	// cors handles preflight/response headers; authorizer enforces server-side.
	handler := c.Handler(authorizer.Middleware(mux))
```

Добавить импорт `"idento/agent/internal/httpauth"` в main.go.

- [ ] **Step 3: Логировать токен один раз при старте**

В стартовый баннер (`fmt.Printf` блок вокруг :1029-1041) добавить строку (после «Listening on»):

```go
	fmt.Printf("🔑 Auth token (desktop reads it from ~/.idento/agent_config.json):\n   %s\n", authCfg.AuthToken)
	fmt.Printf("🌐 Allowed browser origins: %v\n", allowedOrigins)
```

- [ ] **Step 4: Сборка + гейты + запуск-smoke**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/agent
go build ./... && echo BUILD_OK
golangci-lint run ./... 2>&1 | tail -2
gosec ./... 2>&1 | grep 'Issues :'
govulncheck ./... 2>&1 | tail -1
```
Expected: `BUILD_OK`; линт 0; gosec `Issues : 0`; govulncheck «No vulnerabilities found».

- [ ] **Step 5: Ручной smoke — авторизация работает**

Run (запустить агент в фоне на mock-режиме, затем проверить):
```bash
cd /Users/thevladbog/PRSOME/idento/agent
go run . -mock -port 12399 >/tmp/agent.log 2>&1 &
sleep 2
echo "health (no auth) →"; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:12399/health
echo "printers no auth →"; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:12399/printers
echo "printers with origin →"; curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: http://localhost:5173" http://127.0.0.1:12399/printers
TOKEN=$(grep -oE '[0-9a-f]{64}' ~/.idento/agent_config.json | head -1)
echo "printers with token →"; curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" http://127.0.0.1:12399/printers
echo "foreign origin →"; curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: http://evil.example.com" http://127.0.0.1:12399/printers
kill %1 2>/dev/null
```
Expected: health `200`; printers-no-auth `401`; with-origin `200`; with-token `200`; foreign-origin `401`. Если БД/окружение мешают — зафиксировать частичный результат в отчёте.

- [ ] **Step 6: Commit**

```bash
cd /Users/thevladbog/PRSOME/idento
git add agent/main.go
git commit -m "feat(agent): bind localhost + enforce auth middleware + token at startup (AGENT-SEC-01/02/03)"
```

---

### Task 4: Desktop — слать Authorization: Bearer из файла токена

**Files:**
- Modify: `desktop/src-tauri/src/commands.rs` (`agent_request`)

**Interfaces:**
- Consumes: токен из `~/.idento/agent_config.json` (написан агентом, Task 2/3).

- [ ] **Step 1: Хелпер чтения токена**

В `desktop/src-tauri/src/commands.rs` добавить функцию чтения токена из конфига агента. Проверить существующие импорты; при необходимости использовать `serde_json` (уже в графе Tauri) и `std::fs`. Домашний каталог — через `std::env::var("HOME")` (macOS/Linux) с фолбэком `USERPROFILE` (Windows):

```rust
fn read_agent_token() -> Option<String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    let path = format!("{}/.idento/agent_config.json", home);
    let data = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&data).ok()?;
    v.get("auth_token")?.as_str().map(|s| s.to_string())
}
```

- [ ] **Step 2: Добавить заголовок в запросы**

В `agent_request` при построении GET и POST добавить заголовок `Authorization: Bearer <token>`, если токен прочитан. Изменить ветки метода:

```rust
    let token = read_agent_token();

    let response = match method.to_uppercase().as_str() {
        "GET" => {
            let mut req = client.get(&url);
            if let Some(ref t) = token {
                req = req.header("Authorization", format!("Bearer {}", t));
            }
            req.send().await
        }
        "POST" => {
            let mut req = client.post(&url);
            if let Some(ref t) = token {
                req = req.header("Authorization", format!("Bearer {}", t));
            }
            if let Some(ref b) = body {
                req = req.header("Content-Type", "application/json").body(b.clone());
            }
            req.send().await
        }
        _ => return Err(format!("Unsupported method: {}", method)),
    }
    .map_err(|e| e.to_string())?;
```

(язык блока — Rust; синтаксис `let mut req` под reqwest builder. Сверить, что `reqwest` и `serde_json` доступны; `serde_json` есть у Tauri-приложения. Если `serde_json` не в зависимостях `desktop/src-tauri/Cargo.toml` — добавить `serde_json = "1"`.)

- [ ] **Step 3: Сборка Rust**

Run: `cd /Users/thevladbog/PRSOME/idento/desktop/src-tauri && cargo build 2>&1 | tail -8`
Expected: сборка проходит. При ошибке об отсутствии `serde_json` — добавить в Cargo.toml и повторить.

- [ ] **Step 4: Commit**

```bash
cd /Users/thevladbog/PRSOME/idento
git add desktop/src-tauri/src/commands.rs desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock
git commit -m "feat(desktop): send agent auth token as Bearer from ~/.idento/agent_config.json (AGENT-SEC-01)"
```

---

### Task 5: Проверка web + финальная верификация + summary + PR

**Files:**
- Read (verify, no change): `web/src/lib/agent.ts`
- Create: `docs/audit/phase2c-agent-hardening-summary.md`

**Interfaces:**
- Consumes: Task 1–4.

- [ ] **Step 1: Подтвердить, что web не требует правок аутентификации**

Прочитать `web/src/lib/agent.ts`. Убедиться: (а) POST-запросы к агенту идут через axios с JSON-телом (axios по умолчанию ставит `Content-Type: application/json` для объектов) — иначе middleware вернёт 415; (б) origin web-приложения (dev `http://localhost:5173`) входит в дефолтный allowlist. Если какой-то POST шлёт не-JSON (например, form-urlencoded или без тела с иным Content-Type) — отметить в отчёте как единственную требуемую правку web (выставить `Content-Type: application/json`), иначе — правок нет.

Run: `cd /Users/thevladbog/PRSOME/idento && grep -nE "axios\.(get|post)|Content-Type|headers" web/src/lib/agent.ts | head -30`
Expected: POST-вызовы передают объекты (axios → JSON). Зафиксировать вывод в отчёте.

- [ ] **Step 2: Финальная верификация агента**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/agent
go test ./... 2>&1 | tail -10
go build ./...
golangci-lint run ./... 2>&1 | tail -2
gosec ./... 2>&1 | grep 'Issues :'
govulncheck ./... 2>&1 | tail -1
```
Expected: тесты PASS; сборка ок; линт 0; gosec `Issues : 0`; govulncheck чист.

- [ ] **Step 3: Сводка**

Создать `docs/audit/phase2c-agent-hardening-summary.md`: находки AGENT-SEC-01/02/03 → статус (закрыто) → задача/коммит; как аутентифицируются web (Origin) и desktop (token); гейты; backlog (relay-валидация SEC-04/05, agent BUG/QUAL). Отметить операционные заметки: токен в `~/.idento/agent_config.json`; `AGENT_ALLOWED_ORIGINS` для прод-origin web; `--host` для осознанного оверрайда bind.

- [ ] **Step 4: Commit + PR**

```bash
cd /Users/thevladbog/PRSOME/idento
git add docs/audit/phase2c-agent-hardening-summary.md
git commit -m "docs(audit): Phase 2C agent-hardening summary"
git push -u origin audit/phase2c-agent-hardening
```

Открыть PR в `main` с описанием: закрыты AGENT-SEC-01/02/03; localhost-bind + auth middleware (token/origin); desktop шлёт токен; web на Origin (без правок); первые тесты в `agent/`. Дождаться зелёного CI (Gosec, Build Go, Lint Go; Build Desktop Tauri).
