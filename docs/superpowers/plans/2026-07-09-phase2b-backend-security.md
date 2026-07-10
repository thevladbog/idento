# План: Фаза 2B — Backend security-фиксы Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть все Critical/High/Medium SEC-находки backend из аудита (`docs/audit/findings/backend-sec.md`): захардкоженные JWT-секреты, системное отсутствие tenant-изоляции, IDOR, утечку QR-токена, разрешающий CORS, CSV-инъекцию и отсутствие rate limiting — под TDD, с введением первого тестового харнесса в backend.

**Architecture:** Работа в ветке `audit/phase2b-backend-sec` от `main`. Вводим общий authz-хелпер (`internal/handler/authz.go`), резолвящий event/zone → tenant и сверяющий с claims из JWT, и применяем его ко всем незащищённым хендлерам по образцу уже существующих проверок в `attendees.go`. Тесты — на `httptest` + ручной fake, встраивающий интерфейс `store.Store` (переопределяем только нужные методы). Изменения серверные, контракт API для легитимных пользователей не меняется. Agent-хардненинг и frontend — отдельные планы.

**Tech Stack:** Go 1.26, Echo v4, golang-jwt v5, google/uuid; тесты — stdlib `testing` + `net/http/httptest` (без новых зависимостей, т.к. `store.Store` — интерфейс).

## Global Constraints

- Ветка: `audit/phase2b-backend-sec` от `main`. Все коммиты Фазы 2B — в неё.
- **Совместимость с CI (проверено в Фазе 2A):** `go 1.25.4` + `toolchain go1.26.5` в go.mod не менять; CI линтит `backend ./internal/...` через golangci-lint v2.12 и запускает gosec на backend+agent. Каждая задача обязана оставлять `golangci-lint run ./internal/...` и `gosec ./...` чистыми (0 issues) и `go build ./...` зелёным.
- **Установленный шаблон tenant-проверки** (дословно из `attendees.go:48-61`, воспроизводить именно так): получить claims `c.Get("user").(*models.JWTCustomClaims)`, распарсить `uuid.Parse(claims.TenantID)`, загрузить сущность `GetEventByID`, сверить `event.TenantID != tenantID` → 403 `{"error":"Access denied"}`; отсутствие сущности → 404; кривой токен → 401.
- **Формат ошибок:** JSON `map[string]string{"error": "<msg>"}` (доминирующий шаблон в backend) — сохранять его, не переходить на echo.HTTPError `{"message":...}`.
- **Точные типы (из разведки):** `models.JWTCustomClaims{ UserID, TenantID, Role string; jwt.RegisteredClaims }` (в `internal/models/auth.go`); `models.Event.TenantID uuid.UUID`; `models.EventZone.EventID uuid.UUID`; `models.User.QRToken *string json:"qr_token,omitempty"`, `PasswordHash string json:"-"`. `Handler{ Store store.Store }`. Store-методы: `GetEventByID(ctx, uuid.UUID) (*models.Event, error)`, `GetEventZoneByID(ctx, uuid.UUID) (*models.EventZone, error)`, `GetAttendeeByID(ctx, uuid.UUID) (*models.Attendee, error)`, `GetFontByID(ctx, uuid.UUID) (*models.Font, error)`, `GetUsersByTenantID(ctx, uuid.UUID) ([]*models.User, error)`, `GetZoneStaffAssignments(ctx, zoneID uuid.UUID) ([]*models.StaffZoneAssignment, error)`.
- **Вне охвата (в backlog):** BACKEND-SEC-13 (пароль в argv reset_password, Low); хеширование `qr_token` в БД (требует миграции — отдельный тикет; в этой фазе только убираем сериализацию токена наружу).
- Каждую находку в конце соответствующей задачи считать закрытой только после зелёного теста, воспроизводящего дыру ДО фикса (RED) и проходящего ПОСЛЕ (GREEN).

---

### Task 1: Тестовый харнесс + authz-хелпер (фундамент)

**Files:**
- Create: `backend/internal/handler/authz.go`
- Create: `backend/internal/handler/testsupport_test.go`
- Create: `backend/internal/handler/authz_test.go`

**Interfaces:**
- Produces:
  - `func tenantIDFromContext(c echo.Context) (uuid.UUID, error)`
  - `func (h *Handler) requireEventOwnership(c echo.Context, eventID uuid.UUID) (*models.Event, error)`
  - `func (h *Handler) requireZoneOwnership(c echo.Context, zoneID uuid.UUID) (*models.EventZone, *models.Event, error)`
  - `func writeErr(c echo.Context, err error) error` — рендерит `{"error":msg}` со статусом из `*httpError`, иначе 500.
  - Тест-хелперы (в `testsupport_test.go`): `type fakeStore struct{ store.Store; ... }`, `func newAuthedContext(e *echo.Echo, method, path, body, tenantID, role string) (echo.Context, *httptest.ResponseRecorder)`.

- [ ] **Step 1: Написать падающий тест на хелпер**

Создать `backend/internal/handler/authz_test.go`:

```go
package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestRequireEventOwnership_ForbidsForeignTenant(t *testing.T) {
	ownerTenant := uuid.New()
	callerTenant := uuid.New()
	eventID := uuid.New()

	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: ownerTenant}, nil
		},
	}
	h := &Handler{Store: fs}

	e := echo.New()
	c, _ := newAuthedContext(e, http.MethodGet, "/", "", callerTenant.String(), "admin")

	_, err := h.requireEventOwnership(c, eventID)
	if err == nil {
		t.Fatal("expected forbidden error for foreign tenant, got nil")
	}
	he, ok := err.(*httpError)
	if !ok || he.status != http.StatusForbidden {
		t.Fatalf("expected 403 httpError, got %#v", err)
	}
}

func TestRequireEventOwnership_AllowsOwnTenant(t *testing.T) {
	tenant := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenant}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, _ := newAuthedContext(e, http.MethodGet, "/", "", tenant.String(), "admin")

	ev, err := h.requireEventOwnership(c, eventID)
	if err != nil {
		t.Fatalf("expected nil error for own tenant, got %v", err)
	}
	if ev.TenantID != tenant {
		t.Fatalf("expected event tenant %s, got %s", tenant, ev.TenantID)
	}
}
```

