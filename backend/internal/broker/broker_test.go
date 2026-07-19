package broker

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// --- MemBroker: routing ------------------------------------------------

func TestMemBroker_PublishOnlyDeliversToItsOwnEvent(t *testing.T) {
	b := NewMemBroker()
	eventA := uuid.New()
	eventB := uuid.New()

	chA, unsubA := b.Subscribe(eventA)
	defer unsubA()
	chB, unsubB := b.Subscribe(eventB)
	defer unsubB()

	if err := b.Publish(context.Background(), eventA); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	select {
	case <-chA:
	default:
		t.Fatal("expected eventA subscriber to receive a signal")
	}

	select {
	case <-chB:
		t.Fatal("eventB subscriber must not receive eventA's publish")
	default:
	}
}

func TestMemBroker_PublishSignalsAllSubscribersOfSameEvent(t *testing.T) {
	b := NewMemBroker()
	eventID := uuid.New()

	ch1, unsub1 := b.Subscribe(eventID)
	defer unsub1()
	ch2, unsub2 := b.Subscribe(eventID)
	defer unsub2()

	if err := b.Publish(context.Background(), eventID); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	for i, ch := range []<-chan struct{}{ch1, ch2} {
		select {
		case <-ch:
		default:
			t.Fatalf("subscriber %d did not receive a signal", i)
		}
	}
}

func TestMemBroker_PublishWithNoSubscribersIsNoop(t *testing.T) {
	b := NewMemBroker()

	if err := b.Publish(context.Background(), uuid.New()); err != nil {
		t.Fatalf("Publish to an event with no subscribers should be a no-op, got error: %v", err)
	}
}

// --- MemBroker: unsubscribe ---------------------------------------------

func TestMemBroker_UnsubscribeStopsDelivery(t *testing.T) {
	b := NewMemBroker()
	eventID := uuid.New()

	ch, unsubscribe := b.Subscribe(eventID)
	unsubscribe()

	if err := b.Publish(context.Background(), eventID); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	select {
	case <-ch:
		t.Fatal("unsubscribed channel should not receive a signal")
	default:
	}
}

func TestMemBroker_UnsubscribeIsIdempotent(t *testing.T) {
	b := NewMemBroker()
	eventID := uuid.New()

	_, unsubscribe := b.Subscribe(eventID)

	unsubscribe()
	unsubscribe() // must not panic
}

func TestMemBroker_UnsubscribeIsIdempotentConcurrently(t *testing.T) {
	b := NewMemBroker()
	eventID := uuid.New()

	_, unsubscribe := b.Subscribe(eventID)

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			unsubscribe()
		}()
	}
	wg.Wait()
}

func TestMemBroker_UnsubscribeOneLeavesOthersOfSameEventIntact(t *testing.T) {
	b := NewMemBroker()
	eventID := uuid.New()

	ch1, unsub1 := b.Subscribe(eventID)
	ch2, unsub2 := b.Subscribe(eventID)
	defer unsub2()

	unsub1()

	if err := b.Publish(context.Background(), eventID); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	select {
	case <-ch1:
		t.Fatal("unsubscribed subscriber must not receive a signal")
	default:
	}
	select {
	case <-ch2:
	default:
		t.Fatal("remaining subscriber should still receive a signal")
	}
}

// --- MemBroker: drop-if-full / non-blocking coalescing -------------------

// TestMemBroker_PublishNeverBlocksOnFullChannel is the load-bearing
// concurrency property of the whole P4.2 phase: a slow/absent consumer
// must never make Publish block, and a burst of publishes while unread
// must coalesce into exactly one pending signal (buffered-1, drop-if-full).
func TestMemBroker_PublishNeverBlocksOnFullChannel(t *testing.T) {
	b := NewMemBroker()
	eventID := uuid.New()

	ch, unsubscribe := b.Subscribe(eventID)
	defer unsubscribe()

	const publishes = 5

	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < publishes; i++ {
			if err := b.Publish(context.Background(), eventID); err != nil {
				t.Errorf("Publish %d: %v", i, err)
			}
		}
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Publish blocked on an unread, full subscriber channel")
	}

	// Exactly one pending signal despite N publishes.
	select {
	case <-ch:
	default:
		t.Fatal("expected exactly one pending signal after N publishes while unread")
	}
	select {
	case <-ch:
		t.Fatal("expected the channel to be empty after draining the single coalesced signal")
	default:
	}
}

