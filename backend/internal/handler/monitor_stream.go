package handler

import (
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// monitorStreamPingInterval is the SSE keep-alive cadence (P4.2 Task 4,
// spec §3.3): a `: ping\n\n` comment line is written+flushed on this tick
// so an idle-but-live connection never looks abandoned to an intermediary
// proxy/load balancer. A package var, not a const, so
// monitor_stream_test.go can shrink it to exercise the ping branch without
// a real 25-second sleep.
var monitorStreamPingInterval = 25 * time.Second

// GetEventMonitorStream serves GET /api/events/{event_id}/monitor/stream
// (P4.2 Task 4, spec §3.3) — the codebase's first Server-Sent Events
// endpoint. It is a deliberately "thin-ping" stream: frames carry no
// monitor state themselves, only a signal telling the client to re-fetch
// Task 3's GET .../monitor snapshot. Order matters: requireEventOwnership
// AND the nil-Broker check both run BEFORE any stream header is written,
// so a foreign/missing event still gets a plain 404 JSON body, and a
// misconfigured deployment (no Broker wired) gets a plain 503 — never a
// half-open event-stream response the client would have to notice and
// abandon.
//
// The handler blocks for the lifetime of the connection — that's the
// correct shape for a streaming handler, not a goroutine leak: it returns
// (unsubscribing on the way out via the deferred call) the moment the
// request context is cancelled, i.e. the client disconnects.
func (h *Handler) GetEventMonitorStream(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	// Fail closed (Finding B4, CodeRabbit, PR #81 bot-review round): a nil
	// Broker used to still serve hello+ping frames forever with no "update"
	// ever possible — a broken deployment would look healthy while every
	// attached monitor silently staled. Checked BEFORE any stream header is
	// written, same ordering discipline as requireEventOwnership above, so
	// the caller gets a normal, complete 503 JSON response instead of a
	// half-open stream.
	if h.Broker == nil {
		return writeErr(c, newHTTPError(http.StatusServiceUnavailable, "Live monitor stream unavailable: no event broker configured"))
	}

	res := c.Response()
	res.Header().Set(echo.HeaderContentType, "text/event-stream")
	res.Header().Set("Cache-Control", "no-cache")
	res.Header().Set("Connection", "keep-alive")
	res.WriteHeader(http.StatusOK)

	// Subscribe BEFORE writing the hello frame: that ordering guarantees
	// that by the time a client has observed hello, the subscription is
	// already live, so a Publish landing the instant afterward can never
	// be missed — see broker.Broker.Subscribe's coalescing contract
	// (1-buffered, drop-if-full) for why a signal delivered before the
	// select loop below starts running is still safely picked up once it
	// does. h.Broker is guaranteed non-nil past the check above.
	ch, unsubscribe := h.Broker.Subscribe(eventID)
	defer unsubscribe()

	if !writeSSEFrame(res, "event: hello\ndata: {}\n\n") {
		return nil
	}

	ticker := time.NewTicker(monitorStreamPingInterval)
	defer ticker.Stop()

	ctx := c.Request().Context()
	for {
		select {
		case <-ctx.Done():
			// Client disconnected (or the server is shutting down): clean
			// return, deferred unsubscribe/ticker.Stop() run on the way out.
			return nil
		case <-ch:
			frame := fmt.Sprintf("event: update\ndata: {\"at\":%q}\n\n", time.Now().UTC().Format(time.RFC3339))
			if !writeSSEFrame(res, frame) {
				return nil
			}
		case <-ticker.C:
			if !writeSSEFrame(res, ": ping\n\n") {
				return nil
			}
		}
	}
}

// writeSSEFrame writes one SSE frame and immediately flushes it (every
// frame must be individually flushed — the whole point of a thin-ping
// stream is that the client sees each signal the moment it's published,
// not whenever some buffer happens to fill). It returns false, swallowing
// the error, on a write failure: on a live HTTP connection that means the
// client already disconnected — the ordinary way an SSE stream ends, not
// an error worth surfacing (there is no response body left to report one
// into). The caller treats false as "return nil now."
func writeSSEFrame(res *echo.Response, frame string) bool {
	if _, err := res.Write([]byte(frame)); err != nil {
		return false
	}
	res.Flush()
	return true
}
