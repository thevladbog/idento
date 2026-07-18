package broker

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
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
