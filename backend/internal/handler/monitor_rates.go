package handler

import (
	"math"
	"time"

	"idento/backend/internal/store"
)

// PeakRate is the wire shape of a monitor snapshot's totals.peak — the
// highest-count one-minute check-in bucket "today" (UTC), paired with that
// bucket's start time (P4.2 Task 3, spec §3.1). Produced by computeRates;
// nil when the caller passed no buckets (no check-ins today).
type PeakRate struct {
	Rate float64   `json:"rate"`
	At   time.Time `json:"at"`
}

// rateWindow is the sliding window computeRates sums bucket counts over for
// totals.rate_per_min — the last 5 minutes, per spec §3.1.
const rateWindow = 5 * time.Minute

// minRateForETA is the floor below which est_done_at is considered
// meaningless (spec §3.1: "null when rate_per_min is ~0") — a near-zero
// rate would project an estimated-done time that's not a useful signal.
const minRateForETA = 0.1

// computeRates derives the monitor snapshot's rate/peak/ETA trio from ONE
// shared set of minute buckets (P4.2 Task 3, spec §3.1) — buckets is
// expected to already be scoped by the caller to "today" (UTC), the same
// set peak is computed over:
//
//   - ratePerMin: sum of bucket counts within the half-open window
//     [now-5m, now) divided by 5, rounded to one decimal — "checkins in the
//     last 5 minutes, per minute".
//   - peak: the bucket with the highest count among ALL buckets passed in
//     (not limited to the rate window — a spike from earlier today still
//     wins), paired with that bucket's start time; nil when buckets is
//     empty. Ties keep the first (earliest) bucket, since the store returns
//     buckets in ascending time order.
//   - estDoneAt: now + (total-checkedIn)/ratePerMin minutes; nil when
//     ratePerMin is below minRateForETA or checkedIn >= total (the event is
//     stalled or already fully checked in — no meaningful projection).
func computeRates(buckets []store.MinuteBucket, now time.Time, total, checkedIn int) (ratePerMin float64, peak *PeakRate, estDoneAt *time.Time) {
	windowStart := now.Add(-rateWindow)

	var windowSum int
	var peakBucket *store.MinuteBucket
	for i := range buckets {
		b := &buckets[i]
		if !b.Minute.Before(windowStart) && b.Minute.Before(now) {
			windowSum += b.Count
		}
		if peakBucket == nil || b.Count > peakBucket.Count {
			peakBucket = b
		}
	}

	ratePerMin = roundToOneDecimal(float64(windowSum) / 5.0)

	if peakBucket != nil {
		peak = &PeakRate{Rate: float64(peakBucket.Count), At: peakBucket.Minute}
	}

	remaining := total - checkedIn
	if ratePerMin >= minRateForETA && remaining > 0 {
		minutesRemaining := float64(remaining) / ratePerMin
		eta := now.Add(time.Duration(minutesRemaining * float64(time.Minute)))
		estDoneAt = &eta
	}

	return ratePerMin, peak, estDoneAt
}

// roundToOneDecimal guards against floating-point noise (e.g.
// 1.4000000000000001 from repeated float division) so rate_per_min always
// carries exactly the one decimal digit the spec's wire example shows.
func roundToOneDecimal(v float64) float64 {
	return math.Round(v*10) / 10
}