- [ ] **Step 2: Написать тест-харнесс (fake + authed context)**

Создать `backend/internal/handler/testsupport_test.go`:

```go
package handler

import (
	"context"
	"net/http/httptest"
	"strings"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// fakeStore embeds store.Store so only the methods a test needs are overridden;
// any un-set method panics if called (which surfaces an unexpected dependency).
type fakeStore struct {
	store.Store
	getEventByID        func(id uuid.UUID) (*models.Event, error)
	getEventZoneByID    func(id uuid.UUID) (*models.EventZone, error)
	getAttendeeByID     func(id uuid.UUID) (*models.Attendee, error)
	getFontByID         func(id uuid.UUID) (*models.Font, error)
	getUsersByTenantID  func(tenantID uuid.UUID) ([]*models.User, error)
	getZoneStaffAssign  func(zoneID uuid.UUID) ([]*models.StaffZoneAssignment, error)
}

func (f *fakeStore) GetEventByID(_ context.Context, id uuid.UUID) (*models.Event, error) {
	return f.getEventByID(id)
}
func (f *fakeStore) GetEventZoneByID(_ context.Context, id uuid.UUID) (*models.EventZone, error) {
	return f.getEventZoneByID(id)
}
func (f *fakeStore) GetAttendeeByID(_ context.Context, id uuid.UUID) (*models.Attendee, error) {
	return f.getAttendeeByID(id)
}
func (f *fakeStore) GetFontByID(_ context.Context, id uuid.UUID) (*models.Font, error) {
	return f.getFontByID(id)
}
func (f *fakeStore) GetUsersByTenantID(_ context.Context, tenantID uuid.UUID) ([]*models.User, error) {
	return f.getUsersByTenantID(tenantID)
}
func (f *fakeStore) GetZoneStaffAssignments(_ context.Context, zoneID uuid.UUID) ([]*models.StaffZoneAssignment, error) {
	return f.getZoneStaffAssign(zoneID)
}

// newAuthedContext builds an echo.Context with JWT claims already set under "user",
// mimicking what middleware.JWT does, so handlers can be tested without a token.
func newAuthedContext(e *echo.Echo, method, path, body, tenantID, role string) (echo.Context, *httptest.ResponseRecorder) {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("user", &models.JWTCustomClaims{
		UserID:   uuid.New().String(),
		TenantID: tenantID,
		Role:     role,
	})
	return c, rec
}
```

- [ ] **Step 3: Запустить тест — убедиться, что не компилируется/падает**

Run: `cd /Users/thevladbog/PRSOME/idento/backend && go test ./internal/handler/ -run TestRequireEventOwnership 2>&1 | tail -20`
Expected: ошибка компиляции — `undefined: httpError`, `undefined: (*Handler).requireEventOwnership`. Это ожидаемый RED.

- [ ] **Step 4: Реализовать authz-хелпер**

Создать `backend/internal/handler/authz.go`:

```go
package handler

import (
	"net/http"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// httpError carries an HTTP status and a message for authz helpers; handlers
// render it via writeErr to keep the {"error": msg} response shape.
type httpError struct {
	status int
	msg    string
}

func (e *httpError) Error() string { return e.msg }

func newHTTPError(status int, msg string) *httpError { return &httpError{status: status, msg: msg} }

// writeErr renders an *httpError as {"error": msg} with its status; anything
// else becomes a 500. Handlers call: if err != nil { return writeErr(c, err) }.
func writeErr(c echo.Context, err error) error {
	if he, ok := err.(*httpError); ok {
		return c.JSON(he.status, map[string]string{"error": he.msg})
	}
	return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Internal error"})
}

// tenantIDFromContext parses the caller's tenant UUID from JWT claims set by middleware.JWT.
func tenantIDFromContext(c echo.Context) (uuid.UUID, error) {
	claims, ok := c.Get("user").(*models.JWTCustomClaims)
	if !ok || claims == nil {
		return uuid.Nil, newHTTPError(http.StatusUnauthorized, "Invalid token")
	}
	tenantID, err := uuid.Parse(claims.TenantID)
	if err != nil {
		return uuid.Nil, newHTTPError(http.StatusUnauthorized, "Invalid token")
	}
	return tenantID, nil
}

// requireEventOwnership loads the event and verifies it belongs to the caller's tenant.
func (h *Handler) requireEventOwnership(c echo.Context, eventID uuid.UUID) (*models.Event, error) {
	tenantID, err := tenantIDFromContext(c)
	if err != nil {
		return nil, err
	}
	event, err := h.Store.GetEventByID(c.Request().Context(), eventID)
	if err != nil || event == nil {
		return nil, newHTTPError(http.StatusNotFound, "Event not found")
	}
	if event.TenantID != tenantID {
		return nil, newHTTPError(http.StatusForbidden, "Access denied")
	}
	return event, nil
}

// requireZoneOwnership resolves a zone to its event and verifies tenant ownership.
func (h *Handler) requireZoneOwnership(c echo.Context, zoneID uuid.UUID) (*models.EventZone, *models.Event, error) {
	zone, err := h.Store.GetEventZoneByID(c.Request().Context(), zoneID)
	if err != nil || zone == nil {
		return nil, nil, newHTTPError(http.StatusNotFound, "Zone not found")
	}
	event, err := h.requireEventOwnership(c, zone.EventID)
	if err != nil {
		return nil, nil, err
	}
	return zone, event, nil
}
```

- [ ] **Step 5: Запустить тесты — GREEN**

Run: `cd /Users/thevladbog/PRSOME/idento/backend && go test ./internal/handler/ -run TestRequireEventOwnership -v 2>&1 | tail -15`
Expected: PASS обоих тестов.

- [ ] **Step 6: Линт + сборка + gosec чистые**

Run: `cd /Users/thevladbog/PRSOME/idento/backend && go build ./... && golangci-lint run ./internal/... 2>&1 | tail -3 && gosec ./... 2>&1 | grep 'Issues :'`
Expected: сборка ок, `0 issues` линта, `Issues : 0` gosec.

- [ ] **Step 7: Commit**

