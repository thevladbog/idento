package handler

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// --- PR #81 bot-review round, Finding B2: detached, bounded publish helper -
//
// (a) All four P4.2 publish sites used to pass the HTTP request's own
// context straight into Broker.Publish — a client disconnecting right after
// the store commit cancels that context, silently dropping the monitor
// signal for a write that already durably happened. (b) Publish ran
// synchronously pre-response with no deadline of its own, so a stalled
// Postgres could hang a mutation response indefinitely. publishCheckinEvent
// closes both at once: it detaches from the caller's cancellation
// (context.WithoutCancel) and re-bounds the result with a short timeout, so
// every call site gets "fire, wait a little, log-don't-fail" instead of
// either of those failure modes.

// capturingBroker records the eventID and, more importantly, whether the
// context.Context it was handed was ALREADY canceled/errored at the moment
// Publish ran — the detachment proof for
// TestPublishCheckinEvent_CanceledRequestContextStillPublishes below.
// ctxErrAtCallTime is snapshotted synchronously inside Publish itself
// (never read from the outside after the call returns): publishCheckinEvent
// defers its own cancel() on the timeout-bounded context it constructs, so
// by the time the outer call returns that context is ALWAYS canceled
// (ordinary, correct resource cleanup) — the only meaningful moment to
// observe "was this ctx already dead when Publish began" is during the call.
type capturingBroker struct {
	published        bool
	ctxErrAtCallTime error
	publishedID      uuid.UUID
}

func (b *capturingBroker) Publish(ctx context.Context, eventID uuid.UUID) error {
	b.published = true
	b.ctxErrAtCallTime = ctx.Err()
	b.publishedID = eventID
	return nil
}

func (b *capturingBroker) Subscribe(uuid.UUID) (<-chan struct{}, func()) {
	return nil, func() {}
}

// TestPublishCheckinEvent_NilBrokerDoesNotPanic proves the helper is
// nil-safe exactly like every existing per-site `if h.Broker != nil` guard
// it replaces.
func TestPublishCheckinEvent_NilBrokerDoesNotPanic(t *testing.T) {
	h := &Handler{}
	h.publishCheckinEvent(context.Background(), uuid.New())
}

// TestPublishCheckinEvent_CanceledRequestContextStillPublishes is the
// detachment proof for Finding B2(a): a request context canceled BEFORE
// publishCheckinEvent is even called (simulating a client disconnecting the
// instant after the store write committed) must not stop the publish, and
// the context.Context Broker.Publish actually receives must not itself be
// the canceled one — context.WithoutCancel strips cancellation propagation
// while still deriving from ctx.
func TestPublishCheckinEvent_CanceledRequestContextStillPublishes(t *testing.T) {
	fb := &capturingBroker{}
	h := &Handler{Broker: fb}

	reqCtx, cancel := context.WithCancel(context.Background())
	cancel() // client already gone by the time we publish

	eventID := uuid.New()
	h.publishCheckinEvent(reqCtx, eventID)

	if !fb.published {
		t.Fatal("expected Broker.Publish to be called even though the request context was already canceled")
	}
	if fb.publishedID != eventID {
		t.Fatalf("published eventID = %s, want %s", fb.publishedID, eventID)
	}
	if fb.ctxErrAtCallTime != nil {
		t.Fatalf("ctx handed to Broker.Publish must not be canceled at call time, got Err() = %v", fb.ctxErrAtCallTime)
	}
}

// wedgedBroker's Publish never returns on its own — it only unblocks when
// its ctx is done (timeout/cancel) or the test explicitly releases it via
// unblock. This is how TestPublishCheckinEvent_BoundsAWedgedBrokerByTimeout
// simulates Finding B2(b)'s "stalled Postgres" scenario without a real
// database.
type wedgedBroker struct {
	unblock <-chan struct{}
}

func (b *wedgedBroker) Publish(ctx context.Context, _ uuid.UUID) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-b.unblock:
		return nil
	}
}

func (b *wedgedBroker) Subscribe(uuid.UUID) (<-chan struct{}, func()) {
	return nil, func() {}
}

// TestPublishCheckinEvent_BoundsAWedgedBrokerByTimeout proves Finding
// B2(b): a Broker.Publish that never returns on its own must not hang
// publishCheckinEvent forever — the detached context is itself
// timeout-bounded, so the call returns once that timeout fires. Uses the
// package var (shrunk here, restored via t.Cleanup) rather than a real 2s
// sleep — same idiom as monitor_stream.go's monitorStreamPingInterval.
func TestPublishCheckinEvent_BoundsAWedgedBrokerByTimeout(t *testing.T) {
	orig := publishCheckinTimeout
	publishCheckinTimeout = 20 * time.Millisecond
	t.Cleanup(func() { publishCheckinTimeout = orig })

	unblock := make(chan struct{})
	t.Cleanup(func() { close(unblock) })
	h := &Handler{Broker: &wedgedBroker{unblock: unblock}}

	done := make(chan struct{})
	go func() {
		defer close(done)
		h.publishCheckinEvent(context.Background(), uuid.New())
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("publishCheckinEvent did not return once its bounded timeout elapsed — Publish hung it")
	}
}
