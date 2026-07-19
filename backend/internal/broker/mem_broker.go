package broker

import (
	"context"
	"sync"

	"github.com/google/uuid"
)

var _ Broker = (*MemBroker)(nil)

// MemBroker is a pure in-process Broker: Publish fans a signal out to
// every channel currently Subscribed to that event, entirely in memory
// (map[uuid.UUID][]chan struct{} guarded by a mutex). It is used directly
// by every handler test that needs a Broker, and PGBroker wraps one to do
// its local, in-process delivery once a Postgres NOTIFY has round-tripped
// back to this process.
type MemBroker struct {
	mu   sync.Mutex
	subs map[uuid.UUID]map[chan struct{}]struct{}
}

// NewMemBroker constructs an empty MemBroker.
func NewMemBroker() *MemBroker {
	return &MemBroker{
		subs: make(map[uuid.UUID]map[chan struct{}]struct{}),
	}
}

// Publish signals every current subscriber of eventID. Delivery is
// drop-if-full: a subscriber whose 1-buffered channel already holds an
// unread signal simply coalesces — Publish never blocks, never spawns a
// goroutine, and never queues beyond that single buffered slot. Publishing
// to an event with no subscribers is a no-op. Publish itself never fails
// (the error return exists solely to satisfy Broker — PGBroker's Publish
// can fail on the network).
func (b *MemBroker) Publish(_ context.Context, eventID uuid.UUID) error {
	b.mu.Lock()
	defer b.mu.Unlock()

	for ch := range b.subs[eventID] {
		select {
		case ch <- struct{}{}:
		default:
			// Already has a pending, unread signal — coalesce.
		}
	}
	return nil
}

// BroadcastAll signals EVERY current subscriber across ALL events — unlike
// Publish, which is scoped to one eventID. It exists for PGBroker's
// post-reconnect resync (Finding B1, PR #81 bot-review round): NOTIFYs sent
// while the LISTEN connection was down are permanently lost (Postgres does
// not replay them), so once a fresh LISTEN is established there is no way
// to know which specific event(s) changed during the gap — the only correct
// recovery is to nudge every current subscriber to re-fetch via its normal
// update path, regardless of event. Same drop-if-full, never-blocks
// semantics as Publish (see its doc comment), just applied across the whole
// fanout map in one pass instead of one event's subscriber set.
func (b *MemBroker) BroadcastAll() {
	b.mu.Lock()
	defer b.mu.Unlock()

	for _, subs := range b.subs {
		for ch := range subs {
			select {
			case ch <- struct{}{}:
			default:
				// Already has a pending, unread signal — coalesce.
			}
		}
	}
}

// Subscribe registers a new 1-buffered channel for eventID. See
// Broker.Subscribe for the coalescing and idempotent-unsubscribe contract.
func (b *MemBroker) Subscribe(eventID uuid.UUID) (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)

	b.mu.Lock()
	if b.subs[eventID] == nil {
		b.subs[eventID] = make(map[chan struct{}]struct{})
	}
	b.subs[eventID][ch] = struct{}{}
	b.mu.Unlock()

	var once sync.Once
	unsubscribe := func() {
		once.Do(func() {
			b.mu.Lock()
			defer b.mu.Unlock()
			delete(b.subs[eventID], ch)
			if len(b.subs[eventID]) == 0 {
				delete(b.subs, eventID)
			}
		})
	}

	return ch, unsubscribe
}