```bash
cd /Users/thevladbog/PRSOME/idento
git add backend/internal/handler/authz.go backend/internal/handler/authz_test.go backend/internal/handler/testsupport_test.go
git commit -m "test,feat(backend): add test harness + authz ownership helpers (Phase 2B foundation)"
```

---

### Task 2: BACKEND-SEC-01 + SEC-02 — устранить захардкоженные JWT-секреты

**Files:**
- Modify: `backend/internal/middleware/jwt.go:28-34`
- Modify: `backend/main.go` (startup-проверка `JWT_SECRET`)
- Modify: `backend/internal/handler/qr_auth.go:45-46`
- Create: `backend/internal/middleware/jwt_test.go`

**Interfaces:**
- Consumes: `generateTokenForTenant` (auth.go) — переиспользуется в qr_auth.go.
- Produces: middleware.JWT отклоняет запросы при пустом `JWT_SECRET`; старт приложения падает при пустом `JWT_SECRET`.

- [ ] **Step 1: Падающий тест — JWT middleware не должен принимать токен при пустом секрете**

Создать `backend/internal/middleware/jwt_test.go`:

```go
package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestJWT_RejectsWhenSecretUnset(t *testing.T) {
	t.Setenv("JWT_SECRET", "") // no secret configured
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	// A token signed with the OLD removed fallback secret must NOT be accepted.
	// (Build the token at runtime with jwt.NewWithClaims signed by the old
	// fallback secret — do not embed a token literal in source; see the final
	// implementation in jwt_test.go which assembles the secret from parts.)
	req.Header.Set("Authorization", "Bearer "+tokenSignedWithOldFallbackSecret)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	called := false
	h := JWT()(func(c echo.Context) error { called = true; return nil })
	_ = h(c)

	if called {
		t.Fatal("handler must NOT be reached when JWT_SECRET is unset")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}
```

- [ ] **Step 2: Запустить — RED**

Run: `cd /Users/thevladbog/PRSOME/idento/backend && go test ./internal/middleware/ -run TestJWT_RejectsWhenSecretUnset 2>&1 | tail -12`
Expected: FAIL — сейчас middleware подставляет `idento_secret_key_change_me` и может пропустить/дойти до обработчика (или вернёт 401 по другой причине — если тест не падает из-за формата токена, всё равно оставляем его как регрессионный; ключевая проверка — фикс Step 3 гарантирует 401 именно из-за отсутствия секрета).

- [ ] **Step 3: Убрать fallback в jwt.go**

В `backend/internal/middleware/jwt.go` заменить блок резолвинга секрета (строки 28-34):

```go
			token, err := jwt.ParseWithClaims(tokenString, &models.JWTCustomClaims{}, func(token *jwt.Token) (interface{}, error) {
				secret := os.Getenv("JWT_SECRET")
				if secret == "" {
					return nil, errors.New("JWT_SECRET is not configured")
				}
				return []byte(secret), nil
			})
```

Добавить `"errors"` в импорты `jwt.go`.

- [ ] **Step 4: Fail-fast при старте (main.go)**

В `backend/main.go` сразу после загрузки `.env` (после блока `godotenv.Load`) и до старта сервера добавить:

```go
	if os.Getenv("JWT_SECRET") == "" {
		log.Fatal("JWT_SECRET is not set — refusing to start (set it in .env / environment)")
	}
```

(`os` и `log` уже импортированы в main.go.)

- [ ] **Step 5: Убрать хардкод в qr_auth.go (SEC-02)**

Прочитать `backend/internal/handler/qr_auth.go` вокруг строк 40-50. Заменить прямое подписание литералом на общий генератор. Текущий код содержит `token.SignedString([]byte("your-secret-key"))`. Заменить весь участок ручного создания и подписи токена на вызов существующей функции:

```go
	tokenString, err := generateTokenForTenant(user, user.TenantID.String(), user.Role)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to issue token"})
	}
```

(где `user` — уже загруженный по QR пользователь `*models.User` в этом обработчике; сверить имя переменной при чтении файла и адаптировать. Удалить теперь неиспользуемые импорты `jwt`/локальное создание claims, если они больше нигде в файле не нужны.)

- [ ] **Step 6: GREEN + сборка + gosec**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/backend
go test ./internal/middleware/ -run TestJWT_RejectsWhenSecretUnset -v 2>&1 | tail -8
go build ./... && golangci-lint run ./internal/... 2>&1 | tail -2 && gosec ./... 2>&1 | grep 'Issues :'
```
Expected: тест PASS; сборка ок; линт 0; gosec `Issues : 0` (в т.ч. пропали G101 по `your-secret-key`, если gosec его флагал).

- [ ] **Step 7: Commit**

```bash
cd /Users/thevladbog/PRSOME/idento
git add backend/internal/middleware/jwt.go backend/internal/middleware/jwt_test.go backend/main.go backend/internal/handler/qr_auth.go
git commit -m "fix(backend): remove hardcoded JWT secrets, fail-fast on missing JWT_SECRET (BACKEND-SEC-01, SEC-02)"
```

---

### Task 3: BACKEND-SEC-03 + SEC-04 — tenant-проверки в attendees/qr хендлерах

**Files:**
- Modify: `backend/internal/handler/attendees.go` (`GetAttendees`:97-110, `UpdateAttendeeHandler`)
- Modify: `backend/internal/handler/qr.go` (`GetAttendeeQR`:12-38)
- Create: `backend/internal/handler/attendees_authz_test.go`

**Interfaces:**
- Consumes: `requireEventOwnership` (Task 1).

- [ ] **Step 1: Падающие тесты — чужой tenant получает 403**

Создать `backend/internal/handler/attendees_authz_test.go`:

```go
package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestGetAttendees_ForbidsForeignTenant(t *testing.T) {
	ownerTenant := uuid.New()
	caller := uuid.New()
	eventID := uuid.New()

	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: ownerTenant}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/events/"+eventID.String()+"/attendees", "", caller.String(), "admin")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	_ = h.GetAttendees(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for foreign tenant, got %d", rec.Code)
	}
}
```

- [ ] **Step 2: RED**

Run: `cd /Users/thevladbog/PRSOME/idento/backend && go test ./internal/handler/ -run TestGetAttendees_ForbidsForeignTenant 2>&1 | tail -12`
Expected: FAIL — сейчас `GetAttendees` не проверяет tenant (вернёт 200/500, но не 403). Примечание: без фикса обработчик вызовет `GetAttendeesByEventID`, которого нет в fake → panic; тест это тоже зафиксирует как «дыра есть». После фикса до Store дело не дойдёт.

- [ ] **Step 3: Добавить проверку в GetAttendees**

В `backend/internal/handler/attendees.go` заменить тело `GetAttendees` (строки 97-110) на:

```go
func (h *Handler) GetAttendees(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}

	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	attendees, err := h.Store.GetAttendeesByEventID(c.Request().Context(), eventID)
	if err != nil {
		c.Logger().Error("Failed to fetch attendees: ", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch attendees"})
	}

	return c.JSON(http.StatusOK, attendees)
}
```

- [ ] **Step 4: Добавить проверку в UpdateAttendeeHandler**

Прочитать `UpdateAttendeeHandler` (помечен «For check-in status», маршрут `PUT /api/attendees/:id`). Он получает attendee по `:id` через `GetAttendeeByID`, затем обновляет статус чек-ина. Сразу после успешной загрузки `attendee` и до обновления добавить:

```go
	if _, err := h.requireEventOwnership(c, attendee.EventID); err != nil {
		return writeErr(c, err)
	}
