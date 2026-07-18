package broker

import (
	"context"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// listenStatement/notifyStatement are the exact SQL PGBroker issues on its
// two connection resources: LISTEN on the dedicated conn, NOTIFY through
// the small pool. Both sides agree on the same bare-UUID payload
// convention; see handleNotification.
const (
	listenStatement = "LISTEN checkin_events"
	notifyStatement = "SELECT pg_notify('checkin_events', $1::text)"
)

// Backoff bounds for the LISTEN connection's reconnect loop: starts at 1s
// and doubles on each consecutive failure up to a 30s cap.
const (
	reconnectBackoffInitial = 1 * time.Second
	reconnectBackoffMax     = 30 * time.Second
)

var _ Broker = (*PGBroker)(nil)

// PGBroker is a Broker backed by Postgres LISTEN/NOTIFY. It wraps a
// MemBroker for its local (in-process) fanout: Publish sends a NOTIFY
// through the broker's own small pool, and a single dedicated LISTEN
// connection running in a background goroutine forwards every notification
// it receives — including ones this very process published — back into
// the MemBroker. That round trip through Postgres is what lets a Publish
// issued on one replica reach Subscribers registered on any OTHER
// replica's PGBroker.
//
// PGStore's connection pool is not reachable from here — it's an
// unexported field behind a narrow dbConn interface, by design (plan-time
// fact 2 of docs/superpowers/plans/2026-07-18-panel-p4.2-live-monitor.md)
// — so PGBroker owns two connection resources of its own: the dedicated
// LISTEN pgx.Conn (which spends its whole life blocked in
// WaitForNotification and therefore cannot also run the NOTIFY query), and
// a MaxConns-2 pgxpool used exclusively for Publish.
type PGBroker struct {
	mem    *MemBroker
	pool   *pgxpool.Pool
	cancel context.CancelFunc
	done   chan struct{}
}

// NewPGBroker connects a dedicated LISTEN connection and a small (MaxConns
// 2) notify pool against dbURL, issues the initial LISTEN, starts the
// background forwarding loop, and returns. It does not retry on initial
// connection failure — that decision belongs to the caller (main.go, at
// process startup); listenLoop's own reconnect-with-backoff only takes
// over once the loop is already running.
func NewPGBroker(ctx context.Context, dbURL string) (*PGBroker, error) {
	poolCfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		return nil, err
	}
	poolCfg.MaxConns = 2

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}

	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		pool.Close()
		return nil, err
	}
	if _, err := conn.Exec(ctx, listenStatement); err != nil {
		closeConn(conn)
		pool.Close()
		return nil, err
	}

	// The loop's lifetime is governed by Close(), not by the ctx passed in
	// here (which may be request- or startup-scoped and could be cancelled
	// long before the broker should stop).
	loopCtx, cancel := context.WithCancel(context.Background())
	b := &PGBroker{
		mem:    NewMemBroker(),
		pool:   pool,
		cancel: cancel,
		done:   make(chan struct{}),
	}

	go b.listenLoop(loopCtx, conn, dbURL)

	return b, nil
}

// Publish executes `SELECT pg_notify('checkin_events', $1::text)` through
// the notify pool. It never touches the LISTEN connection (which is
// permanently blocked inside WaitForNotification and cannot also send a
// query on the same wire).
func (b *PGBroker) Publish(ctx context.Context, eventID uuid.UUID) error {
	_, err := b.pool.Exec(ctx, notifyStatement, eventID.String())
	return err
}

// Subscribe delegates directly to the wrapped MemBroker for local,
// in-process delivery. See Broker.Subscribe for the coalescing /
// idempotent-unsubscribe contract.
func (b *PGBroker) Subscribe(eventID uuid.UUID) (<-chan struct{}, func()) {
	return b.mem.Subscribe(eventID)
}

// Close stops the LISTEN loop (via context cancellation), waits for it to
// fully exit — which also closes the LISTEN connection — and then closes
// the notify pool. Intended to be called once (e.g. via defer in main.go,
// matching store.PGStore.Close's convention, pg_store.go); calling it
// again happens to be harmless too, since context.CancelFunc, reading from
// an already-closed channel, and pgxpool.Pool.Close are all safe to repeat.
func (b *PGBroker) Close() {
	b.cancel()
	<-b.done
	b.pool.Close()
}

