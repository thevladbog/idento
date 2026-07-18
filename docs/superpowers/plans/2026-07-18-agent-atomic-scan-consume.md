# Agent Atomic Scan Consumption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a genuinely atomic `POST /scan/consume` endpoint to the Idento hardware agent so a fast second barcode/QR scan can never be silently erased by the existing `GET /scan/last` + `POST /scan/clear` polling protocol (the race CodeRabbit flagged on panel PR #77, branch `panel/p4.1-checkin-loop`).

**Architecture:** Extract the scan buffer currently held as three local variables inside `func main()` (`scanDataMutex`, `lastScannedCode`, `lastScanTime`) into a small mutex-guarded `scanBuffer` type with a new `Consume()` method that reads and clears the buffer under a single critical section — eliminating the read/clear race by construction rather than by coordination. Extract the three `/scan/*` HTTP handlers out of `main()` into a `registerScanRoutes` function so they're testable via `net/http/httptest` without booting the whole agent. `GET /scan/last` and `POST /scan/clear` keep their exact current behavior (the panel client is not touched in this task — that's a separate follow-up gated on this agent release shipping).

**Tech Stack:** Go 1.25 (module `idento/agent`), standard library `net/http`/`net/http/httptest`/`sync`/`encoding/json`, existing `go.bug.st/serial`-based scanner package (unaffected).

## Global Constraints

- Module: `idento/agent` (agent/go.mod), Go 1.25.4 / toolchain go1.26.5. Run all Go commands from the `agent/` directory.
- Package: everything in this plan lives in `package main` at the agent module root, matching the existing convention (`main.go`, `config_auth_test.go` are all `package main`).
- CI runs `cd agent && go test -race -coverprofile=coverage.out -covermode=atomic ./...` and `golangci-lint run ./...` (v2.12) — new code must pass both. Verify locally with the same commands before considering a task done.
- `GET /scan/last` and `POST /scan/clear` are used today by `panel/src/shared/agent/agentClient.ts` — their request/response shape and behavior must not change. Do not touch any file under `panel/` in this plan.
- The agent has no CHANGELOG file and `openapi.yaml`'s `version: 1.1.0` field has not moved across the last three doc/behavior-sync commits (`4ae2236`, `df93727`, `419d8ea`) — do not invent a version bump or CHANGELOG entry; this repo's convention for the agent is simply keeping `openapi.yaml` and `README.md` in sync with the implementation.
- `mux.HandleFunc` routes registered on the agent's `http.ServeMux` are automatically wrapped by `authorizer.Middleware(mux)` (agent/main.go:1136) — no per-route auth code is needed or written in this plan.
- Every response body for `/scan/*` endpoints is the same JSON shape: `{"code": string, "time": RFC3339 timestamp}` (empty string / zero time `0001-01-01T00:00:00Z` when the buffer is empty), matching the existing `ScanData` schema in `agent/openapi.yaml`.

---

## File Structure

- Create: `agent/scan_buffer.go` — the `scanBuffer` type (`Set`, `Last`, `Clear`, `Consume`), package main.
- Create: `agent/scan_buffer_test.go` — unit + concurrency tests for `scanBuffer`.
- Create: `agent/scan_routes.go` — `registerScanRoutes(mux *http.ServeMux, buf *scanBuffer)` wiring `/scan/last`, `/scan/clear`, `/scan/consume`.
- Create: `agent/scan_routes_test.go` — HTTP-level tests for the three routes via `httptest`.
- Modify: `agent/main.go` — replace the three local scan vars and three inline handler closures with `scanBuffer` + `registerScanRoutes`.
- Modify: `agent/openapi.yaml` — document `POST /scan/consume`.
- Modify: `agent/README.md` — add the new endpoint to the API overview table.

---

### Task 1: `scanBuffer` type with atomic `Consume`

**Files:**
- Create: `agent/scan_buffer.go`
- Test: `agent/scan_buffer_test.go`

