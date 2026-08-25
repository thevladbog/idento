package billing

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeLifecycleStore struct {
	calls chan struct{}
	err   error
}

func (f *fakeLifecycleStore) ExpireOverdueSubscriptions(_ context.Context) (int, error) {
	f.calls <- struct{}{}
	return 0, f.err
}

func TestStartLifecycleDisabledWhenIntervalZero(t *testing.T) {
	f := &fakeLifecycleStore{calls: make(chan struct{}, 1)}
	if StartLifecycle(f, 0, 0) {
		t.Fatal("StartLifecycle(interval=0) = true, want false (disabled)")
	}
	select {
	case <-f.calls:
		t.Fatal("lifecycle pass ran despite interval 0")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestStartLifecycleRunsFirstPassAfterInitialDelay(t *testing.T) {
	f := &fakeLifecycleStore{calls: make(chan struct{}, 1)}
	if !StartLifecycle(f, time.Hour, time.Millisecond) {
		t.Fatal("StartLifecycle(interval=1h) = false, want true")
	}
	select {
	case <-f.calls:
	case <-time.After(2 * time.Second):
		t.Fatal("first lifecycle pass never ran")
	}
}

func TestRunLifecycleOnceSurvivesStoreError(t *testing.T) {
	f := &fakeLifecycleStore{calls: make(chan struct{}, 1), err: errors.New("db down")}
	RunLifecycleOnce(context.Background(), f) // must log, not panic
	select {
	case <-f.calls:
	default:
		t.Fatal("ExpireOverdueSubscriptions was not called")
	}
}
