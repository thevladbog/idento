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

// rateWindow is the exact window the caller passes to
// store.CountRecentCheckins for totals.rate_per_min — the last 5 minutes,
// per spec §3.1. PR #81 bot-review round, Finding A3: rate_per_min used to
// be derived from computeRates summing MinuteBucket rows (see below for why
// that was wrong); it's now an exact `created_at >= now-5m` COUNT the
// handler divides by 5.0, with no minute truncation or day clamp.
const rateWindow = 5 * time.Minute

// minRateForETA is the floor below which est_done_at is considered
// meaningless (spec §3.1: "null when rate_per_min is ~0") — a near-zero
// rate would project an estimated-done time that's not a useful signal.
const minRateForETA = 0.1

// computeRates derives the monitor snapshot's rate/peak/ETA trio (P4.2 Task
// 3, spec §3.1; reshaped by PR #81 bot-review round, Finding A3):
//
//   - ratePerMin: recentCount / 5.0, rounded to one decimal — recentCount is
//     the caller-supplied EXACT count of 'checkin' actions in the last 5
//     minutes (store.CountRecentCheckins(ctx, eventID, now-5m)), not derived
//     from buckets. The previous bucket-based approach had two compounding
//     inaccuracies: (1) it summed MinuteBucket rows, whose 'Minute' is a
//     minute-START timestamp — at 12:00:30 the window [11:55:30, 12:00:30)
//     would exclude the ENTIRE 11:55 bucket even though its last 30s fall
//     inside the window, a systematic undercount of up to ~20%; (2) buckets
//     were clamped to UTC start-of-day, so for ~5 minutes after midnight the
//     window reached into "yesterday" but got nothing. An exact COUNT with
//     no truncation and no day clamp has neither problem.
//   - peak: the bucket with the highest count among ALL buckets passed in —
//     buckets is expected to already be scoped by the caller to "today"
//     (UTC), UNCHANGED from before (GetMonitorMinuteBuckets backs peak
//     alone now) — paired with that bucket's start time; nil when buckets is
//     empty. Ties keep the first (earliest) bucket, since the store returns
//     buckets in ascending time order.
//   - estDoneAt: now + (total-checkedIn)/ratePerMin minutes; nil when
//     ratePerMin is below minRateForETA or checkedIn >= total (the event is
//     stalled or already fully checked in — no meaningful projection).
func computeRates(recentCount int, buckets []store.MinuteBucket, now time.Time, total, checkedIn int) (ratePerMin float64, peak *PeakRate, estDoneAt *time.Time) {
	ratePerMin = roundToOneDecimal(float64(recentCount) / 5.0)

	var peakBucket *store.MinuteBucket
	for i := range buckets {
		b := &buckets[i]
		if peakBucket == nil || b.Count > peakBucket.Count {
			peakBucket = b
		}
	}
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