**Interfaces:**
- Produces: `type scanBuffer struct { ... }`, `func newScanBuffer() *scanBuffer`, `func (b *scanBuffer) Set(code string)`, `func (b *scanBuffer) Last() (code string, at time.Time)`, `func (b *scanBuffer) Clear()`, `func (b *scanBuffer) Consume() (code string, at time.Time)`. Task 3 (route wiring) and Task 4 (main.go wiring) call these exact names.

- [ ] **Step 1: Write the failing tests**

Create `agent/scan_buffer_test.go`:

```go
package main

import (
	"fmt"
	"sync"
	"testing"
)

func TestScanBuffer_InitiallyEmpty(t *testing.T) {
	buf := newScanBuffer()
	code, at := buf.Last()
	if code != "" || !at.IsZero() {
		t.Fatalf("expected empty buffer, got code=%q at=%v", code, at)
	}
}

func TestScanBuffer_SetThenLast_DoesNotClear(t *testing.T) {
	buf := newScanBuffer()
	buf.Set("A")

	code, at := buf.Last()
	if code != "A" || at.IsZero() {
		t.Fatalf("expected code=A with non-zero time, got code=%q at=%v", code, at)
	}

	// Last() must be read-only: calling it again returns the same value.
	code2, at2 := buf.Last()
	if code2 != "A" || at2 != at {
		t.Fatalf("Last() must not mutate the buffer, got code=%q at=%v (want code=A at=%v)", code2, at2, at)
	}
}

func TestScanBuffer_Clear(t *testing.T) {
	buf := newScanBuffer()
	buf.Set("A")
	buf.Clear()

	code, at := buf.Last()
	if code != "" || !at.IsZero() {
		t.Fatalf("expected empty buffer after Clear, got code=%q at=%v", code, at)
	}
}

func TestScanBuffer_Consume_ReturnsAndClearsInOneCall(t *testing.T) {
	buf := newScanBuffer()
	buf.Set("A")

	code, at := buf.Consume()
	if code != "A" || at.IsZero() {
		t.Fatalf("expected Consume to return code=A with non-zero time, got code=%q at=%v", code, at)
	}

	// The buffer must now be empty: Consume cleared exactly what it returned.
	code2, at2 := buf.Last()
	if code2 != "" || !at2.IsZero() {
		t.Fatalf("expected buffer cleared after Consume, got code=%q at=%v", code2, at2)
	}
}

func TestScanBuffer_Consume_EmptyBufferReturnsZeroValue(t *testing.T) {
	buf := newScanBuffer()
	code, at := buf.Consume()
	if code != "" || !at.IsZero() {
		t.Fatalf("expected zero value from Consume on empty buffer, got code=%q at=%v", code, at)
	}
}

// TestScanBuffer_Consume_NeverDropsAScanArrivingBeforeConsumption reproduces
// the race CodeRabbit flagged on panel PR #77 (panel/p4.1-checkin-loop): with
// the old GET /scan/last + POST /scan/clear protocol, a second physical scan
// arriving between a poller's read and its later clear call was silently
// erased by that clear. Consume() collapses read+clear into a single
// critical section, so there is no window between them for a second Set()
// to land in — it either lands before this Consume() call (and is what gets
// returned) or after it (and survives untouched for the next call).
func TestScanBuffer_Consume_NeverDropsAScanArrivingBeforeConsumption(t *testing.T) {
	buf := newScanBuffer()
	buf.Set("A")

	// A poller reads the buffer (as GET /scan/last would) ...
	readCode, _ := buf.Last()
	if readCode != "A" {
		t.Fatalf("expected to read A, got %q", readCode)
	}

	// ... and before it gets a chance to clear what it read, a second
	// physical scan arrives.
	buf.Set("B")

	// The atomic consume must hand back the newer scan B — it was never
	// blind to it, unlike an unconditional POST /scan/clear at this point
	// would have been.
	consumedCode, _ := buf.Consume()
	if consumedCode != "B" {
		t.Fatalf("expected Consume to return the newer scan B (not silently dropped), got %q", consumedCode)
	}

	finalCode, finalAt := buf.Last()
	if finalCode != "" || !finalAt.IsZero() {
		t.Fatalf("expected buffer cleared after Consume, got code=%q at=%v", finalCode, finalAt)
	}
}

// TestScanBuffer_ConcurrentSetAndConsume_NoTornReads hammers Set and Consume
// from many goroutines at once. Run with `go test -race` (as CI does): the
// race detector catches any unsynchronized access, and the per-call
// assertion catches torn reads (a non-empty code paired with a zero time,
// which could only happen if a read observed the struct mid-write).
func TestScanBuffer_ConcurrentSetAndConsume_NoTornReads(t *testing.T) {
	buf := newScanBuffer()
	var wg sync.WaitGroup

	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			buf.Set(fmt.Sprintf("CODE-%d", n))
		}(i)
	}

	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			code, at := buf.Consume()
			if code != "" && at.IsZero() {
				t.Errorf("Consume returned non-empty code %q with zero time (torn read)", code)
			}
		}()
	}

	wg.Wait()

	// Whatever is left over must itself be internally consistent.
	code, at := buf.Last()
	if code != "" && at.IsZero() {
		t.Fatalf("final buffer state inconsistent: code=%q at=%v", code, at)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail to compile**

Run: `cd agent && go test ./... -run TestScanBuffer -v`
Expected: FAIL — `undefined: newScanBuffer` (scan_buffer.go does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `agent/scan_buffer.go`:

```go
package main

