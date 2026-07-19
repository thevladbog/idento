package handler

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"idento/backend/internal/broker"
	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// --- P4.2 Task 4: SSE monitor stream ---
//
// httptest.NewRecorder() cannot back these tests: it buffers the whole
// response into a bytes.Buffer with no way for a test goroutine to read
// frames as they're written without racing the handler goroutine's writes
// (a `go test -race` failure waiting to happen), and it has no real
// http.Flusher semantics anyway. Instead, every streaming test here runs
// the handler behind a REAL httptest.Server (echo.Context wraps the real
// net/http ResponseWriter, so Flush/WriteHeader/the request's
// cancel-on-disconnect Context all behave exactly as they do in
// production) and reads frames incrementally through a real http.Client +
// bufio.Reader — the httptest.NewServer approach the task brief called
// out as composing best with this package's existing echo test-context
// idiom (newAuthedContext et al.), which the ForeignEvent404 test below
// still uses directly since that path returns before any stream write.

// newMonitorStreamTestServer wires h.GetEventMonitorStream behind a real
// HTTP server (bypassing echo's router entirely — event_id and the "user"
// JWT claims are set directly on the echo.Context, mirroring
// newAuthedContext's claims shape). The returned channel is closed the
// moment the handler call returns, which is this file's proof that a
// disconnected/cancelled stream actually unwinds instead of leaking its
// goroutine.
func newMonitorStreamTestServer(t *testing.T, h *Handler, eventID, tenantID uuid.UUID) (*httptest.Server, <-chan struct{}) {
	t.Helper()
	e := echo.New()
	done := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(done)
		c := e.NewContext(r, w)
		c.SetParamNames("event_id")
		c.SetParamValues(eventID.String())
		c.Set("user", &models.JWTCustomClaims{
			UserID:   uuid.New().String(),
			TenantID: tenantID.String(),
			Role:     "staff",
		})
		if err := h.GetEventMonitorStream(c); err != nil {
			t.Errorf("GetEventMonitorStream: %v", err)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, done
}

// readSSEFrame reads one SSE frame (accumulated lines up to and including
// the blank line that terminates it) off r. The read happens on its own
// goroutine so a hung/broken stream fails the test via the timeout instead
// of hanging the whole suite; on timeout that goroutine simply blocks
// until t.Cleanup's srv.Close() forces the connection closed, at which
// point it sends into the (buffered, so non-blocking) result channel and
// exits — not a real leak beyond the test's own lifetime.
func readSSEFrame(t *testing.T, r *bufio.Reader, timeout time.Duration) string {
	t.Helper()
	type result struct {
		frame string
		err   error
	}
	ch := make(chan result, 1)
	go func() {
		var sb strings.Builder
		for {
			line, err := r.ReadString('\n')
			sb.WriteString(line)
			if err != nil {
				ch <- result{frame: sb.String(), err: err}
				return
			}
			if line == "\n" {
				ch <- result{frame: sb.String()}
				return
			}
		}
	}()
	select {
	case res := <-ch:
		if res.err != nil {
			t.Fatalf("read SSE frame: %v (partial: %q)", res.err, res.frame)
		}
		return res.frame
	case <-time.After(timeout):
		t.Fatalf("timed out after %s waiting for an SSE frame", timeout)
		return ""
	}
}

// TestGetEventMonitorStream_HelloFrameFirst proves the connection opens
// with the correct SSE headers and that the very first thing written is
// the hello frame, verbatim.
func TestGetEventMonitorStream_HelloFrameFirst(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	mem := broker.NewMemBroker()
	h := New(&fakeStore{getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil }})
	h.Broker = mem

	srv, _ := newMonitorStreamTestServer(t, h, event.ID, tenantID)

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("GET stream: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("Content-Type = %q, want text/event-stream", ct)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("Cache-Control = %q, want no-cache", cc)
	}

	r := bufio.NewReader(resp.Body)
	frame := readSSEFrame(t, r, 2*time.Second)
	if frame != "event: hello\ndata: {}\n\n" {
		t.Fatalf("first frame = %q, want the hello frame", frame)
	}
}