```

(сверить имя переменной attendee при чтении; проверка ставится ПОСЛЕ получения attendee, т.к. нужен `attendee.EventID`.)

- [ ] **Step 5: Добавить проверку в GetAttendeeQR (SEC-04)**

Прочитать `backend/internal/handler/qr.go` (`GetAttendeeQR`, строки 12-38): он парсит `:id`, вызывает `GetAttendeeByID`, кодирует `attendee.Code`. Сразу после успешной загрузки attendee и до генерации QR добавить:

```go
	if _, err := h.requireEventOwnership(c, attendee.EventID); err != nil {
		return writeErr(c, err)
	}
```

- [ ] **Step 6: GREEN + сборка + линт + gosec**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/backend
go test ./internal/handler/ -run 'TestGetAttendees_ForbidsForeignTenant' -v 2>&1 | tail -8
go build ./... && golangci-lint run ./internal/... 2>&1 | tail -2 && gosec ./... 2>&1 | grep 'Issues :'
```
Expected: тест PASS; сборка/линт/gosec чистые.

- [ ] **Step 7: Commit**

```bash
cd /Users/thevladbog/PRSOME/idento
git add backend/internal/handler/attendees.go backend/internal/handler/qr.go backend/internal/handler/attendees_authz_test.go
git commit -m "fix(backend): enforce tenant ownership on GetAttendees, UpdateAttendee, GetAttendeeQR (BACKEND-SEC-03, SEC-04)"
```

---

### Task 4: BACKEND-SEC-05 — авторизация ZoneCheckIn (tenant + роль/staff)

**Files:**
- Modify: `backend/internal/handler/zones.go` (`ZoneCheckIn`:327-466)
- Create: `backend/internal/handler/zones_checkin_authz_test.go`

**Interfaces:**
- Consumes: `requireZoneOwnership` (Task 1), `GetZoneStaffAssignments`.

- [ ] **Step 1: Падающий тест — чек-ин в чужую зону запрещён**

Создать `backend/internal/handler/zones_checkin_authz_test.go`:

```go
package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestZoneCheckIn_ForbidsForeignTenant(t *testing.T) {
	ownerTenant := uuid.New()
	caller := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()

	fs := &fakeStore{
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID, IsActive: true}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: ownerTenant}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `{"zone_id":"` + zoneID.String() + `","attendee_code":"ABCD1234"}`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/zones/checkin", body, caller.String(), "admin")

	_ = h.ZoneCheckIn(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for foreign-tenant zone check-in, got %d", rec.Code)
	}
}
```

- [ ] **Step 2: RED**

Run: `cd /Users/thevladbog/PRSOME/idento/backend && go test ./internal/handler/ -run TestZoneCheckIn_ForbidsForeignTenant 2>&1 | tail -12`
Expected: FAIL — сейчас `ZoneCheckIn` не сверяет tenant (дойдёт до поиска attendee → panic на отсутствующем в fake `GetAttendeeByCode`, либо иной не-403 код).

- [ ] **Step 3: Вставить проверку владения в начало ZoneCheckIn**

В `backend/internal/handler/zones.go` в `ZoneCheckIn` заменить участок получения zone (после `c.Bind(&req)` и `ctx := ...`), где сейчас:

```go
	zone, err := h.Store.GetEventZoneByID(ctx, req.ZoneID)
	if err != nil || zone == nil {
		return c.JSON(http.StatusNotFound, models.ZoneCheckInResponse{Success: false, Error: "Zone not found"})
	}
```

на:

```go
	zone, _, err := h.requireZoneOwnership(c, req.ZoneID)
	if err != nil {
		if he, ok := err.(*httpError); ok {
			return c.JSON(he.status, models.ZoneCheckInResponse{Success: false, Error: he.msg})
		}
		return c.JSON(http.StatusInternalServerError, models.ZoneCheckInResponse{Success: false, Error: "Internal error"})
	}
```

(этот обработчик отвечает типом `models.ZoneCheckInResponse`, а не `map[string]string`, поэтому здесь разворачиваем `*httpError` вручную, а не через `writeErr`.)

- [ ] **Step 4: Добавить проверку роли/назначения на зону**

Сразу после проверки владения (Step 3) и получения claims добавить проверку, что вызывающий — admin/manager своего тенанта ИЛИ назначен staff на эту зону. Получить claims: `claims := c.Get("user").(*models.JWTCustomClaims)`. Добавить:

```go
	if claims.Role != "admin" && claims.Role != "manager" {
		callerID, err := uuid.Parse(claims.UserID)
		if err != nil {
			return c.JSON(http.StatusUnauthorized, models.ZoneCheckInResponse{Success: false, Error: "Invalid token"})
		}
		assignments, err := h.Store.GetZoneStaffAssignments(ctx, zone.ID)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, models.ZoneCheckInResponse{Success: false, Error: "Internal error"})
		}
		assigned := false
		for _, a := range assignments {
			if a.UserID == callerID {
				assigned = true
				break
			}
		}
		if !assigned {
			return c.JSON(http.StatusForbidden, models.ZoneCheckInResponse{Success: false, Error: "Not assigned to this zone"})
		}
	}
```

