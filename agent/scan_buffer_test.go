package main

import (
	"fmt"
	"sync"
	"testing"
)

func TestScanBuffer_InitiallyEmpty(t *testing.T) {
	buf := newScanBuffer()
	code, at := buf.Last()
	if code != "" || !at.IsZero() {
		t.Fatalf("expected empty buffer, got code=%q at=%v", code, at)
	}
}

func TestScanBuffer_SetThenLast_DoesNotClear(t *testing.T) {
	buf := newScanBuffer()
	buf.Set("A")

	code, at := buf.Last()
	if code != "A" || at.IsZero() {
		t.Fatalf("expected code=A with non-zero time, got code=%q at=%v", code, at)
	}

	// Last() must be read-only: calling it again returns the same value.
	code2, at2 := buf.Last()
	if code2 != "A" || at2 != at {
		t.Fatalf("Last() must not mutate the buffer, got code=%q at=%v (want code=A at=%v)", code2, at2, at)
	}
}

func TestScanBuffer_Clear(t *testing.T) {
	buf := newScanBuffer()
	buf.Set("A")
	buf.Clear()

	code, at := buf.Last()
	if code != "" || !at.IsZero() {
		t.Fatalf("expected empty buffer after Clear, got code=%q at=%v", code, at)
	}
}

func TestScanBuffer_Consume_ReturnsAndClearsInOneCall(t *testing.T) {
	buf := newScanBuffer()
	buf.Set("A")

	code, at := buf.Consume()
	if code != "A" || at.IsZero() {
		t.Fatalf("expected Consume to return code=A with non-zero time, got code=%q at=%v", code, at)
	}

	// The buffer must now be empty: Consume cleared exactly what it returned.
	code2, at2 := buf.Last()
	if code2 != "" || !at2.IsZero() {
		t.Fatalf("expected buffer cleared after Consume, got code=%q at=%v", code2, at2)
	}
}

func TestScanBuffer_Consume_EmptyBufferReturnsZeroValue(t *testing.T) {
	buf := newScanBuffer()
	code, at := buf.Consume()
	if code != "" || !at.IsZero() {
		t.Fatalf("expected zero value from Consume on empty buffer, got code=%q at=%v", code, at)
	}
}

// TestScanBuffer_Consume_NeverDropsAScanArrivingBeforeConsumption reproduces
// the race CodeRabbit flagged on panel PR #77 (panel/p4.1-checkin-loop): with
// the old GET /scan/last + POST /scan/clear protocol, a second physical scan
// arriving between a poller's read and its later clear call was silently
// erased by that clear. Consume() collapses read+clear into a single
// critical section, so there is no window between them for a second Set()
// to land in — it either lands before this Consume() call (and is what gets
// returned) or after it (and survives untouched for the next call).
func TestScanBuffer_Consume_NeverDropsAScanArrivingBeforeConsumption(t *testing.T) {
	buf := newScanBuffer()
	buf.Set("A")

	// A poller reads the buffer (as GET /scan/last would) ...
	readCode, _ := buf.Last()
	if readCode != "A" {
		t.Fatalf("expected to read A, got %q", readCode)
	}

	// ... and before it gets a chance to clear what it read, a second
	// physical scan arrives.
	buf.Set("B")

	// The atomic consume must hand back the newer scan B — it was never
	// blind to it, unlike an unconditional POST /scan/clear at this point
	// would have been.
	consumedCode, _ := buf.Consume()
	if consumedCode != "B" {
		t.Fatalf("expected Consume to return the newer scan B (not silently dropped), got %q", consumedCode)
	}

	finalCode, finalAt := buf.Last()
	if finalCode != "" || !finalAt.IsZero() {
		t.Fatalf("expected buffer cleared after Consume, got code=%q at=%v", finalCode, finalAt)
	}
}

// TestScanBuffer_ConcurrentSetAndConsume_NoTornReads hammers Set and Consume
// from many goroutines at once. Run with `go test -race` (as CI does): the
// race detector catches any unsynchronized access, and the per-call
// assertion catches torn reads (a non-empty code paired with a zero time,
// which could only happen if a read observed the struct mid-write).
func TestScanBuffer_ConcurrentSetAndConsume_NoTornReads(t *testing.T) {
	buf := newScanBuffer()
	var wg sync.WaitGroup

	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			buf.Set(fmt.Sprintf("CODE-%d", n))
		}(i)
	}

	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			code, at := buf.Consume()
			if code != "" && at.IsZero() {
				t.Errorf("Consume returned non-empty code %q with zero time (torn read)", code)
			}
		}()
	}

	wg.Wait()

	// Whatever is left over must itself be internally consistent.
	code, at := buf.Last()
	if code != "" && at.IsZero() {
		t.Fatalf("final buffer state inconsistent: code=%q at=%v", code, at)
	}
}
