// Package retention removes archived tenants whose retention window has
// expired (the retention half of P1.4 soft-delete). It is the backend's only
// background job: one ticker loop started from main.go.
package retention

import (
	"context"
	"log"
	"time"

	"idento/backend/internal/store"
)

// Store is the slice of the data layer the purge loop needs.
type Store interface {
	PurgeExpiredTenants(ctx context.Context, retentionDays int) ([]store.PurgedTenant, error)
}

// Start launches the purge loop in a goroutine and reports whether it did.
// No-op when retentionDays <= 0. The first pass runs after initialDelay
// (lets the server settle at boot), then every interval.
func Start(s Store, retentionDays int, initialDelay, interval time.Duration) bool {
	if retentionDays <= 0 {
		log.Println("Tenant retention purge disabled (TENANT_RETENTION_DAYS=0)")
		return false
	}
	log.Printf("Tenant retention purge enabled: archived tenants are deleted after %d days", retentionDays)
	go func() {
		time.Sleep(initialDelay)
		RunOnce(context.Background(), s, retentionDays)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			RunOnce(context.Background(), s, retentionDays)
		}
	}()
	return true
}

// RunOnce executes a single purge pass. Idle passes are silent; passes that
// purge tenants or hit errors log one summary line.
func RunOnce(ctx context.Context, s Store, retentionDays int) {
	purged, err := s.PurgeExpiredTenants(ctx, retentionDays)
	if err != nil {
		log.Printf("Tenant retention purge: %d purged, errors: %v", len(purged), err)
		return
	}
	if len(purged) > 0 {
		log.Printf("Tenant retention purge: deleted %d archived tenant(s) past %d-day retention", len(purged), retentionDays)
	}
}