(сверить поле `UserID uuid.UUID` в `models.StaffZoneAssignment` при чтении; если имя иное — адаптировать. Если claims уже читаются ниже по коду для `CheckedInBy`, перенести чтение выше, чтобы не дублировать.)

- [ ] **Step 5: GREEN + сборка + линт + gosec**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/backend
go test ./internal/handler/ -run TestZoneCheckIn_ForbidsForeignTenant -v 2>&1 | tail -8
go build ./... && golangci-lint run ./internal/... 2>&1 | tail -2 && gosec ./... 2>&1 | grep 'Issues :'
```
Expected: PASS; чисто.

- [ ] **Step 6: Commit**

```bash
cd /Users/thevladbog/PRSOME/idento
git add backend/internal/handler/zones.go backend/internal/handler/zones_checkin_authz_test.go
git commit -m "fix(backend): authorize ZoneCheckIn by tenant + role/zone-assignment (BACKEND-SEC-05)"
```

---

### Task 5: BACKEND-SEC-06 — tenant-проверки во всех остальных хендлерах zones.go

**Files:**
- Modify: `backend/internal/handler/zones.go` (18 хендлеров, перечислены ниже)
- Create: `backend/internal/handler/zones_authz_test.go`

**Interfaces:**
- Consumes: `requireEventOwnership`, `requireZoneOwnership` (Task 1).

- [ ] **Step 1: Падающий тест на репрезентативный хендлер (GetEventZones по event_id и UpdateEventZone по zone_id)**

Создать `backend/internal/handler/zones_authz_test.go`:

```go
package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestGetEventZones_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: owner}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/", "", caller.String(), "admin")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	_ = h.GetEventZones(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}
}
```

- [ ] **Step 2: RED**

Run: `cd /Users/thevladbog/PRSOME/idento/backend && go test ./internal/handler/ -run TestGetEventZones_ForbidsForeignTenant 2>&1 | tail -12`
Expected: FAIL (нет проверки → не 403).

- [ ] **Step 3: Применить проверку владения ко всем 18 хендлерам**

Для КАЖДОГО хендлера из списка добавить проверку сразу после парсинга ID и до вызова Store. Два шаблона:

**Шаблон A — хендлеры с `event_id` в пути** (`CreateEventZone`, `GetEventZones`, `CreateZoneAccessRule`, `GetZoneAccessRules`, `BulkUpdateZoneAccessRules`): после `eventID, err := uuid.Parse(c.Param("event_id"))` (с валидацией) вставить:

```go
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}
```

**Шаблон B — хендлеры, оперирующие `zone_id`/`:id` зоны** (`GetEventZone`, `UpdateEventZone`, `DeleteEventZone`, `AssignStaffToZone`, `GetZoneStaff`, `RemoveStaffFromZone`, `GetZoneCheckins`): после парсинга zoneID вставить:

```go
	if _, _, err := h.requireZoneOwnership(c, zoneID); err != nil {
		return writeErr(c, err)
	}
```

**Хендлеры, оперирующие attendee-zone-access и историей** (`CreateAttendeeZoneAccess`, `GetAttendeeZoneAccess`, `UpdateAttendeeZoneAccess`, `DeleteAttendeeZoneAccess`, `GetAttendeeZoneHistory`, `GetUserZoneAssignments`): эти работают по `attendee_id`/`user_id`/`zone_id`. Для тех, что принимают `zone_id` — Шаблон B. Для работающих по `attendee_id` — получить attendee (`GetAttendeeByID`), затем `requireEventOwnership(c, attendee.EventID)`. Для `GetUserZoneAssignments` (по `user_id`) — сверить, что целевой `user_id` принадлежит тому же tenant, что вызывающий: загрузить пользователей тенанта или сверить `claims.TenantID`; если хендлер отдаёт назначения произвольного user — ограничить выдачу назначениями в зонах своего тенанта (при чтении реализации выбрать минимальный корректный вариант и отразить в отчёте задачи).

Прочитать каждый хендлер перед правкой; для каждого выбрать A или B по тому, какой ID доступен. Ни один из 18 не должен остаться без проверки.

- [ ] **Step 4: Проверить, что не осталось незащищённых обращений к Store в zones.go**

Run: `cd /Users/thevladbog/PRSOME/idento && grep -nE 'func \(h \*Handler\)' backend/internal/handler/zones.go | wc -l` и вручную сверить, что каждый хендлер содержит вызов `requireEventOwnership`/`requireZoneOwnership`/сверку tenant.
Expected: число хендлеров совпадает с числом добавленных проверок (кроме чисто вспомогательных функций без echo.Context).

- [ ] **Step 5: GREEN + сборка + линт + gosec**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/backend
go test ./internal/handler/ -run 'TestGetEventZones_ForbidsForeignTenant' -v 2>&1 | tail -8
go build ./... && golangci-lint run ./internal/... 2>&1 | tail -2 && gosec ./... 2>&1 | grep 'Issues :'
```
Expected: PASS; чисто.

- [ ] **Step 6: Commit**

```bash
cd /Users/thevladbog/PRSOME/idento
git add backend/internal/handler/zones.go backend/internal/handler/zones_authz_test.go
git commit -m "fix(backend): enforce tenant ownership across all zones handlers (BACKEND-SEC-06)"
```

---

### Task 6: BACKEND-SEC-07 — tenant-проверки в api_keys.go

**Files:**
- Modify: `backend/internal/handler/api_keys.go` (`CreateAPIKey`, `GetAPIKeys`, `RevokeAPIKey`:17-91)
- Create: `backend/internal/handler/api_keys_authz_test.go`

**Interfaces:**
- Consumes: `requireEventOwnership`. Все три маршрута содержат `:event_id` в пути (`/events/:event_id/api-keys[/:key_id]`).

- [ ] **Step 1: Падающий тест — создание ключа для чужого event запрещено**

Создать `backend/internal/handler/api_keys_authz_test.go`:

