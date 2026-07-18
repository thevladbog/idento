// Package broker provides the event-fanout infrastructure backing the
// P4.2 live monitor's SSE stream — the codebase's first pub/sub seam. Its
// entire job is: let a Publish(eventID) call wake up every goroutine
// currently Subscribed to that event, without ever blocking the publisher.
//
// This package deliberately does not import the store package (and must
// never be imported BY it either) — it knows nothing about attendees,
// check-ins, tenants, or Postgres schema beyond a bare event UUID. That
// keeps the seam reusable and testable in isolation: MemBroker needs no
// database at all, and PGBroker's Postgres-specific logic is confined to
// pg_broker.go.
package broker

import (
	"context"

	"github.com/google/uuid"
)

// Broker is the seam the P4.2 monitor SSE handler (and check-in/undo/
// reprint/heartbeat publish sites) depend on.
type Broker interface {
	// Publish signals that eventID's monitor-visible state has changed.
	// Implementations must never block on a slow or absent subscriber.
	Publish(ctx context.Context, eventID uuid.UUID) error

	// Subscribe registers interest in eventID's changes. The returned
	// channel is 1-buffered: a pending signal coalesces with any later
	// Publish while it remains unread (drop-if-full) — a slow consumer
	// therefore never blocks the fanout and never accumulates an unbounded
	// backlog; it just eventually reads one signal and re-syncs from
	// scratch (this is what the SSE handler pairs with a full snapshot
	// re-fetch on every "update" frame, so a coalesced signal never means
	// stale data). The returned unsubscribe func is idempotent and safe to
	// call concurrently with Publish and with itself.
	Subscribe(eventID uuid.UUID) (<-chan struct{}, func())
}
