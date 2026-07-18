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

func TestComputeRates_EmptyBuckets(t *testing.T) {
	rate, peak, estDoneAt := computeRates(nil, fixedNow, 100, 0)

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

func TestComputeRates_RecentBucketCountsTowardRate(t *testing.T) {
	bucketStart := fixedNow.Add(-1 * time.Minute)
	buckets := []store.MinuteBucket{{Minute: bucketStart, Count: 5}}

	rate, peak, estDoneAt := computeRates(buckets, fixedNow, 1000, 10)

	// 5 check-ins somewhere in the last 5 minutes / 5 = 1.0/min.
	if rate != 1.0 {
		t.Errorf("rate = %v, want 1.0", rate)
	}
	if peak == nil {
		t.Fatalf("peak = nil, want a peak for the only bucket")
	}
	if peak.Rate != 5 || !peak.At.Equal(bucketStart) {
		t.Errorf("peak = %+v, want {Rate:5 At:%v}", peak, bucketStart)
	}
	if estDoneAt == nil {
		t.Fatalf("estDoneAt = nil, want non-nil (rate above floor, remaining > 0)")
	}
}

func TestComputeRates_PeakPicksMaxBucketAcrossWholeDayNotJustWindow(t *testing.T) {
	// An early-morning spike (09:40) far outside the last-5-minutes rate
	// window should still win peak — peak considers every bucket the
	// caller passed in (the store already scopes the query to "today"),
	// not just the rate's sliding window.
	morningSpike := time.Date(2026, 7, 18, 9, 40, 0, 0, time.UTC)
	recentSmall := fixedNow.Add(-2 * time.Minute)
	buckets := []store.MinuteBucket{
		{Minute: morningSpike, Count: 14},
		{Minute: recentSmall, Count: 3},
	}

	rate, peak, _ := computeRates(buckets, fixedNow, 1000, 100)

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

func TestComputeRates_WindowExcludesBucketsOlderThanFiveMinutes(t *testing.T) {
	// A bucket 6 minutes old (older than the 5-minute rate window) must not
	// contribute to rate_per_min, even though it's the only bucket for the
	// day (and therefore still becomes peak).
	oldBucket := fixedNow.Add(-6 * time.Minute)
	buckets := []store.MinuteBucket{{Minute: oldBucket, Count: 100}}

	rate, peak, estDoneAt := computeRates(buckets, fixedNow, 1000, 0)

	if rate != 0 {
		t.Errorf("rate = %v, want 0 (bucket is outside the 5-minute window)", rate)
	}
	if peak == nil || peak.Rate != 100 {
		t.Errorf("peak = %+v, want the old bucket still counted for peak", peak)
	}
	// rate is 0 (below the ETA floor), so estDoneAt must be nil even though
	// remaining > 0.
	if estDoneAt != nil {
		t.Errorf("estDoneAt = %v, want nil (rate below floor)", *estDoneAt)
	}
}

func TestComputeRates_RateBelowFloor_NilETA(t *testing.T) {
	// No buckets in the rate window → rate 0, which is below the 0.1
	// minimum needed to project a meaningful est_done_at, even though
	// remaining (total-checkedIn) is positive.
	buckets := []store.MinuteBucket{{Minute: fixedNow.Add(-30 * time.Minute), Count: 2}}

	rate, _, estDoneAt := computeRates(buckets, fixedNow, 500, 100)

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
	buckets := []store.MinuteBucket{{Minute: fixedNow.Add(-1 * time.Minute), Count: 10}}

	rate, _, estDoneAt := computeRates(buckets, fixedNow, 200, 200)

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
	buckets := []store.MinuteBucket{{Minute: fixedNow.Add(-1 * time.Minute), Count: 10}}

	_, _, estDoneAt := computeRates(buckets, fixedNow, 100, 105)

	if estDoneAt != nil {
		t.Errorf("estDoneAt = %v, want nil (checkedIn > total)", *estDoneAt)
	}
}

func TestComputeRates_EstDoneAtProjection(t *testing.T) {
	// rate = 10 checkins over 5 minutes = 2.0/min; remaining = 100; ETA =
	// now + 50 minutes.
	buckets := []store.MinuteBucket{{Minute: fixedNow.Add(-1 * time.Minute), Count: 10}}

	rate, _, estDoneAt := computeRates(buckets, fixedNow, 300, 200)

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
	// 7 check-ins / 5 minutes = 1.4/min exactly — proves the one-decimal
	// contract holds for a non-trivial (non-multiple-of-5) count.
	buckets := []store.MinuteBucket{{Minute: fixedNow.Add(-30 * time.Second), Count: 7}}

	rate, _, _ := computeRates(buckets, fixedNow, 1000, 0)

	if rate != 1.4 {
		t.Errorf("rate = %v, want 1.4", rate)
	}
}