```go
package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestCreateAPIKey_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: owner}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/", `{"name":"x"}`, caller.String(), "admin")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	_ = h.CreateAPIKey(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}
}
```

- [ ] **Step 2: RED**

Run: `cd /Users/thevladbog/PRSOME/idento/backend && go test ./internal/handler/ -run TestCreateAPIKey_ForbidsForeignTenant 2>&1 | tail -12`
Expected: FAIL.

- [ ] **Step 3: Добавить проверку во все три хендлера**

В `CreateAPIKey`, `GetAPIKeys`, `RevokeAPIKey` (все читают `event_id` из пути) после парсинга `eventID` добавить:

```go
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}
```

Для `RevokeAPIKey` (путь `/events/:event_id/api-keys/:key_id`) — `event_id` также есть в пути, поэтому проверки владения событием достаточно; отзыв затем идёт по `key_id` в рамках уже проверенного события. (Прочитать файл; если какой-то из хендлеров парсит только `key_id` без `event_id` — тогда получить ключ и сверить через `event.TenantID` после `GetEventByID(key.EventID)`; но по маршрутам `event_id` присутствует у всех трёх.)

- [ ] **Step 4: GREEN + сборка + линт + gosec**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/backend
go test ./internal/handler/ -run TestCreateAPIKey_ForbidsForeignTenant -v 2>&1 | tail -8
go build ./... && golangci-lint run ./internal/... 2>&1 | tail -2 && gosec ./... 2>&1 | grep 'Issues :'
```
Expected: PASS; чисто.

- [ ] **Step 5: Commit**

```bash
cd /Users/thevladbog/PRSOME/idento
git add backend/internal/handler/api_keys.go backend/internal/handler/api_keys_authz_test.go
git commit -m "fix(backend): enforce tenant ownership on API key create/list/revoke (BACKEND-SEC-07)"
```

---

### Task 7: BACKEND-SEC-09 — tenant-проверки в fonts.go + CheckLimits на загрузку

**Files:**
- Modify: `backend/internal/handler/fonts.go` (`GetEventFonts`, `UploadEventFont`, `GetEventFontCSS`)
- Modify: `backend/internal/handler/handler.go:114` (добавить `middleware.CheckLimits` на POST fonts)
- Create: `backend/internal/handler/fonts_authz_test.go`

**Interfaces:**
- Consumes: `requireEventOwnership`. Маршруты содержат `:event_id`.

- [ ] **Step 1: Падающий тест — список шрифтов чужого event запрещён**

Создать `backend/internal/handler/fonts_authz_test.go`:

```go
package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestGetEventFonts_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: owner}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/", "", caller.String(), "admin")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	_ = h.GetEventFonts(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}
}
```

- [ ] **Step 2: RED**

Run: `cd /Users/thevladbog/PRSOME/idento/backend && go test ./internal/handler/ -run TestGetEventFonts_ForbidsForeignTenant 2>&1 | tail -12`
Expected: FAIL.

- [ ] **Step 3: Добавить проверку в три хендлера**

В `GetEventFonts`, `UploadEventFont`, `GetEventFontCSS` после парсинга `eventID` добавить:

```go
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}
```

Примечание: BACKEND-BUG-04 (неверное приведение типа контекста в `UploadEventFont`, дающее 401) — вне охвата этого плана (это BUG-находка Фазы 3); проверка владения ставится в любом случае, чтобы после фикса BUG-04 дыры не было.

- [ ] **Step 4: Навесить CheckLimits на загрузку шрифтов**

В `backend/internal/handler/handler.go` строку регистрации `api.POST("/events/:event_id/fonts", h.UploadEventFont)` заменить на:

```go
	api.POST("/events/:event_id/fonts", h.UploadEventFont, middleware.CheckLimits(h.Store, "fonts"))
```

(сверить допустимые строки-типы ресурсов в `middleware.CheckLimits`/`limits.go`; если тип `"fonts"` не поддержан лимитами — использовать ближайший поддерживаемый или пропустить этот шаг с пометкой в отчёте, не ломая сборку.)

- [ ] **Step 5: GREEN + сборка + линт + gosec**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/backend
go test ./internal/handler/ -run TestGetEventFonts_ForbidsForeignTenant -v 2>&1 | tail -8
go build ./... && golangci-lint run ./internal/... 2>&1 | tail -2 && gosec ./... 2>&1 | grep 'Issues :'
```
Expected: PASS; чисто.

- [ ] **Step 6: Commit**

```bash
cd /Users/thevladbog/PRSOME/idento
git add backend/internal/handler/fonts.go backend/internal/handler/handler.go backend/internal/handler/fonts_authz_test.go
git commit -m "fix(backend): enforce tenant ownership + limits on event fonts (BACKEND-SEC-09)"
```

---

### Task 8: BACKEND-SEC-08 — убрать сериализацию qr_token из ответов

**Files:**
- Modify: `backend/internal/models/models.go:43` (тег `QRToken`)
- Modify: `backend/internal/handler/qr_auth.go` (места, где `qr_token` возвращается при выдаче — оставить только там, где токен реально генерируется владельцу)
- Create: `backend/internal/handler/users_qrtoken_test.go`

**Interfaces:**
- Produces: `models.User.QRToken` больше не сериализуется в общих ответах; добавлено вычисляемое `HasQRToken bool`.

- [ ] **Step 1: Падающий тест — GET /api/users не должен раскрывать qr_token**

Создать `backend/internal/handler/users_qrtoken_test.go`:

```go
package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestGetUsers_DoesNotLeakQRToken(t *testing.T) {
	tenant := uuid.New()
	secret := "super-secret-qr-token"
	fs := &fakeStore{
		getUsersByTenantID: func(id uuid.UUID) ([]*models.User, error) {
			return []*models.User{{
				ID:        uuid.New(),
				TenantID:  tenant,
				Email:     "a@b.c",
				Role:      "admin",
				QRToken:   &secret,
				CreatedAt: time.Now(),
			}}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/users", "", tenant.String(), "manager")

	_ = h.GetUsers(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), secret) {
		t.Fatalf("qr_token leaked in GET /api/users response: %s", rec.Body.String())
	}
	// sanity: response is valid JSON array
	var out []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
}
```

- [ ] **Step 2: RED**

