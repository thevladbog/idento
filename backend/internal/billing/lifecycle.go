// Package billing runs the subscription lifecycle ticker: the backend's
// second background job (after internal/retention), started only in SaaS
// mode. It periodically flips trial subscriptions past their trial_end_date
// and active subscriptions past their end_date to status='expired' (on-prem
// installs are not metered and never run this).
package billing

import (
	"context"
	"log"
	"time"
)

// LifecycleStore is the slice of the data layer the lifecycle loop needs.
type LifecycleStore interface {
	ExpireOverdueSubscriptions(ctx context.Context) (int, error)
}

// StartLifecycle launches the lifecycle loop in a goroutine and reports
// whether it did. No-op when interval <= 0 (SUBSCRIPTION_LIFECYCLE_INTERVAL
// disabled it). The first pass runs after initialDelay (lets the server
// settle at boot), then every interval.
func StartLifecycle(s LifecycleStore, interval, initialDelay time.Duration) bool {
	if interval <= 0 {
		log.Println("Subscription lifecycle ticker disabled (SUBSCRIPTION_LIFECYCLE_INTERVAL=0)")
		return false
	}
	log.Printf("Subscription lifecycle ticker enabled: checking for overdue subscriptions every %s", interval)
	go func() {
		runPass := func() {
			ctx, cancel := context.WithTimeout(context.Background(), time.Hour)
			defer cancel()
			RunLifecycleOnce(ctx, s)
		}
		time.Sleep(initialDelay)
		runPass()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			runPass()
		}
	}()
	return true
}

// RunLifecycleOnce executes a single lifecycle pass. Idle passes are
// silent; passes that expire subscriptions or hit errors log one summary
// line.
func RunLifecycleOnce(ctx context.Context, s LifecycleStore) {
	n, err := s.ExpireOverdueSubscriptions(ctx)
	if err != nil {
		log.Printf("Subscription lifecycle: %d expired, errors: %v", n, err)
		return
	}
	if n > 0 {
		log.Printf("Subscription lifecycle: expired %d overdue subscription(s)", n)
	}
}