// listenLoop owns the single dedicated LISTEN connection for the rest of
// PGBroker's life: it blocks in WaitForNotification, forwards each payload
// via handleNotification (the loop's only unit-testable logic — see that
// func's doc comment), and on any connection error closes the dead conn,
// backs off (1s, doubling to a 30s cap), reconnects, and re-issues LISTEN
// — indefinitely, until ctx is cancelled by Close.
//
// This loop itself is NOT unit-tested: exercising it requires a real
// Postgres connection to NOTIFY against (WaitForNotification blocks on a
// live wire-protocol read, and pgx.Conn has no fake/in-memory
// substitute), and this repo has no real-database CI harness for that —
// the same accepted posture as
// pg_store_checkin_composite_fk_integration_test.go's TEST_DATABASE_URL-
// gated (skip-not-fail) test. handleNotification carries everything here
// that IS unit-tested.
func (b *PGBroker) listenLoop(ctx context.Context, conn *pgx.Conn, dbURL string) {
	defer close(b.done)
	defer func() { closeConn(conn) }()

	for {
		notification, err := conn.WaitForNotification(ctx)
		if err != nil {
			if ctx.Err() != nil {
				// Close() was called; shut down cleanly.
				return
			}

			log.Printf("broker: LISTEN connection error, reconnecting: %v", err)
			closeConn(conn)

			var ok bool
			conn, ok = b.reconnect(ctx, dbURL)
			if !ok {
				// ctx was cancelled while reconnecting.
				return
			}
			continue
		}

		handleNotification(b.mem, notification.Payload)
	}
}

// reconnect retries pgx.Connect + LISTEN against dbURL with exponential
// backoff (1s doubling to a 30s cap) until it succeeds or ctx is
// cancelled. The bool return is false only when ctx was cancelled first.
func (b *PGBroker) reconnect(ctx context.Context, dbURL string) (*pgx.Conn, bool) {
	backoff := reconnectBackoffInitial
	for {
		select {
		case <-ctx.Done():
			return nil, false
		case <-time.After(backoff):
		}

		conn, err := pgx.Connect(ctx, dbURL)
		if err != nil {
			log.Printf("broker: reconnect failed: %v", err)
			backoff = nextBackoff(backoff)
			continue
		}
		if _, err := conn.Exec(ctx, listenStatement); err != nil {
			log.Printf("broker: re-LISTEN failed: %v", err)
			closeConn(conn)
			backoff = nextBackoff(backoff)
			continue
		}

		return conn, true
	}
}

func nextBackoff(cur time.Duration) time.Duration {
	next := cur * 2
	if next > reconnectBackoffMax {
		return reconnectBackoffMax
	}
	return next
}

func closeConn(conn *pgx.Conn) {
	if conn == nil {
		return
	}
	if err := conn.Close(context.Background()); err != nil {
		log.Printf("broker: error closing LISTEN connection: %v", err)
	}
}

// handleNotification parses payload as a uuid.UUID and forwards it into
// mem's fanout. It is factored out of listenLoop specifically so it's
// unit-testable without a live Postgres connection — see listenLoop's doc
// comment for why the loop itself isn't. A malformed (non-UUID, including
// empty) payload is logged and skipped, never propagated as an error or a
// panic: one bad NOTIFY payload must not take down the loop.
func handleNotification(mem *MemBroker, payload string) {
	eventID, err := uuid.Parse(payload)
	if err != nil {
		log.Printf("broker: skipping malformed notification payload %q: %v", payload, err)
		return
	}

	// MemBroker.Publish never actually returns a non-nil error today (see
	// its doc comment); checked here defensively so a future change can't
	// silently drop a forwarded signal without at least being logged.
	if err := mem.Publish(context.Background(), eventID); err != nil {
		log.Printf("broker: local fanout publish failed for %s: %v", eventID, err)
	}
}