Run: `cd /Users/thevladbog/PRSOME/idento/backend && go test ./internal/handler/ -run TestGetUsers_DoesNotLeakQRToken 2>&1 | tail -12`
Expected: FAIL — сейчас `QRToken` сериализуется (`omitempty`), секрет попадает в тело.

- [ ] **Step 3: Изменить тег QRToken и добавить HasQRToken**

В `backend/internal/models/models.go` в структуре `User` заменить строку 43:

```go
	QRToken          *string    `json:"-"`
	HasQRToken       bool       `json:"has_qr_token"`
```

(поле `HasQRToken` — вычисляемое, не из БД; заполняется в местах, где формируется ответ, либо через метод. Простейший вариант — заполнять в хендлере `GetUsers`/`GetMe` перед сериализацией: `u.HasQRToken = u.QRToken != nil`.)

- [ ] **Step 4: Заполнять HasQRToken в GetUsers**

Прочитать `backend/internal/handler/users.go` (`GetUsers`). Перед `return c.JSON(...)` добавить цикл:

```go
	for _, u := range users {
		u.HasQRToken = u.QRToken != nil
	}
```

(если элементы — значения, а не указатели, использовать индексный доступ `users[i].HasQRToken = ...`.)

- [ ] **Step 5: Проверить места легитимной выдачи токена**

Прочитать `qr_auth.go`/`users.go` на предмет эндпоинта, который СОЗДАЁТ QR-токен и возвращает его владельцу (например, `POST /api/users/:id/qr-token`). Там токен должен по-прежнему возвращаться разово в явном поле ответа (например, отдельным DTO `{"qr_token": "..."}`), а не через сериализацию `models.User`. Если такой эндпоинт есть и он полагался на `json:"qr_token"` — вернуть токен явным map/DTO. Отразить найденное в отчёте задачи.

- [ ] **Step 6: GREEN + сборка + линт + gosec**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/backend
go test ./internal/handler/ -run TestGetUsers_DoesNotLeakQRToken -v 2>&1 | tail -8
go build ./... && golangci-lint run ./internal/... 2>&1 | tail -2 && gosec ./... 2>&1 | grep 'Issues :'
```
Expected: PASS; чисто.

- [ ] **Step 7: Commit**

```bash
cd /Users/thevladbog/PRSOME/idento
git add backend/internal/models/models.go backend/internal/handler/users.go backend/internal/handler/qr_auth.go backend/internal/handler/users_qrtoken_test.go
git commit -m "fix(backend): stop serializing qr_token in responses, expose has_qr_token (BACKEND-SEC-08)"
```

Примечание: хеширование `qr_token` в БД (как для паролей) — отдельный тикет (требует миграции схемы и изменения `GetUserByQRToken`), в этой задаче не выполняется.

---

### Task 9: BACKEND-SEC-10 — ограничить CORS через переменную окружения

**Files:**
- Modify: `backend/main.go:420-423`

**Interfaces:**
- Produces: origins берутся из `CORS_ALLOWED_ORIGINS` (CSV); дефолт — пусто → сервер не разрешает произвольные origin.

- [ ] **Step 1: Заменить wildcard CORS на env-allowlist**

В `backend/main.go` заменить блок CORS (строки 420-423) на:

```go
	corsOrigins := []string{}
	if raw := os.Getenv("CORS_ALLOWED_ORIGINS"); raw != "" {
		for _, o := range strings.Split(raw, ",") {
			if trimmed := strings.TrimSpace(o); trimmed != "" {
				corsOrigins = append(corsOrigins, trimmed)
			}
		}
	}
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: corsOrigins,
		AllowHeaders: []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAccept, echo.HeaderAuthorization},
	}))
```

Добавить `"strings"` в импорты main.go, если отсутствует.

- [ ] **Step 2: Задокументировать переменную в .env.example**

В `.env.example` добавить строку:

```
# Comma-separated list of allowed browser origins for the API (e.g. https://app.example.com,https://kiosk.example.com)
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:1420
```

(значения по умолчанию — типичные dev-порты Vite web/desktop; сверить фактические dev-порты в web/desktop vite-конфигах при чтении и указать корректные.)

- [ ] **Step 3: Сборка + линт + gosec**

Run: `cd /Users/thevladbog/PRSOME/idento/backend && go build ./... && golangci-lint run ./internal/... 2>&1 | tail -2 && gosec ./... 2>&1 | grep 'Issues :'`
Expected: сборка ок (main.go не входит в `./internal/...`, но должен компилироваться через `go build ./...`); линт/gosec чисты.

- [ ] **Step 4: Commit**

```bash
cd /Users/thevladbog/PRSOME/idento
git add backend/main.go .env.example
git commit -m "fix(backend): restrict CORS to CORS_ALLOWED_ORIGINS allowlist (BACKEND-SEC-10)"
```

---

### Task 10: BACKEND-SEC-11 — экранирование CSV-инъекции в экспорте

**Files:**
- Modify: `backend/internal/handler/attendee_codes.go` (`ExportAttendeesCSV`:116-171)
- Create: `backend/internal/handler/csv_escape_test.go`

**Interfaces:**
- Produces: `func sanitizeCSVField(s string) string` — экранирует ведущие `=`,`+`,`-`,`@`,таб,CR.

- [ ] **Step 1: Падающий тест на sanitizeCSVField**

Создать `backend/internal/handler/csv_escape_test.go`:

```go
package handler

import "testing"