// TestGetEventMonitorStream_PublishTriggersUpdateFrame proves a
// broker.Publish for this event produces an "update" frame carrying an
// RFC3339 "at" timestamp. Publish is issued only AFTER the hello frame has
// been read — by that point the handler has already Subscribed (it
// subscribes before writing hello, see GetEventMonitorStream's doc
// comment), so this ordering can never race a not-yet-registered
// subscription.
func TestGetEventMonitorStream_PublishTriggersUpdateFrame(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	mem := broker.NewMemBroker()
	h := New(&fakeStore{getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil }})
	h.Broker = mem

	srv, _ := newMonitorStreamTestServer(t, h, event.ID, tenantID)

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("GET stream: %v", err)
	}
	defer resp.Body.Close()

	r := bufio.NewReader(resp.Body)
	_ = readSSEFrame(t, r, 2*time.Second) // hello

	if err := mem.Publish(context.Background(), event.ID); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	frame := readSSEFrame(t, r, 2*time.Second)
	if !strings.HasPrefix(frame, "event: update\ndata: {\"at\":\"") || !strings.HasSuffix(frame, "\"}\n\n") {
		t.Fatalf("update frame = %q, want event: update with an \"at\" RFC3339 timestamp", frame)
	}
	at := strings.TrimSuffix(strings.TrimPrefix(frame, "event: update\ndata: {\"at\":\""), "\"}\n\n")
	if _, err := time.Parse(time.RFC3339, at); err != nil {
		t.Fatalf("update frame's at = %q is not RFC3339: %v", at, err)
	}
}

// TestGetEventMonitorStream_PingKeepAlive proves the 25s-ticker keep-alive
// comment's exact wire shape, using a shrunk ping interval (restored via
// t.Cleanup) so the test doesn't need a real 25-second sleep.
func TestGetEventMonitorStream_PingKeepAlive(t *testing.T) {
	orig := monitorStreamPingInterval
	monitorStreamPingInterval = 20 * time.Millisecond
	t.Cleanup(func() { monitorStreamPingInterval = orig })

	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	mem := broker.NewMemBroker()
	h := New(&fakeStore{getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil }})
	h.Broker = mem

	srv, _ := newMonitorStreamTestServer(t, h, event.ID, tenantID)

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("GET stream: %v", err)
	}
	defer resp.Body.Close()

	r := bufio.NewReader(resp.Body)
	_ = readSSEFrame(t, r, 2*time.Second) // hello

	frame := readSSEFrame(t, r, 2*time.Second)
	if frame != ": ping\n\n" {
		t.Fatalf("frame = %q, want the ping keep-alive comment", frame)
	}
}

// TestGetEventMonitorStream_NilBrokerReturns503BeforeAnyStreamHeader proves
// the fail-closed design (Finding B4, CodeRabbit, PR #81 bot-review round):
// a Handler built without a Broker (an older &Handler{Store: fs} test
// literal, or a genuine misconfiguration) used to still serve hello+ping
// frames with no updates ever — a broken deployment would look healthy
// while monitors silently staled. It must now fail closed: a plain 503
// JSON body, in the house {"error": msg} shape, written BEFORE any
// text/event-stream header — never a half-open stream the client would
// have to notice and abandon (mirrors the 404 foreign-event precedent
// below in this same file).
func TestGetEventMonitorStream_NilBrokerReturns503BeforeAnyStreamHeader(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	h := New(&fakeStore{getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil }})
	// h.Broker intentionally left nil.

	e := echo.New()
	path := monitorStreamPath(event.ID)
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "staff")
	setMonitorStreamPathParams(c, event.ID)

	if err := h.GetEventMonitorStream(c); err != nil {
		t.Fatalf("GetEventMonitorStream: %v", err)
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get(echo.HeaderContentType); strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("Content-Type = %q — stream headers must never be set when Broker is nil", ct)
	}
	var body map[string]string
	if err := jsonUnmarshalBody(rec, &body); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if body["error"] == "" {
		t.Fatalf("body = %v, want the house {\"error\": msg} shape", body)
	}
	validateResponse(t, http.MethodGet, path, rec)
}

