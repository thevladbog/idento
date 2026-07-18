package main

import (
	"sync"
	"time"
)

// scanBuffer holds the most recently scanned barcode/QR code behind a
// mutex. It is shared between the scanner's listen goroutine (Set) and the
// /scan/* HTTP handlers (Last, Clear, Consume).
type scanBuffer struct {
	mu   sync.Mutex
	code string
	at   time.Time
}

func newScanBuffer() *scanBuffer {
	return &scanBuffer{}
}

// Set records a freshly scanned code, overwriting whatever was buffered
// before it and stamping it with the current time.
func (b *scanBuffer) Set(code string) {
	b.mu.Lock()
	b.code = code
	b.at = time.Now()
	b.mu.Unlock()
}

// Last returns the currently buffered code without clearing it.
func (b *scanBuffer) Last() (code string, at time.Time) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.code, b.at
}

// Clear unconditionally empties the buffer.
func (b *scanBuffer) Clear() {
	b.mu.Lock()
	b.code = ""
	b.at = time.Time{}
	b.mu.Unlock()
}

// Consume atomically returns the buffered code and empties the buffer in
// the same critical section. Unlike a separate Last()-then-Clear() pair,
// there is no window between the read and the clear for another Set() to
// slip through unnoticed: a scan that arrives concurrently either happens
// before this call's lock (and is what gets returned) or after it (and
// survives for the next Consume()).
func (b *scanBuffer) Consume() (code string, at time.Time) {
	b.mu.Lock()
	defer b.mu.Unlock()
	code, at = b.code, b.at
	b.code = ""
	b.at = time.Time{}
	return code, at
}
