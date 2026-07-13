package retention

import (
	"context"
	"errors"
	"testing"
	"time"

	"idento/backend/internal/store"
)

type fakePurger struct {
	calls chan int
	err   error
}

func (f *fakePurger) PurgeExpiredTenants(_ context.Context, retentionDays int) ([]store.PurgedTenant, error) {
	f.calls <- retentionDays
	return nil, f.err
}

func TestStartDisabledWhenRetentionZero(t *testing.T) {
	f := &fakePurger{calls: make(chan int, 1)}
	if Start(f, 0, time.Millisecond, time.Millisecond) {
		t.Fatal("Start(days=0) = true, want false (disabled)")
	}
	select {
	case <-f.calls:
		t.Fatal("purge ran despite retention 0")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestStartRunsFirstPassAfterInitialDelay(t *testing.T) {
	f := &fakePurger{calls: make(chan int, 1)}
	if !Start(f, 90, time.Millisecond, time.Hour) {
		t.Fatal("Start(days=90) = false, want true")
	}
	select {
	case days := <-f.calls:
		if days != 90 {
			t.Errorf("purge called with %d days, want 90", days)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("first purge pass never ran")
	}
}

func TestRunOnceSurvivesStoreError(t *testing.T) {
	f := &fakePurger{calls: make(chan int, 1), err: errors.New("db down")}
	RunOnce(context.Background(), f, 90) // must log, not panic
	if got := <-f.calls; got != 90 {
		t.Errorf("purge called with %d days, want 90", got)
	}
}