import (
	"sync"
	"time"
)

// scanBuffer holds the most recently scanned barcode/QR code behind a
// mutex. It is shared between the scanner's listen goroutine (Set) and the
// /scan/* HTTP handlers (Last, Clear, Consume).
type scanBuffer struct {
	mu   sync.Mutex
	code string
	at   time.Time
}

func newScanBuffer() *scanBuffer {
	return &scanBuffer{}
}

// Set records a freshly scanned code, overwriting whatever was buffered
// before it and stamping it with the current time.
func (b *scanBuffer) Set(code string) {
	b.mu.Lock()
	b.code = code
	b.at = time.Now()
	b.mu.Unlock()
}

// Last returns the currently buffered code without clearing it.
func (b *scanBuffer) Last() (code string, at time.Time) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.code, b.at
}

// Clear unconditionally empties the buffer.
func (b *scanBuffer) Clear() {
	b.mu.Lock()
	b.code = ""
	b.at = time.Time{}
	b.mu.Unlock()
}

// Consume atomically returns the buffered code and empties the buffer in
// the same critical section. Unlike a separate Last()-then-Clear() pair,
// there is no window between the read and the clear for another Set() to
// slip through unnoticed: a scan that arrives concurrently either happens
// before this call's lock (and is what gets returned) or after it (and
// survives for the next Consume()).
func (b *scanBuffer) Consume() (code string, at time.Time) {
	b.mu.Lock()
	defer b.mu.Unlock()
	code, at = b.code, b.at
	b.code = ""
	b.at = time.Time{}
	return code, at
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd agent && go test ./... -run TestScanBuffer -v -race`
Expected: PASS (all `TestScanBuffer_*` tests), no data race reported.

- [ ] **Step 5: Commit**

```bash
git add agent/scan_buffer.go agent/scan_buffer_test.go
git commit -m "feat(agent): add atomic scanBuffer.Consume to fix scan read/clear race"
```

---

### Task 2: `registerScanRoutes` — wire `/scan/last`, `/scan/clear`, and the new `/scan/consume`

**Files:**
- Create: `agent/scan_routes.go`
- Test: `agent/scan_routes_test.go`

**Interfaces:**
- Consumes: `newScanBuffer() *scanBuffer`, `(*scanBuffer).Set/Last/Clear/Consume` from Task 1.
- Produces: `func registerScanRoutes(mux *http.ServeMux, buf *scanBuffer)`. Task 4 (main.go wiring) calls this exact name/signature.

- [ ] **Step 1: Write the failing tests**

Create `agent/scan_routes_test.go`:

```go
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

type scanDataResponse struct {
	Code string `json:"code"`
	Time string `json:"time"`
}

func newScanTestServer() (*httptest.Server, *scanBuffer) {
	buf := newScanBuffer()
	mux := http.NewServeMux()
	registerScanRoutes(mux, buf)
	return httptest.NewServer(mux), buf
}

func TestScanRoutes_Last_ReflectsBufferWithoutClearing(t *testing.T) {
	srv, buf := newScanTestServer()
	defer srv.Close()
	buf.Set("A")

	resp, err := http.Get(srv.URL + "/scan/last")
	if err != nil {
		t.Fatalf("GET /scan/last: %v", err)
	}
	defer resp.Body.Close()

	var got scanDataResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Code != "A" {
		t.Fatalf("expected code=A, got %q", got.Code)
	}

	// /scan/last must not clear the buffer.
	code, _ := buf.Last()
	if code != "A" {
		t.Fatalf("expected buffer to still hold A after GET /scan/last, got %q", code)
	}
}

func TestScanRoutes_Clear_RequiresPOST(t *testing.T) {
	srv, _ := newScanTestServer()
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/scan/clear")
	if err != nil {
		t.Fatalf("GET /scan/clear: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 for GET /scan/clear, got %d", resp.StatusCode)
	}
}

func TestScanRoutes_Clear_EmptiesBuffer(t *testing.T) {
	srv, buf := newScanTestServer()
	defer srv.Close()
	buf.Set("A")

	resp, err := http.Post(srv.URL+"/scan/clear", "application/json", nil)
	if err != nil {
		t.Fatalf("POST /scan/clear: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	code, _ := buf.Last()
	if code != "" {
		t.Fatalf("expected buffer cleared, got %q", code)
	}
}

func TestScanRoutes_Consume_RequiresPOST(t *testing.T) {
	srv, _ := newScanTestServer()
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/scan/consume")
	if err != nil {
		t.Fatalf("GET /scan/consume: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 for GET /scan/consume, got %d", resp.StatusCode)
	}
}

func TestScanRoutes_Consume_ReturnsAndClearsInOneRequest(t *testing.T) {
	srv, buf := newScanTestServer()
	defer srv.Close()
	buf.Set("A")

	resp, err := http.Post(srv.URL+"/scan/consume", "application/json", nil)
	if err != nil {
		t.Fatalf("POST /scan/consume: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var got scanDataResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Code != "A" {
		t.Fatalf("expected code=A, got %q", got.Code)
	}

	// The buffer must be empty immediately after the response — no separate
	// clear call is needed, and none is possible to race against.
	code, _ := buf.Last()
	if code != "" {
		t.Fatalf("expected buffer cleared after /scan/consume, got %q", code)
	}
}

func TestScanRoutes_Consume_EmptyBufferReturnsEmptyCode(t *testing.T) {
	srv, _ := newScanTestServer()
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/scan/consume", "application/json", nil)
	if err != nil {
		t.Fatalf("POST /scan/consume: %v", err)
	}
	defer resp.Body.Close()

	var got scanDataResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Code != "" {
		t.Fatalf("expected empty code from empty buffer, got %q", got.Code)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail to compile**

Run: `cd agent && go test ./... -run TestScanRoutes -v`
Expected: FAIL — `undefined: registerScanRoutes` (scan_routes.go does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `agent/scan_routes.go`:

```go
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"
)

// registerScanRoutes wires the /scan/* endpoints onto mux against the
// shared buf. Extracted out of main() so the atomic Consume behavior (the
// fix for the panel PR #77 read/clear race) is testable via httptest
// without booting the full agent (printers, scanners, auth, config).
func registerScanRoutes(mux *http.ServeMux, buf *scanBuffer) {
	mux.HandleFunc("/scan/last", func(w http.ResponseWriter, r *http.Request) {
		code, at := buf.Last()
		writeScanData(w, code, at)
	})

	mux.HandleFunc("/scan/clear", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		buf.Clear()
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "cleared"}); err != nil {
			log.Printf("Failed to encode response: %v", err)
		}
	})

	mux.HandleFunc("/scan/consume", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		code, at := buf.Consume()
		writeScanData(w, code, at)
	})
}

// writeScanData writes the shared ScanData JSON shape ({"code", "time"})
// used by /scan/last and /scan/consume.
func writeScanData(w http.ResponseWriter, code string, at time.Time) {
	response := map[string]interface{}{
		"code": code,
		"time": at,
	}

	// Marshal to bytes first to avoid partial writes on error.
	data, err := json.Marshal(response)
	if err != nil {
		log.Printf("Failed to marshal scan response: %v", err)
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(data); err != nil {
		log.Printf("Failed to write scan response: %v", err)
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd agent && go test ./... -run TestScanRoutes -v -race`
Expected: PASS (all `TestScanRoutes_*` tests).

- [ ] **Step 5: Commit**

```bash
git add agent/scan_routes.go agent/scan_routes_test.go
git commit -m "feat(agent): extract /scan/* handlers, add POST /scan/consume route"
```

---

### Task 3: Wire `scanBuffer` + `registerScanRoutes` into `main()`, remove the old inline handlers

**Files:**
- Modify: `agent/main.go:234-237` (local var declarations)
- Modify: `agent/main.go:291-296` (scanner `OnScan` callback)
- Modify: `agent/main.go:838-878` (inline `/scan/last` and `/scan/clear` handlers, replaced by one `registerScanRoutes` call)

**Interfaces:**
- Consumes: `newScanBuffer()`, `(*scanBuffer).Set`, `registerScanRoutes(mux, buf)` from Tasks 1–2.

- [ ] **Step 1: Replace the local scan buffer variables**

In `agent/main.go`, find (around line 234):

```go
	// For storing scanned data temporarily
	var scanDataMutex sync.Mutex
	var lastScannedCode string
	var lastScanTime time.Time
```

Replace with:

```go
	// For storing scanned data temporarily
	scanBuf := newScanBuffer()
```

- [ ] **Step 2: Update the scanner's `OnScan` callback**

Find (around line 291):

```go
				s.OnScan(func(data string) {
					scanDataMutex.Lock()
					lastScannedCode = data
					lastScanTime = time.Now()
					scanDataMutex.Unlock()
					log.Printf("📋 Scan received: %s", data)
				})
```

Replace with:

```go
				s.OnScan(func(data string) {
					scanBuf.Set(data)
					log.Printf("📋 Scan received: %s", data)
				})
```

- [ ] **Step 3: Replace the inline `/scan/last` and `/scan/clear` handlers with `registerScanRoutes`**

Find (around line 838):

```go
	mux.HandleFunc("/scan/last", func(w http.ResponseWriter, r *http.Request) {
		scanDataMutex.Lock()
		defer scanDataMutex.Unlock()

		// Return last scanned code (for polling)
		response := map[string]interface{}{
			"code": lastScannedCode,
			"time": lastScanTime,
		}

		// Marshal response to bytes first to avoid partial writes on error
		data, err := json.Marshal(response)
		if err != nil {
			log.Printf("Failed to marshal scan response: %v", err)
			http.Error(w, "Failed to encode response", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write(data); err != nil {
			log.Printf("Failed to write scan response: %v", err)
		}
	})

	mux.HandleFunc("/scan/clear", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		scanDataMutex.Lock()
		lastScannedCode = ""
		lastScanTime = time.Time{}
		scanDataMutex.Unlock()

		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "cleared"}); err != nil {
			log.Printf("Failed to encode response: %v", err)
		}
	})
```

Replace with:

```go
	registerScanRoutes(mux, scanBuf)
```

- [ ] **Step 4: Build and verify no leftover references**

Run: `cd agent && go build ./...`
Expected: builds cleanly. If `sync` or `time` become unused imports in main.go, `go build` will fail with "imported and not used" — check first with `grep -n "sync\.\|time\." agent/main.go`; both packages are still used elsewhere in `main.go` (`configMu sync.RWMutex`, `10 * time.Second` server timeouts, etc.), so no import changes are expected.

Run: `grep -n "scanDataMutex\|lastScannedCode\|lastScanTime" agent/main.go`
Expected: no output (all references removed).

- [ ] **Step 5: Run the full agent test suite**

Run: `cd agent && go test -race ./...`
Expected: PASS, all packages including the new `TestScanBuffer_*` and `TestScanRoutes_*` tests.

- [ ] **Step 6: Manual smoke test**

Run: `cd agent && go run . --mock --port 12399 &` then, once it logs `Listening on: http://127.0.0.1:12399`:

```bash
curl -s -X POST http://127.0.0.1:12399/scan/consume -H 'Content-Type: application/json'
```

Expected: `{"code":"","time":"0001-01-01T00:00:00Z"}` (no scanner hardware attached in `--mock` mode, so the buffer is empty — this just confirms the route is wired and returns the right shape). Stop the background process afterward (`kill %1` or the equivalent job-control command in your shell).

- [ ] **Step 7: Commit**

```bash
git add agent/main.go
git commit -m "refactor(agent): wire scanBuffer + registerScanRoutes into main()"
```

---

### Task 4: Document `POST /scan/consume` in `openapi.yaml`

**Files:**
- Modify: `agent/openapi.yaml`

**Interfaces:**
- Consumes: nothing code-level — this is documentation matching the route added in Task 2/3.

- [ ] **Step 1: Add a cross-reference note to `/scan/last`'s description**

In `agent/openapi.yaml`, find (around line 703):

```yaml
  /scan/last:
    get:
      tags:
        - Scan
      summary: Получить последний отсканированный код
      description: |
        Возвращает последний код, отсканированный любым подключенным сканером.
        Используется для polling при тестировании сканеров. Если сканирований
        не было, code — пустая строка, time — нулевое значение
        0001-01-01T00:00:00Z.
      responses:
```

Replace with:

```yaml
  /scan/last:
    get:
      tags:
        - Scan
      summary: Получить последний отсканированный код
      description: |
        Возвращает последний код, отсканированный любым подключенным сканером.
        Используется для polling при тестировании сканеров. Если сканирований
        не было, code — пустая строка, time — нулевое значение
        0001-01-01T00:00:00Z.

        ⚠️ Комбинация `GET /scan/last` + `POST /scan/clear` не атомарна: если
        второй скан приходит в промежутке между чтением и последующей
        очисткой, `POST /scan/clear` безусловно стирает и его — он теряется
        без возможности восстановления. Клиентам, которым нужно гарантированно
        не терять сканы, следует использовать `POST /scan/consume`.
      responses:
```

- [ ] **Step 2: Add a similar note to `/scan/clear`'s description**

Find (around line 721):

```yaml
  /scan/clear:
    post:
      tags:
        - Scan
      summary: Очистить последний скан
      description: Сбрасывает буфер последнего отсканированного кода
      responses:
```

Replace with:

```yaml
  /scan/clear:
    post:
      tags:
        - Scan
      summary: Очистить последний скан
      description: |
        Безусловно сбрасывает буфер последнего отсканированного кода —
        независимо от того, что в нём находится в момент вызова. См.
        предупреждение в описании `GET /scan/last` про гонку при связке с
        последующим чтением; для атомарного чтения+очистки используйте
        `POST /scan/consume`.
      responses:
```

- [ ] **Step 3: Add the new `/scan/consume` path**

Find (around line 738, the blank line between the `/scan/clear` responses block and `/openapi.yaml:`):

```yaml
                  status:
                    type: string
                    example: "cleared"

  /openapi.yaml:
```

Replace with:

```yaml
                  status:
                    type: string
                    example: "cleared"

  /scan/consume:
    post:
      tags:
        - Scan
      summary: Атомарно прочитать и очистить последний скан
      description: |
        Возвращает последний отсканированный код и одновременно очищает
        буфер — чтение и очистка выполняются под одной блокировкой на
        стороне агента, одной операцией. В отличие от связки
        `GET /scan/last` + `POST /scan/clear`, здесь исключено состояние
        гонки: скан, отсканированный между отдельным чтением и последующей
        очисткой, не может быть потерян — он либо войдёт в текущий ответ,
        либо останется в буфере нетронутым для следующего вызова
        `/scan/consume`. Если сканирований не было, code — пустая строка,
        time — нулевое значение 0001-01-01T00:00:00Z.
      responses:
        '200':
          description: Считанные и одновременно очищенные данные скана
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ScanData'

  /openapi.yaml:
```

- [ ] **Step 4: Validate the YAML is well-formed**

Run: `cd agent && python3 -c "import yaml, sys; yaml.safe_load(open('openapi.yaml'))" && echo OK`
Expected: `OK` (no YAML syntax errors). If `python3`/`pyyaml` is unavailable, instead start the agent (`go run . --mock`) and confirm `GET /openapi.yaml` and `GET /docs` still return `200` and render without errors.

- [ ] **Step 5: Commit**

```bash
git add agent/openapi.yaml
git commit -m "docs(agent): document POST /scan/consume in openapi.yaml"
```

---

### Task 5: Sync `README.md`'s endpoint table

**Files:**
- Modify: `agent/README.md`

- [ ] **Step 1: Add the new route to the endpoint overview table**

In `agent/README.md`, find (around line 67):

```markdown
| GET | `/scan/last` | Последний отсканированный код: `{code, time}` |
| POST | `/scan/clear` | Очистить буфер последнего скана |
```

Replace with:

```markdown
| GET | `/scan/last` | Последний отсканированный код: `{code, time}` (не атомарно с `/scan/clear`, см. `/docs`) |
| POST | `/scan/clear` | Очистить буфер последнего скана (безусловно) |
| POST | `/scan/consume` | Атомарно получить и очистить последний скан — без риска потерять скан, пришедший между чтением и очисткой |
```

- [ ] **Step 2: Commit**

```bash
git add agent/README.md
git commit -m "docs(agent): add POST /scan/consume to README endpoint table"
```

---

### Task 6: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite with race detection and coverage, matching CI exactly**

Run: `cd agent && go test -race -coverprofile=coverage.out -covermode=atomic ./...`
Expected: PASS, all packages.

- [ ] **Step 2: Run `go vet`**

Run: `cd agent && go vet ./...`
Expected: no output (clean).

- [ ] **Step 3: Run `golangci-lint`, matching CI's version/args**

Run: `cd agent && golangci-lint run ./...`
Expected: no issues reported. (CI pins `v2.12`; if the locally installed version differs and reports unrelated pre-existing findings, only new findings introduced by this plan's files — `scan_buffer.go`, `scan_routes.go`, `main.go` — are in scope to fix.)

- [ ] **Step 4: Build the agent binary**

Run: `cd agent && go build -o /tmp/idento-agent .`
Expected: builds cleanly, matching the CI "Build agent" step.

- [ ] **Step 5: Confirm the panel is untouched**

Run: `git status --short panel/`
Expected: no output — this plan must not have modified anything under `panel/` (the panel-side migration to `/scan/consume` is an explicit follow-up, not part of this task).

- [ ] **Step 6: Review the full diff**

Run: `cd agent && git diff --stat main.go scan_buffer.go scan_buffer_test.go scan_routes.go scan_routes_test.go openapi.yaml README.md`
Expected: matches the File Structure section above — no unrelated files touched.

No commit for this task — it is a verification-only checkpoint. If anything fails, fix it as part of the task that introduced the problem (re-open that task's commit with a fixup, or a new small commit) rather than bundling unrelated fixes here.

---

## Self-Review Notes

- **Spec coverage:** Atomic consume endpoint (Task 1–3, either design 1 or 2 from the spec — this plan picks design 1, `POST /scan/consume`, since the agent's scan state was already a single mutex-guarded read/write pair local to `main()`, making a combined atomic accessor the natural, minimal extension of the existing pattern). `openapi.yaml` documentation (Task 4). Tests matching existing conventions — `package main`, `testing.T`, table-free direct assertions like `config_auth_test.go` (Tasks 1–2), plus a concurrency test since CI runs `go test -race` (Task 1). CHANGELOG/version convention checked and confirmed not applicable (Global Constraints). Panel-side client changes explicitly excluded (Global Constraints, Task 6 Step 5).
- **Placeholder scan:** No TBD/TODO markers; every step has complete, runnable code or an exact command with expected output.
- **Type consistency:** `scanBuffer`, `newScanBuffer`, `Set`, `Last`, `Clear`, `Consume` are named identically across Tasks 1, 2, and 3. `registerScanRoutes(mux *http.ServeMux, buf *scanBuffer)` is named identically across Tasks 2 and 3.
