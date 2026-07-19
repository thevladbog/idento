package handler

import (
	"context"
	"log"
	"time"

	"github.com/google/uuid"
)

// publishCheckinTimeout bounds every detached Broker.Publish call
// publishCheckinEvent issues (PR #81 bot-review round, Finding B2b): a
// stalled Postgres must not hang the caller indefinitely. A package var,
// not a const, so event_publish_test.go can shrink it to exercise the
// timeout branch without a real 2-second wait — same idiom as
// monitor_stream.go's monitorStreamPingInterval.
var publishCheckinTimeout = 2 * time.Second

// publishCheckinEvent is the ONE shared call site every check-in-visible
// mutation funnels its monitor broker publish through — the four original
// P4.2 Task 4 sites (StationCheckin, UndoCheckin, MarkAttendeePrinted's
// reprint log, HeartbeatCheckinStation) and, per Finding B3, the three
// legacy write paths (UpdateAttendeeHandler, BatchCheckin, SyncPush) that
// never published before. It closes PR #81's Finding B2 (a)+(b) together:
//
//   - (a) riding the caller's ctx (the HTTP request's context, in every
//     current call site) would let a client disconnecting the INSTANT after
//     the store write already committed silently cancel the publish,
//     dropping a durable write's monitor signal for no reason tied to the
//     write itself. context.WithoutCancel derives a context that carries
//     over ctx's values but is never canceled by ctx's own
//     cancellation/deadline — exactly the "detach from the request, keep
//     nothing but a bounded lifetime of our own" shape this needs.
//   - (b) Publish runs synchronously, pre-response (every call site is
//     AFTER its store write already succeeded) — an unbounded call here
//     could hang the mutation response on a stalled broker (e.g. wedged
//     Postgres). Re-bounding the detached context with publishCheckinTimeout
//     caps the worst case to a small, fixed delay instead of forever.
//
// Nil-safe (h.Broker == nil is a silent no-op, matching every pre-existing
// call site's own `if h.Broker != nil` guard) and log-don't-fail (a Publish
// error — including the timeout firing — is logged and never surfaces to
// the caller, who has already committed and responded/is about to respond
// by the time this runs). Callers keep their own outcome-gating logic (e.g.
// StationCheckin only calls this on outcome=="checked_in") — this helper
// only owns the ctx/timeout/nil-safety/logging mechanics, never whether to
// publish at all.
func (h *Handler) publishCheckinEvent(ctx context.Context, eventID uuid.UUID) {
	if h == nil || h.Broker == nil {
		return
	}

	detached := context.WithoutCancel(ctx)
	pubCtx, cancel := context.WithTimeout(detached, publishCheckinTimeout)
	defer cancel()

	if err := h.Broker.Publish(pubCtx, eventID); err != nil {
		log.Printf("publish checkin event: broker publish failed: %v", err)
	}
}
