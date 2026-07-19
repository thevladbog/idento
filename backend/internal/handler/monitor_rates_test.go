package handler

import (
	"testing"
	"time"

	"idento/backend/internal/store"
)

// fixedNow is a stable reference instant used across computeRates tests so
// bucket offsets ("2 minutes ago") are unambiguous and tests never depend on
// wall-clock time.
var fixedNow = time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)

// --- rate_per_min: PR #81 bot-review round, Finding A3 ---
//
// computeRates no longer derives rate_per_min by summing MinuteBucket rows
// within a 5-minute window — that had two compounding inaccuracies: (1) a
// bucket's 'Minute' is a minute-START timestamp, so a bucket whose last
// seconds fell inside the window but whose start didn't got excluded
// wholesale (undercount up to ~20%); (2) buckets were clamped to UTC
// start-of-day, losing the window's reach into "yesterday" for ~5 minutes
// after midnight. The exact boundary/truncation semantics now live entirely
// in store.CountRecentCheckins' SQL (`created_at >= $2`, no minute
// truncation, no day clamp) — proved by
// store/pg_store_monitor_test.go's TestCountRecentCheckins* pgxmock tests
// (which pin the exact `>= $2` predicate) and the real-Postgres integration
// test. computeRates' remaining job for rate_per_min is pure arithmetic:
// recentCount / 5.0, rounded to one decimal — exercised below.

func TestComputeRates_EmptyBucketsAndNoRecentCheckins(t *testing.T) {
	rate, peak, estDoneAt := computeRates(0, nil, fixedNow, 100, 0)

	if rate != 0 {
		t.Errorf("rate = %v, want 0", rate)
	}
	if peak != nil {
		t.Errorf("peak = %+v, want nil", peak)
	}
	if estDoneAt != nil {
		t.Errorf("estDoneAt = %v, want nil", *estDoneAt)
	}
}

func TestComputeRates_RecentCountDividedByFive(t *testing.T) {
	// 5 recent check-ins / 5 minutes = 1.0/min — a pure pass-through of the
	// caller-supplied exact count, no bucket involvement.
	rate, _, estDoneAt := computeRates(5, nil, fixedNow, 1000, 10)

	if rate != 1.0 {
		t.Errorf("rate = %v, want 1.0", rate)
	}
	if estDoneAt == nil {
		t.Fatalf("estDoneAt = nil, want non-nil (rate above floor, remaining > 0)")
	}
}

func TestComputeRates_PeakPicksMaxBucketAcrossWholeDayIndependentOfRecentCount(t *testing.T) {
	// peak considers every bucket the caller passed in (the store already
	// scopes the query to "today"), completely independent of recentCount —
	// an early-morning spike (09:40) still wins peak even though it
	// contributes nothing to recentCount (which the caller derived from a
	// SEPARATE exact 5-minute-window query).
	morningSpike := time.Date(2026, 7, 18, 9, 40, 0, 0, time.UTC)
	recentSmall := fixedNow.Add(-2 * time.Minute)
	buckets := []store.MinuteBucket{
		{Minute: morningSpike, Count: 14},
		{Minute: recentSmall, Count: 3},
	}

	rate, peak, _ := computeRates(3, buckets, fixedNow, 1000, 100)

	if rate != 0.6 { // 3/5 = 0.6
		t.Errorf("rate = %v, want 0.6", rate)
	}
	if peak == nil {
		t.Fatalf("peak = nil, want the morning spike")
	}
	if peak.Rate != 14 || !peak.At.Equal(morningSpike) {
		t.Errorf("peak = %+v, want {Rate:14 At:%v}", peak, morningSpike)
	}
}

func TestComputeRates_RateBelowFloor_NilETA(t *testing.T) {
	// recentCount 0 -> rate 0, which is below the 0.1 minimum needed to
	// project a meaningful est_done_at, even though remaining
	// (total-checkedIn) is positive.
	rate, _, estDoneAt := computeRates(0, nil, fixedNow, 500, 100)

	if rate != 0 {
		t.Errorf("rate = %v, want 0", rate)
	}
	if estDoneAt != nil {
		t.Errorf("estDoneAt = %v, want nil (rate below 0.1 floor)", *estDoneAt)
	}
}

func TestComputeRates_EventDone_NilETA(t *testing.T) {
	// checkedIn >= total: everyone is already in, even though the rate is
	// healthy — no meaningful "done at" projection remains.
	rate, _, estDoneAt := computeRates(10, nil, fixedNow, 200, 200)

	if rate != 2.0 { // 10/5
		t.Errorf("rate = %v, want 2.0", rate)
	}
	if estDoneAt != nil {
		t.Errorf("estDoneAt = %v, want nil (checkedIn >= total)", *estDoneAt)
	}
}

func TestComputeRates_EventOverCheckedIn_NilETA(t *testing.T) {
	// checkedIn > total is a defensive edge (shouldn't happen, but a
	// negative "remaining" must never produce a bogus estDoneAt).
	_, _, estDoneAt := computeRates(10, nil, fixedNow, 100, 105)

	if estDoneAt != nil {
		t.Errorf("estDoneAt = %v, want nil (checkedIn > total)", *estDoneAt)
	}
}

func TestComputeRates_EstDoneAtProjection(t *testing.T) {
	// rate = 10 recent check-ins over 5 minutes = 2.0/min; remaining = 100;
	// ETA = now + 50 minutes.
	rate, _, estDoneAt := computeRates(10, nil, fixedNow, 300, 200)

	if rate != 2.0 {
		t.Fatalf("rate = %v, want 2.0", rate)
	}
	if estDoneAt == nil {
		t.Fatalf("estDoneAt = nil, want a projection")
	}
	want := fixedNow.Add(50 * time.Minute)
	if !estDoneAt.Equal(want) {
		t.Errorf("estDoneAt = %v, want %v", *estDoneAt, want)
	}
}

func TestComputeRates_RateRoundedToOneDecimal(t *testing.T) {
	// 7 recent check-ins / 5 minutes = 1.4/min exactly — proves the
	// one-decimal contract holds for a non-trivial (non-multiple-of-5)
	// count.
	rate, _, _ := computeRates(7, nil, fixedNow, 1000, 0)

	if rate != 1.4 {
		t.Errorf("rate = %v, want 1.4", rate)
	}
}

func TestComputeRates_PeakTieBreakerPin(t *testing.T) {
	// When two buckets have equal counts, peak returns the earlier bucket's
	// timestamp (first-wins convention, since buckets are iterated in ascending
	// time order and peak only updates on strictly greater count, not equal).
	earlierBucket := fixedNow.Add(-3 * time.Minute)
	laterBucket := fixedNow.Add(-2 * time.Minute)

	buckets := []store.MinuteBucket{
		{Minute: earlierBucket, Count: 10},
		{Minute: laterBucket, Count: 10},
	}

	_, peak, _ := computeRates(0, buckets, fixedNow, 1000, 0)

	if peak == nil {
		t.Fatalf("peak = nil, want non-nil")
	}
	if peak.Rate != 10 {
		t.Errorf("peak.Rate = %v, want 10", peak.Rate)
	}
	if !peak.At.Equal(earlierBucket) {
		t.Errorf("peak.At = %v, want %v (earlier bucket wins on tie)", peak.At, earlierBucket)
	}
}