// --- MemBroker: concurrency / race safety --------------------------------

func TestMemBroker_ConcurrentSubscribePublishUnsubscribe(t *testing.T) {
	b := NewMemBroker()
	eventIDs := []uuid.UUID{uuid.New(), uuid.New(), uuid.New()}

	const iterations = 200
	var wg sync.WaitGroup

	// Subscribers: repeatedly subscribe, optionally drain, then unsubscribe
	// (twice, to also exercise idempotency under concurrent Publish).
	for w := 0; w < 5; w++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				eventID := eventIDs[(worker+i)%len(eventIDs)]
				ch, unsubscribe := b.Subscribe(eventID)
				select {
				case <-ch:
				default:
				}
				unsubscribe()
				unsubscribe()
			}
		}(w)
	}

	// Publishers: hammer Publish concurrently across the same event set.
	for w := 0; w < 5; w++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				eventID := eventIDs[(worker+i)%len(eventIDs)]
				if err := b.Publish(context.Background(), eventID); err != nil {
					t.Errorf("Publish: %v", err)
				}
			}
		}(w)
	}

	wg.Wait()
}

// --- MemBroker: BroadcastAll (Finding B1 — reconnect-gap resync) ---------

// TestMemBroker_BroadcastAllReachesSubscribersAcrossDifferentEvents proves
// BroadcastAll fans a signal out to EVERY current subscriber regardless of
// which event they're subscribed to — unlike Publish, which is scoped to
// one eventID. This backs PGBroker's post-reconnect resync (Finding B1): a
// LISTEN connection drop can lose NOTIFYs for ANY event, so recovery must
// nudge ALL local subscribers to re-fetch, not just one.
func TestMemBroker_BroadcastAllReachesSubscribersAcrossDifferentEvents(t *testing.T) {
	b := NewMemBroker()
	eventA := uuid.New()
	eventB := uuid.New()

	chA, unsubA := b.Subscribe(eventA)
	defer unsubA()
	chB, unsubB := b.Subscribe(eventB)
	defer unsubB()

	b.BroadcastAll()

	select {
	case <-chA:
	default:
		t.Fatal("expected eventA subscriber to receive a broadcast signal")
	}
	select {
	case <-chB:
	default:
		t.Fatal("expected eventB subscriber to receive a broadcast signal")
	}
}

// TestMemBroker_BroadcastAllSignalsAllSubscribersOfSameEvent proves multiple
// subscribers of the SAME event all get a signal too (not just one per
// event).
func TestMemBroker_BroadcastAllSignalsAllSubscribersOfSameEvent(t *testing.T) {
	b := NewMemBroker()
	eventID := uuid.New()

	ch1, unsub1 := b.Subscribe(eventID)
	defer unsub1()
	ch2, unsub2 := b.Subscribe(eventID)
	defer unsub2()

	b.BroadcastAll()

	for i, ch := range []<-chan struct{}{ch1, ch2} {
		select {
		case <-ch:
		default:
			t.Fatalf("subscriber %d did not receive a broadcast signal", i)
		}
	}
}

// TestMemBroker_BroadcastAllWithNoSubscribersIsNoop proves calling
// BroadcastAll on an empty broker (nothing subscribed yet, e.g. right after
// process boot) neither panics nor blocks.
func TestMemBroker_BroadcastAllWithNoSubscribersIsNoop(t *testing.T) {
	b := NewMemBroker()
	b.BroadcastAll()
}