// TestGetEventMonitorStream_ClientDisconnectUnsubscribesCleanly proves the
// no-goroutine-leak requirement: once the client disconnects,
// GetEventMonitorStream must actually return (proven by the done channel
// newMonitorStreamTestServer closes right after the handler call), and its
// deferred unsubscribe must have run cleanly — proven by a second Publish
// to the same event not panicking (a broken unsubscribe leaving a stale
// entry in MemBroker's fanout map, e.g. a double-close or a send on a
// channel nobody drains anymore, is exactly the class of bug this would
// catch).
func TestGetEventMonitorStream_ClientDisconnectUnsubscribesCleanly(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	mem := broker.NewMemBroker()
	h := New(&fakeStore{getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil }})
	h.Broker = mem

	srv, done := newMonitorStreamTestServer(t, h, event.ID, tenantID)

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("GET stream: %v", err)
	}

	r := bufio.NewReader(resp.Body)
	_ = readSSEFrame(t, r, 2*time.Second) // hello — subscription is live by now.

	// Simulate the client going away: closing the body before the stream
	// naturally ends drops the underlying connection, which the server
	// notices via the request context's cancel-on-disconnect wiring (see
	// net/http.Request.Context's documented behavior).
	resp.Body.Close()

	select {
	case <-done:
		// GetEventMonitorStream returned — clean exit, deferred
		// unsubscribe/ticker.Stop() already ran on the way out.
	case <-time.After(2 * time.Second):
		t.Fatal("handler did not return after client disconnect (goroutine leak / stuck select)")
	}

	if err := mem.Publish(context.Background(), event.ID); err != nil {
		t.Fatalf("Publish after disconnect: %v", err)
	}
}

// monitorStreamPath/setMonitorStreamPathParams mirror monitorPath/
// setMonitorPathParams (openapi_contract_monitor_p4_test.go) for the
// stream's sibling route.
func monitorStreamPath(eventID uuid.UUID) string {
	return "/api/events/" + eventID.String() + "/monitor/stream"
}

func setMonitorStreamPathParams(c echo.Context, eventID uuid.UUID) {
	c.SetPath("/api/events/:event_id/monitor/stream")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
}

// TestOpenAPIContract_GetEventMonitorStream_ForeignEvent404 proves
// requireEventOwnership short-circuits BEFORE any stream header is
// written: a cross-tenant caller gets a masked, plain-JSON 404 — never a
// half-open text/event-stream response. Unlike the streaming tests above,
// this path returns synchronously without ever touching the response
// writer's Flush, so the ordinary httptest.NewRecorder()+validateResponse
// idiom this package uses everywhere else is safe here.
func TestOpenAPIContract_GetEventMonitorStream_ForeignEvent404(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	foreignTenantID := uuid.New()
	mem := broker.NewMemBroker()

	h := New(&fakeStore{getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil }})
	h.Broker = mem

	e := echo.New()
	path := monitorStreamPath(event.ID)
	c, rec := newAuthedContext(e, http.MethodGet, path, "", foreignTenantID.String(), "staff")
	setMonitorStreamPathParams(c, event.ID)

	if err := h.GetEventMonitorStream(c); err != nil {
		t.Fatalf("GetEventMonitorStream: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("Content-Type = %q — stream headers must never be set before requireEventOwnership passes", ct)
	}
	validateResponse(t, http.MethodGet, path, rec)
}

// TestOpenAPIContract_GetEventMonitorStream_CoverageException documents
// and satisfies the coverage-ledger exception for this route (P4.2 Task 4,
// plan-time fact 5, docs/superpowers/plans/2026-07-18-panel-p4.2-live-monitor.md):
// openapi3filter.ValidateResponse validates ONE complete response body
// against a schema; GetEventMonitorStream's 200 response is an indefinite
// sequence of frames read incrementally, which has no "complete body" to
// hand it. The 404 path above DOES run through validateResponse normally
// (it never streams). For the 200 path, the real behavioral assertions are
// the streaming tests above (hello frame, update-on-publish, the ping
// cadence, the nil-Broker fallback, and clean unsubscribe-on-disconnect);
// this test's only job is to mark the route covered in the SAME map
// validateResponse itself writes to, so assertSpecCoverage (gated by
// OPENAPI_COVERAGE=1) doesn't flag an untested documented operation.
func TestOpenAPIContract_GetEventMonitorStream_CoverageException(t *testing.T) {
	coverageMu.Lock()
	coverage["GET /api/events/{event_id}/monitor/stream"] = true
	coverageMu.Unlock()
}
