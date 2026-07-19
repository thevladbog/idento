package handler

import (
	"net/http"
	"time"

	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// monitorRecentLimit mirrors GetCheckinActions' rail default (P4.1 Task 3)
// — the monitor's recent feed always shows the newest 20 rows, per spec
// §3.1.
const monitorRecentLimit = 20

// MonitorTotals is the monitor snapshot's totals block (P4.2 Task 3, spec
// §3.1). Peak and EstDoneAt are nil (JSON null) rather than omitted —
// MonitorSnapshot's openapi schema marks both required-but-nullable so a
// client always sees the key.
type MonitorTotals struct {
	CheckedIn  int        `json:"checked_in"`
	Total      int        `json:"total"`
	RatePerMin float64    `json:"rate_per_min"`
	Peak       *PeakRate  `json:"peak"`
	EstDoneAt  *time.Time `json:"est_done_at"`
}

// MonitorZone is one zone's currently-checked-in count in the monitor
// snapshot's zones[] — the wire reshaping of store.MonitorZoneCount.
type MonitorZone struct {
	ZoneID    uuid.UUID `json:"zone_id"`
	Name      string    `json:"name"`
	CheckedIn int       `json:"checked_in"`
}

// MonitorStationRow is one check-in station's liveness + running count in
// the monitor snapshot's stations[] — the wire reshaping of
// store.MonitorStation.
type MonitorStationRow struct {
	ID           uuid.UUID  `json:"id"`
	Name         string     `json:"name"`
	ZoneID       *uuid.UUID `json:"zone_id"`
	LastSeenAt   time.Time  `json:"last_seen_at"`
	CheckinCount int        `json:"checkin_count"`
}

// MonitorSnapshot is the response envelope for GET
// /api/events/{event_id}/monitor (P4.2 Task 3, spec §3.1) — everything
// screen 7e (the live monitor) renders in one request. Invariant:
// sum(Zones[].CheckedIn) + Unattributed == Totals.CheckedIn, which holds by
// construction because Total, CheckedIn, Zones, AND Unattributed all come
// from the SAME store.GetMonitorOverview call (see its doc comment; PR #81
// bot-review round, Finding A1 — previously totals came from a separate
// GetMonitorCounts call that could transiently disagree with a concurrent
// GetMonitorZones call).
type MonitorSnapshot struct {
	Totals       MonitorTotals            `json:"totals"`
	Zones        []MonitorZone            `json:"zones"`
	Unattributed int                      `json:"unattributed"`
	Stations     []MonitorStationRow      `json:"stations"`
	Recent       []store.CheckinActionRow `json:"recent"`
}

// GetEventMonitor composes Task 2's four monitor aggregations plus the
// existing check-in feed into one snapshot (P4.2 Task 3, spec §3.1) —
// everything the live monitor screen and the Home LiveStrip need in a
// single request.
func (h *Handler) GetEventMonitor(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	ctx := c.Request().Context()

	total, checkedIn, zoneCounts, unattributed, err := h.Store.GetMonitorOverview(ctx, eventID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch monitor overview"})
	}

	// dayStart is UTC start-of-day: the domain for "today's" peak bucket
	// (spec §3.1) — GetMonitorMinuteBuckets backs peak ONLY now (PR #81
	// bot-review round, Finding A3 moved rate_per_min off buckets onto the
	// exact CountRecentCheckins query below).
	now := time.Now().UTC()
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	buckets, err := h.Store.GetMonitorMinuteBuckets(ctx, eventID, dayStart)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch monitor rate buckets"})
	}

	recentCount, err := h.Store.CountRecentCheckins(ctx, eventID, now.Add(-rateWindow))
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch monitor recent check-in count"})
	}

	stations, err := h.Store.GetMonitorStations(ctx, eventID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch monitor stations"})
	}

	recent, err := h.Store.GetCheckinActions(ctx, eventID, monitorRecentLimit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch recent check-in actions"})
	}
	if recent == nil {
		recent = []store.CheckinActionRow{}
	}

	ratePerMin, peak, estDoneAt := computeRates(recentCount, buckets, now, total, checkedIn)

	zones := make([]MonitorZone, 0, len(zoneCounts))
	for _, z := range zoneCounts {
		zones = append(zones, MonitorZone{ZoneID: z.ZoneID, Name: z.Name, CheckedIn: z.CheckedIn})
	}

	stationRows := make([]MonitorStationRow, 0, len(stations))
	for _, s := range stations {
		stationRows = append(stationRows, MonitorStationRow{
			ID:           s.ID,
			Name:         s.Name,
			ZoneID:       s.ZoneID,
			LastSeenAt:   s.LastSeenAt,
			CheckinCount: s.CheckinCount,
		})
	}

	return c.JSON(http.StatusOK, MonitorSnapshot{
		Totals: MonitorTotals{
			CheckedIn:  checkedIn,
			Total:      total,
			RatePerMin: ratePerMin,
			Peak:       peak,
			EstDoneAt:  estDoneAt,
		},
		Zones:        zones,
		Unattributed: unattributed,
		Stations:     stationRows,
		Recent:       recent,
	})
}