// TestMemBroker_BroadcastAllCoalescesWithPendingSignal proves the same
// drop-if-full, never-blocks contract Publish has: a subscriber that
// already has an unread pending signal (from an earlier Publish) just
// coalesces on BroadcastAll rather than blocking or double-buffering.
func TestMemBroker_BroadcastAllCoalescesWithPendingSignal(t *testing.T) {
	b := NewMemBroker()
	eventID := uuid.New()

	ch, unsubscribe := b.Subscribe(eventID)
	defer unsubscribe()

	if err := b.Publish(context.Background(), eventID); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		b.BroadcastAll()
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("BroadcastAll blocked on an unread, full subscriber channel")
	}

	select {
	case <-ch:
	default:
		t.Fatal("expected exactly one pending signal after Publish+BroadcastAll while unread")
	}
	select {
	case <-ch:
		t.Fatal("expected the channel to be empty after draining the single coalesced signal")
	default:
	}
}

// TestMemBroker_BroadcastAllDoesNotDeliverToUnsubscribed proves an
// unsubscribed channel is not touched by BroadcastAll (same bookkeeping
// Publish already respects).
func TestMemBroker_BroadcastAllDoesNotDeliverToUnsubscribed(t *testing.T) {
	b := NewMemBroker()
	eventID := uuid.New()

	ch, unsubscribe := b.Subscribe(eventID)
	unsubscribe()

	b.BroadcastAll()

	select {
	case <-ch:
		t.Fatal("unsubscribed channel should not receive a broadcast signal")
	default:
	}
}

// --- Broker interface compliance -----------------------------------------

func TestMemBroker_SatisfiesBrokerInterface(t *testing.T) {
	var _ Broker = NewMemBroker()
}

// --- pgBroker payload handling (unit-testable without live Postgres) -----

func TestHandleNotification_ValidUUIDForwardsToFanout(t *testing.T) {
	mem := NewMemBroker()
	eventID := uuid.New()

	ch, unsubscribe := mem.Subscribe(eventID)
	defer unsubscribe()

	handleNotification(mem, eventID.String())

	select {
	case <-ch:
	default:
		t.Fatal("expected a valid uuid payload to forward into the fanout")
	}
}

func TestHandleNotification_MalformedPayloadIsLoggedAndSkipped(t *testing.T) {
	mem := NewMemBroker()
	eventID := uuid.New()

	ch, unsubscribe := mem.Subscribe(eventID)
	defer unsubscribe()

	// Garbage payload must not panic, must not forward anything to ANY
	// subscriber (there's no valid event to attribute it to).
	handleNotification(mem, "not-a-uuid")

	select {
	case <-ch:
		t.Fatal("malformed payload must not forward any signal")
	default:
	}
}

func TestHandleNotification_EmptyPayloadIsLoggedAndSkipped(t *testing.T) {
	mem := NewMemBroker()
	eventID := uuid.New()

	ch, unsubscribe := mem.Subscribe(eventID)
	defer unsubscribe()

	handleNotification(mem, "")

	select {
	case <-ch:
		t.Fatal("empty payload must not forward any signal")
	default:
	}
}

// --- pgBroker reconnect→broadcast wiring (Finding B1, unit-testable part) -
//
// listenLoop's reconnect() call itself requires a live Postgres connection
// (pgx.Connect) and is documented-uncoverable (see listenLoop's doc
// comment). What IS unit-testable without a live DB is the wiring right
// after a successful reconnect: handleReconnectSuccess is the exact call
// listenLoop makes there, factored out for the same reason handleNotification
// is — so this one line of "what happens on reconnect success" has a direct
// unit test independent of the un-testable network code around it.