func TestSanitizeCSVField(t *testing.T) {
	cases := map[string]string{
		"=HYPERLINK(1)": "'=HYPERLINK(1)",
		"+1":            "'+1",
		"-1":            "'-1",
		"@cmd":          "'@cmd",
		"normal":        "normal",
		"":              "",
	}
	for in, want := range cases {
		if got := sanitizeCSVField(in); got != want {
			t.Errorf("sanitizeCSVField(%q) = %q, want %q", in, got, want)
		}
	}
}
```

- [ ] **Step 2: RED**

Run: `cd /Users/thevladbog/PRSOME/idento/backend && go test ./internal/handler/ -run TestSanitizeCSVField 2>&1 | tail -8`
Expected: FAIL — `undefined: sanitizeCSVField`.

- [ ] **Step 3: Реализовать sanitizeCSVField и применить в экспорте**

В `backend/internal/handler/attendee_codes.go` добавить функцию:

```go
// sanitizeCSVField neutralizes CSV/formula injection by prefixing a single
// quote to values starting with a formula trigger (OWASP CSV injection).
func sanitizeCSVField(s string) string {
	if s == "" {
		return s
	}
	switch s[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + s
	}
	return s
}
```

Затем в `ExportAttendeesCSV` обернуть КАЖДОЕ строковое значение, записываемое в CSV (в частности `attendee.Code`, `Company`, `Position`, и все значения `CustomFields`), вызовом `sanitizeCSVField(...)`. Прочитать участок формирования строки CSV (строки 126-159) и применить обёртку к каждой записываемой ячейке.

- [ ] **Step 4: GREEN + сборка + линт + gosec**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/backend
go test ./internal/handler/ -run TestSanitizeCSVField -v 2>&1 | tail -8
go build ./... && golangci-lint run ./internal/... 2>&1 | tail -2 && gosec ./... 2>&1 | grep 'Issues :'
```
Expected: PASS; чисто.

- [ ] **Step 5: Commit**

```bash
cd /Users/thevladbog/PRSOME/idento
git add backend/internal/handler/attendee_codes.go backend/internal/handler/csv_escape_test.go
git commit -m "fix(backend): escape CSV formula injection in attendee export (BACKEND-SEC-11)"
```

---

### Task 11: BACKEND-SEC-12 — rate limiting на login/login-qr/checkin

**Files:**
- Modify: `backend/internal/handler/handler.go` (навесить rate-limit middleware на 3 маршрута)

**Interfaces:**
- Consumes: `github.com/labstack/echo/v4/middleware.RateLimiterWithConfig` (уже в echo, новые зависимости не нужны).

- [ ] **Step 1: Добавить rate limiter на чувствительные маршруты**

В `backend/internal/handler/handler.go` импортировать echo middleware (если ещё не импортирован под алиасом; в этом файле middleware — это `idento/backend/internal/middleware`, поэтому echo-middleware импортировать под алиасом, напр. `echomw "github.com/labstack/echo/v4/middleware"`). Создать общий limiter и навесить на 3 маршрута:

```go
	// In-memory rate limiter: 10 requests / minute per client IP for auth + check-in.
	authLimiter := echomw.RateLimiterWithConfig(echomw.RateLimiterConfig{
		Store: echomw.NewRateLimiterMemoryStoreWithConfig(echomw.RateLimiterMemoryStoreConfig{
			Rate:      rate.Limit(10.0 / 60.0), // 10 per minute
			Burst:     10,
			ExpiresIn: 3 * time.Minute,
		}),
	})
```

Применить к маршрутам:

```go
	auth.POST("/login", h.Login, authLimiter)
	auth.POST("/login-qr", h.LoginWithQR, authLimiter)
	api.POST("/zones/checkin", h.ZoneCheckIn, authLimiter)
```

Добавить импорты `"time"` и `"golang.org/x/time/rate"` (rate уже в графе зависимостей как indirect — при необходимости `go get golang.org/x/time/rate` переведёт в direct).

- [ ] **Step 2: Собрать и подтянуть зависимость**

Run: `cd /Users/thevladbog/PRSOME/idento/backend && go get golang.org/x/time/rate && go mod tidy && go build ./... 2>&1 | tail -5 && echo BUILD_OK`
Expected: `BUILD_OK`.

- [ ] **Step 3: Проверка вручную (smoke) — лимитер срабатывает**

Run (после старта сервера с корректным `DATABASE_URL` и `JWT_SECRET` — best-effort; если БД недоступна, пропустить и отметить в отчёте):
```bash
for i in $(seq 1 15); do curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8008/auth/login -H 'Content-Type: application/json' -d '{"email":"x@y.z","password":"bad"}'; done
```
Expected: после ~10 запросов появляются коды `429`.

- [ ] **Step 4: Линт + gosec**

Run: `cd /Users/thevladbog/PRSOME/idento/backend && golangci-lint run ./internal/... 2>&1 | tail -2 && gosec ./... 2>&1 | grep 'Issues :'`
Expected: линт 0; gosec `Issues : 0`.

- [ ] **Step 5: Commit**

```bash
cd /Users/thevladbog/PRSOME/idento
git add backend/internal/handler/handler.go backend/go.mod backend/go.sum
git commit -m "fix(backend): rate-limit login, login-qr and zone check-in (BACKEND-SEC-12)"
```

---

### Task 12: Финальная верификация Фазы 2B

**Files:**
- Create: `docs/audit/phase2b-backend-sec-summary.md`

**Interfaces:**
- Consumes: все правки Task 1–11.

- [ ] **Step 1: Полный прогон тестов + сканеров**

Run:
```bash
cd /Users/thevladbog/PRSOME/idento/backend
go test ./... 2>&1 | tail -20
go build ./...
golangci-lint run ./internal/... 2>&1 | tail -3
gosec ./... 2>&1 | grep 'Issues :'
govulncheck ./... 2>&1 | tail -1
```
Expected: все тесты PASS; сборка ок; линт 0; gosec `Issues : 0`; govulncheck «No vulnerabilities found».

- [ ] **Step 2: Сводка соответствия находкам**

Создать `docs/audit/phase2b-backend-sec-summary.md`: таблица «находка → статус (закрыто/частично/backlog) → задача/коммит → тест». Отметить в backlog: BACKEND-SEC-13 (Low), хеширование qr_token в БД (нужна миграция).

- [ ] **Step 3: Commit**

```bash
cd /Users/thevladbog/PRSOME/idento
git add docs/audit/phase2b-backend-sec-summary.md
git commit -m "docs(audit): Phase 2B backend security fix summary"
```

- [ ] **Step 4: PR**

Открыть PR ветки `audit/phase2b-backend-sec` в `main` с описанием закрытых находок (Critical: SEC-01/03/05; High: SEC-02/04/06/07/08; Medium: SEC-09/10/11/12), с указанием, что введён первый тестовый харнесс backend и каждая authz-дыра покрыта регрессионным тестом. Дождаться зелёного CI (Lint Go, Gosec, Test Go, Build Go).