// --- prepareListenConnConfig (PR #81 round-3 convergence, Backend Finding
// 1): pool-only URL options must not reach the raw LISTEN connection -------
//
// Regression coverage for a real deployment-breaking bug: NewPGBroker's
// LISTEN connection used to be established via pgx.Connect(ctx, dbURL) — a
// SECOND, raw parse of dbURL through pgx.ParseConfig, which (unlike
// pgxpool.ParseConfig) has no notion of pgxpool-only options such as
// pool_max_conns/pool_min_conns and leaves them sitting in
// ConnConfig.RuntimeParams. pgx then sends RuntimeParams to Postgres as
// connection startup parameters, and every real Postgres server rejects an
// unrecognized one outright — so a DATABASE_URL tuned with a pool size
// (entirely valid, pgxpool-documented syntax) let the notify POOL connect
// fine while the LISTEN connection was refused, failing process startup.
// This is unit-testable without a live DB because pgxpool.ParseConfig is a
// pure string-parsing operation — no network I/O.
func TestPrepareListenConnConfig_StripsPoolOnlyURLParams(t *testing.T) {
	dbURL := "postgres://user:pass@localhost:5432/db?pool_max_conns=5&pool_min_conns=1&sslmode=disable"

	poolCfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		t.Fatalf("pgxpool.ParseConfig: %v", err)
	}

	connConfig := prepareListenConnConfig(poolCfg)

	if _, ok := connConfig.RuntimeParams["pool_max_conns"]; ok {
		t.Error("connConfig.RuntimeParams carries pool_max_conns — Postgres would reject this as an unrecognized startup parameter")
	}
	if _, ok := connConfig.RuntimeParams["pool_min_conns"]; ok {
		t.Error("connConfig.RuntimeParams carries pool_min_conns — Postgres would reject this as an unrecognized startup parameter")
	}

	// sslmode is a genuine libpq/wire-protocol-recognized option (not a
	// pgxpool-only one) — prepareListenConnConfig must not have stripped
	// it too. pgx parses sslmode into ConnConfig.TLSConfig, not
	// RuntimeParams, so its absence from RuntimeParams doesn't mean it was
	// dropped; this just guards against a naive "clear RuntimeParams
	// entirely" implementation silently discarding real params should this
	// function's implementation ever change.
	if connConfig.Host != "localhost" || connConfig.Port != 5432 || connConfig.Database != "db" {
		t.Errorf("connConfig host/port/database = %s:%d/%s, want localhost:5432/db (real connection fields must survive)", connConfig.Host, connConfig.Port, connConfig.Database)
	}
}

// TestPrepareListenConnConfig_MatchesRawParseIsBrokenDemonstratesTheBug
// proves the bug this fix closes actually exists in the raw parser
// NewPGBroker used to call directly (pgx.Connect -> pgx.ParseConfig): the
// SAME dbURL, parsed the OLD way, retains the pool-only params in
// RuntimeParams. This is the "before" half of the regression; the "after"
// half is TestPrepareListenConnConfig_StripsPoolOnlyURLParams above.
func TestPrepareListenConnConfig_MatchesRawParseIsBrokenDemonstratesTheBug(t *testing.T) {
	dbURL := "postgres://user:pass@localhost:5432/db?pool_max_conns=5&pool_min_conns=1&sslmode=disable"

	rawCfg, err := pgx.ParseConfig(dbURL)
	if err != nil {
		t.Fatalf("pgx.ParseConfig: %v", err)
	}

	if _, ok := rawCfg.RuntimeParams["pool_max_conns"]; !ok {
		t.Fatal("expected the raw pgx.ParseConfig path to retain pool_max_conns in RuntimeParams (this is the bug being fixed) — if this fails, pgx's behavior changed and this test's premise needs revisiting")
	}
}

func TestHandleReconnectSuccess_BroadcastsToAllCurrentSubscribers(t *testing.T) {
	mem := NewMemBroker()
	eventA := uuid.New()
	eventB := uuid.New()

	chA, unsubA := mem.Subscribe(eventA)
	defer unsubA()
	chB, unsubB := mem.Subscribe(eventB)
	defer unsubB()

	handleReconnectSuccess(mem)

	select {
	case <-chA:
	default:
		t.Fatal("expected eventA subscriber to receive a signal after a successful reconnect")
	}
	select {
	case <-chB:
	default:
		t.Fatal("expected eventB subscriber to receive a signal after a successful reconnect")
	}
}
