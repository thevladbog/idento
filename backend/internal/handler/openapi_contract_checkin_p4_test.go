package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
	"time"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// newCheckinSettingsHandler builds a Handler whose event store returns
// event for any GetEventByID(ForTenant) lookup, wired to the given
// check-in-settings fake read/write functions.
func newCheckinSettingsHandler(
	event *models.Event,
	get func(eventID uuid.UUID) (json.RawMessage, error),
	update func(eventID uuid.UUID, settings json.RawMessage) error,
) *Handler {
	return New(&fakeStore{
		getEventByID:          func(uuid.UUID) (*models.Event, error) { return event, nil },
		getCheckinSettings:    get,
		updateCheckinSettings: update,
	})
}

func checkinSettingsPath(eventID uuid.UUID) string {
	return "/api/events/" + eventID.String() + "/checkin-settings"
}

func setCheckinSettingsPathParams(c echo.Context, eventID uuid.UUID) {
	c.SetPath("/api/events/:id/checkin-settings")
	c.SetParamNames("id")
	c.SetParamValues(eventID.String())
}

// GET with NULL column (no settings saved yet) → {settings: null}.
func TestOpenAPIContract_GetCheckinSettings_NullColumn(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	h := newCheckinSettingsHandler(event,
		func(uuid.UUID) (json.RawMessage, error) { return nil, nil },
		nil,
	)
	e := echo.New()
	path := checkinSettingsPath(event.ID)
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	setCheckinSettingsPathParams(c, event.ID)

	if err := h.GetCheckinSettings(c); err != nil {
		t.Fatalf("GetCheckinSettings: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	var got CheckinSettingsResponse
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	// encoding/json invokes json.RawMessage.UnmarshalJSON even for a
	// literal null, storing the 4 bytes "null" rather than leaving the
	// field nil — so the correct "is it null" check is on the decoded
	// text, not a nil comparison.
	if string(bytes.TrimSpace(got.Settings)) != "null" {
		t.Fatalf("got settings=%s, want null", got.Settings)
	}
	validateResponse(t, http.MethodGet, path, rec)
}

// GET after seeding → the stored object, echoed as-is.
func TestOpenAPIContract_GetCheckinSettings_Seeded(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	stored := json.RawMessage(`{"print_on_checkin":true,"verdict_auto_dismiss_sec":5,"scan_input":"wedge","manual_search_enabled":false}`)
	h := newCheckinSettingsHandler(event,
		func(uuid.UUID) (json.RawMessage, error) { return stored, nil },
		nil,
	)
	e := echo.New()
	path := checkinSettingsPath(event.ID)
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	setCheckinSettingsPathParams(c, event.ID)

	if err := h.GetCheckinSettings(c); err != nil {
		t.Fatalf("GetCheckinSettings: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	var got CheckinSettingsResponse
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !bytes.Equal(bytes.TrimSpace(got.Settings), stored) {
		t.Fatalf("got settings=%s, want %s", got.Settings, stored)
	}
	validateResponse(t, http.MethodGet, path, rec)
}

// PUT happy path → 200, AND the fakeStore captured settings bytes are
// byte-identical to the request's raw "settings" bytes — the
// verbatim-storage proof (badge_template precedent).
func TestOpenAPIContract_PutCheckinSettings_HappyPathIsVerbatim(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")

	var captured json.RawMessage
	h := newCheckinSettingsHandler(event,
		func(uuid.UUID) (json.RawMessage, error) { return nil, nil },
		func(_ uuid.UUID, settings json.RawMessage) error {
			captured = append(json.RawMessage(nil), settings...)
			return nil
		},
	)

	requestBody := `{"settings":{"print_on_checkin":true,"verdict_auto_dismiss_sec":5,"scan_input":"wedge","manual_search_enabled":false}}`
	rawSettingsBytes := json.RawMessage(`{"print_on_checkin":true,"verdict_auto_dismiss_sec":5,"scan_input":"wedge","manual_search_enabled":false}`)

	e := echo.New()
	path := checkinSettingsPath(event.ID)
	c, rec := newAuthedContext(e, http.MethodPut, path, requestBody, tenantID.String(), "admin")
	setCheckinSettingsPathParams(c, event.ID)

	if err := h.PutCheckinSettings(c); err != nil {
		t.Fatalf("PutCheckinSettings: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if !bytes.Equal(captured, rawSettingsBytes) {
		t.Fatalf("store captured settings = %s, want byte-identical to %s (verbatim storage broken)", captured, rawSettingsBytes)
	}

	var got CheckinSettingsResponse
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !bytes.Equal(bytes.TrimSpace(got.Settings), rawSettingsBytes) {
		t.Fatalf("response settings = %s, want byte-identical to %s", got.Settings, rawSettingsBytes)
	}
	validateResponse(t, http.MethodPut, path, rec)
}

// PUT with verdict_auto_dismiss_sec outside [1, 30] → 400, for both the
// low and high boundary violations.
func TestOpenAPIContract_PutCheckinSettings_VerdictAutoDismissSecOutOfRange400(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	newHandler := func() *Handler {
		return newCheckinSettingsHandler(event,
			func(uuid.UUID) (json.RawMessage, error) { return nil, nil },
			func(uuid.UUID, json.RawMessage) error {
				t.Fatalf("UpdateCheckinSettings should not be called when verdict_auto_dismiss_sec is out of range")
				return nil
			},
		)
	}
	e := echo.New()
	path := checkinSettingsPath(event.ID)

	for name, sec := range map[string]int{"zero": 0, "thirty_one": 31} {
		h := newHandler()
		body := `{"settings":{"print_on_checkin":true,"verdict_auto_dismiss_sec":` +
			strconv.Itoa(sec) + `,"scan_input":"wedge","manual_search_enabled":false}}`
		c, rec := newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "admin")
		setCheckinSettingsPathParams(c, event.ID)
		if err := h.PutCheckinSettings(c); err != nil {
			t.Fatalf("%s: PutCheckinSettings: %v", name, err)
		}
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: want 400, got %d, body=%s", name, rec.Code, rec.Body.String())
		}
		validateResponse(t, http.MethodPut, path, rec)
	}
}

// PUT with an unrecognized scan_input value → 400.
func TestOpenAPIContract_PutCheckinSettings_InvalidScanInput400(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	h := newCheckinSettingsHandler(event,
		func(uuid.UUID) (json.RawMessage, error) { return nil, nil },
		func(uuid.UUID, json.RawMessage) error {
			t.Fatalf("UpdateCheckinSettings should not be called when scan_input is invalid")
			return nil
		},
	)
	e := echo.New()
	path := checkinSettingsPath(event.ID)
	body := `{"settings":{"print_on_checkin":true,"verdict_auto_dismiss_sec":5,"scan_input":"camera","manual_search_enabled":false}}`
	c, rec := newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "admin")
	setCheckinSettingsPathParams(c, event.ID)

	if err := h.PutCheckinSettings(c); err != nil {
		t.Fatalf("PutCheckinSettings: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Error string `json:"error"`
	}
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Error == "" {
		t.Fatalf("want a non-empty error message")
	}
	validateResponse(t, http.MethodPut, path, rec)
}

// GET and PUT on a foreign event (different tenant) both 404 —
// requireEventOwnership masks "foreign" as "missing", checked before any
// store call.
func TestOpenAPIContract_CheckinSettings_ForeignEvent404(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	foreignTenantID := uuid.New()
	path := checkinSettingsPath(event.ID)

	t.Run("GET", func(t *testing.T) {
		h := newCheckinSettingsHandler(event,
			func(uuid.UUID) (json.RawMessage, error) {
				t.Fatalf("GetCheckinSettings should not be called for a foreign event")
				return nil, nil
			},
			nil,
		)
		e := echo.New()
		c, rec := newAuthedContext(e, http.MethodGet, path, "", foreignTenantID.String(), "admin")
		setCheckinSettingsPathParams(c, event.ID)
		if err := h.GetCheckinSettings(c); err != nil {
			t.Fatalf("GetCheckinSettings: %v", err)
		}
		if rec.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
		}
		validateResponse(t, http.MethodGet, path, rec)
	})

	t.Run("PUT", func(t *testing.T) {
		h := newCheckinSettingsHandler(event,
			func(uuid.UUID) (json.RawMessage, error) {
				t.Fatalf("GetCheckinSettings should not be called for a foreign event")
				return nil, nil
			},
			func(uuid.UUID, json.RawMessage) error {
				t.Fatalf("UpdateCheckinSettings should not be called for a foreign event")
				return nil
			},
		)
		e := echo.New()
		body := `{"settings":{"print_on_checkin":true,"verdict_auto_dismiss_sec":5,"scan_input":"wedge","manual_search_enabled":false}}`
		c, rec := newAuthedContext(e, http.MethodPut, path, body, foreignTenantID.String(), "admin")
		setCheckinSettingsPathParams(c, event.ID)
		if err := h.PutCheckinSettings(c); err != nil {
			t.Fatalf("PutCheckinSettings: %v", err)
		}
		if rec.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
		}
		validateResponse(t, http.MethodPut, path, rec)
	})
}

// GET/PUT with a malformed event id (not a UUID) → 400, checked before
// ownership/body parsing.
func TestOpenAPIContract_CheckinSettings_InvalidEventID400(t *testing.T) {
	tenantID := uuid.New()
	e := echo.New()
	badPath := "/api/events/not-a-uuid/checkin-settings"

	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) {
			t.Fatalf("GetEventByID should not be called when event id fails to parse")
			return nil, nil
		},
	})

	c, rec := newAuthedContext(e, http.MethodGet, badPath, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:id/checkin-settings")
	c.SetParamNames("id")
	c.SetParamValues("not-a-uuid")
	if err := h.GetCheckinSettings(c); err != nil {
		t.Fatalf("GetCheckinSettings: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("GET: want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, badPath, rec)

	body := `{"settings":{"print_on_checkin":true,"verdict_auto_dismiss_sec":5,"scan_input":"wedge","manual_search_enabled":false}}`
	c, rec = newAuthedContext(e, http.MethodPut, badPath, body, tenantID.String(), "admin")
	c.SetPath("/api/events/:id/checkin-settings")
	c.SetParamNames("id")
	c.SetParamValues("not-a-uuid")
	if err := h.PutCheckinSettings(c); err != nil {
		t.Fatalf("PutCheckinSettings: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("PUT: want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPut, badPath, rec)
}

// --- Task 2: check-in station register / heartbeat / list ---

// newCheckinStationHandler builds a Handler whose event store returns
// event for any GetEventByID(ForTenant) lookup, wired to the given
// check-in-station fake functions. Any argument left nil panics if the
// corresponding handler path is exercised — surfacing an unexpected call.
func newCheckinStationHandler(
	event *models.Event,
	getZone func(id uuid.UUID) (*models.EventZone, error),
	upsert func(eventID uuid.UUID, name string, zoneID *uuid.UUID) (*models.CheckinStation, error),
	heartbeat func(eventID, stationID uuid.UUID) error,
	list func(eventID uuid.UUID) ([]*models.CheckinStation, error),
) *Handler {
	return New(&fakeStore{
		getEventByID:            func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID:        getZone,
		upsertCheckinStation:    upsert,
		heartbeatCheckinStation: heartbeat,
		listCheckinStations:     list,
	})
}

func checkinStationsPath(eventID uuid.UUID) string {
	return "/api/events/" + eventID.String() + "/checkin-stations"
}

func checkinStationHeartbeatPath(eventID, stationID uuid.UUID) string {
	return checkinStationsPath(eventID) + "/" + stationID.String() + "/heartbeat"
}

func setCheckinStationsPathParams(c echo.Context, eventID uuid.UUID) {
	c.SetPath("/api/events/:event_id/checkin-stations")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
}

func setCheckinStationHeartbeatPathParams(c echo.Context, eventID, stationID uuid.UUID) {
	c.SetPath("/api/events/:event_id/checkin-stations/:id/heartbeat")
	c.SetParamNames("event_id", "id")
	c.SetParamValues(eventID.String(), stationID.String())
}

// Register a station under a brand-new name → 200 with the station.
func TestOpenAPIContract_RegisterCheckinStation_NewName(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	stationID := uuid.New()
	now := time.Now()

	h := newCheckinStationHandler(event,
		func(uuid.UUID) (*models.EventZone, error) {
			t.Fatalf("GetEventZoneByID should not be called when zone_id is absent")
			return nil, nil
		},
		func(eventID uuid.UUID, name string, zoneID *uuid.UUID) (*models.CheckinStation, error) {
			if name != "Main Entrance" {
				t.Fatalf("name = %q, want Main Entrance", name)
			}
			if zoneID != nil {
				t.Fatalf("zoneID = %v, want nil", zoneID)
			}
			return &models.CheckinStation{ID: stationID, EventID: eventID, Name: name, LastSeenAt: now, CreatedAt: now}, nil
		},
		nil, nil,
	)

	e := echo.New()
	path := checkinStationsPath(event.ID)
	body := `{"name":"Main Entrance"}`
	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	setCheckinStationsPathParams(c, event.ID)

	if err := h.RegisterCheckinStation(c); err != nil {
		t.Fatalf("RegisterCheckinStation: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	var got CheckinStationResponse
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Station == nil || got.Station.ID != stationID {
		t.Fatalf("got station=%+v, want id=%s", got.Station, stationID)
	}
	validateResponse(t, http.MethodPost, path, rec)
}

// Registering the SAME name twice, with a DIFFERENT zone_id the second
// time, must come back as the SAME station id with the zone updated —
// the upsert proof (store.UpsertCheckinStation's ON CONFLICT semantics),
// exercised here via a stateful fake standing in for the real upsert.
func TestOpenAPIContract_RegisterCheckinStation_UpsertSameNameUpdatesZone(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zoneA := &models.EventZone{ID: uuid.New(), EventID: event.ID}
	zoneB := &models.EventZone{ID: uuid.New(), EventID: event.ID}
	stationID := uuid.New()
	now := time.Now()
	zones := map[uuid.UUID]*models.EventZone{zoneA.ID: zoneA, zoneB.ID: zoneB}

	current := &models.CheckinStation{ID: stationID, EventID: event.ID, Name: "Main Entrance", LastSeenAt: now, CreatedAt: now}
	h := newCheckinStationHandler(event,
		func(id uuid.UUID) (*models.EventZone, error) { return zones[id], nil },
		func(eventID uuid.UUID, name string, zoneID *uuid.UUID) (*models.CheckinStation, error) {
			current.ZoneID = zoneID
			return current, nil
		},
		nil, nil,
	)

	e := echo.New()
	path := checkinStationsPath(event.ID)

	body1 := `{"name":"Main Entrance","zone_id":"` + zoneA.ID.String() + `"}`
	c1, rec1 := newAuthedContext(e, http.MethodPost, path, body1, tenantID.String(), "admin")
	setCheckinStationsPathParams(c1, event.ID)
	if err := h.RegisterCheckinStation(c1); err != nil {
		t.Fatalf("first register: %v", err)
	}
	if rec1.Code != http.StatusOK {
		t.Fatalf("first register: want 200, got %d, body=%s", rec1.Code, rec1.Body.String())
	}
	var got1 CheckinStationResponse
	if err := jsonUnmarshalBody(rec1, &got1); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got1.Station.ZoneID == nil || *got1.Station.ZoneID != zoneA.ID {
		t.Fatalf("first register zone_id = %v, want %s", got1.Station.ZoneID, zoneA.ID)
	}
	validateResponse(t, http.MethodPost, path, rec1)

	body2 := `{"name":"Main Entrance","zone_id":"` + zoneB.ID.String() + `"}`
	c2, rec2 := newAuthedContext(e, http.MethodPost, path, body2, tenantID.String(), "admin")
	setCheckinStationsPathParams(c2, event.ID)
	if err := h.RegisterCheckinStation(c2); err != nil {
		t.Fatalf("second register: %v", err)
	}
	if rec2.Code != http.StatusOK {
		t.Fatalf("second register: want 200, got %d, body=%s", rec2.Code, rec2.Body.String())
	}
	var got2 CheckinStationResponse
	if err := jsonUnmarshalBody(rec2, &got2); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got2.Station.ID != stationID {
		t.Fatalf("second register id = %s, want SAME id %s (upsert proof)", got2.Station.ID, stationID)
	}
	if got2.Station.ZoneID == nil || *got2.Station.ZoneID != zoneB.ID {
		t.Fatalf("second register zone_id = %v, want %s (zone updated)", got2.Station.ZoneID, zoneB.ID)
	}
	validateResponse(t, http.MethodPost, path, rec2)
}

// A missing/empty name never reaches the store.
func TestOpenAPIContract_RegisterCheckinStation_EmptyName400(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	h := newCheckinStationHandler(event, nil,
		func(uuid.UUID, string, *uuid.UUID) (*models.CheckinStation, error) {
			t.Fatalf("UpsertCheckinStation should not be called when name is empty")
			return nil, nil
		},
		nil, nil,
	)
	e := echo.New()
	path := checkinStationsPath(event.ID)
	body := `{"name":"   "}`
	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	setCheckinStationsPathParams(c, event.ID)

	if err := h.RegisterCheckinStation(c); err != nil {
		t.Fatalf("RegisterCheckinStation: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

// A zone_id that belongs to a DIFFERENT event is a 400, never a store call.
func TestOpenAPIContract_RegisterCheckinStation_ForeignZone400(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	foreignZone := &models.EventZone{ID: uuid.New(), EventID: uuid.New()}
	h := newCheckinStationHandler(event,
		func(uuid.UUID) (*models.EventZone, error) { return foreignZone, nil },
		func(uuid.UUID, string, *uuid.UUID) (*models.CheckinStation, error) {
			t.Fatalf("UpsertCheckinStation should not be called for a foreign zone")
			return nil, nil
		},
		nil, nil,
	)
	e := echo.New()
	path := checkinStationsPath(event.ID)
	body := `{"name":"Main Entrance","zone_id":"` + foreignZone.ID.String() + `"}`
	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	setCheckinStationsPathParams(c, event.ID)

	if err := h.RegisterCheckinStation(c); err != nil {
		t.Fatalf("RegisterCheckinStation: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

// A zone_id that doesn't exist at all is also a 400 (same as foreign).
func TestOpenAPIContract_RegisterCheckinStation_UnknownZone400(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	h := newCheckinStationHandler(event,
		func(uuid.UUID) (*models.EventZone, error) { return nil, nil },
		func(uuid.UUID, string, *uuid.UUID) (*models.CheckinStation, error) {
			t.Fatalf("UpsertCheckinStation should not be called for an unknown zone")
			return nil, nil
		},
		nil, nil,
	)
	e := echo.New()
	path := checkinStationsPath(event.ID)
	body := `{"name":"Main Entrance","zone_id":"` + uuid.New().String() + `"}`
	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	setCheckinStationsPathParams(c, event.ID)

	if err := h.RegisterCheckinStation(c); err != nil {
		t.Fatalf("RegisterCheckinStation: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

// Heartbeat on a known station → 204.
func TestOpenAPIContract_HeartbeatCheckinStation_Known204(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	stationID := uuid.New()
	h := newCheckinStationHandler(event, nil, nil,
		func(eventID, gotStationID uuid.UUID) error {
			if eventID != event.ID || gotStationID != stationID {
				t.Fatalf("heartbeat called with eventID=%s stationID=%s, want eventID=%s stationID=%s", eventID, gotStationID, event.ID, stationID)
			}
			return nil
		},
		nil,
	)
	e := echo.New()
	path := checkinStationHeartbeatPath(event.ID, stationID)
	c, rec := newAuthedContext(e, http.MethodPost, path, "", tenantID.String(), "admin")
	setCheckinStationHeartbeatPathParams(c, event.ID, stationID)

	if err := h.HeartbeatCheckinStation(c); err != nil {
		t.Fatalf("HeartbeatCheckinStation: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

// Heartbeat on an unknown/foreign station id → 404.
func TestOpenAPIContract_HeartbeatCheckinStation_Unknown404(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	stationID := uuid.New()
	h := newCheckinStationHandler(event, nil, nil,
		func(uuid.UUID, uuid.UUID) error { return store.ErrCheckinStationNotFound },
		nil,
	)
	e := echo.New()
	path := checkinStationHeartbeatPath(event.ID, stationID)
	c, rec := newAuthedContext(e, http.MethodPost, path, "", tenantID.String(), "admin")
	setCheckinStationHeartbeatPathParams(c, event.ID, stationID)

	if err := h.HeartbeatCheckinStation(c); err != nil {
		t.Fatalf("HeartbeatCheckinStation: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

// List returns every registered station.
func TestOpenAPIContract_ListCheckinStations_ReturnsRegistered(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	now := time.Now()
	stations := []*models.CheckinStation{
		{ID: uuid.New(), EventID: event.ID, Name: "Main Entrance", LastSeenAt: now, CreatedAt: now},
		{ID: uuid.New(), EventID: event.ID, Name: "Side Door", LastSeenAt: now, CreatedAt: now},
	}
	h := newCheckinStationHandler(event, nil, nil, nil,
		func(uuid.UUID) ([]*models.CheckinStation, error) { return stations, nil },
	)
	e := echo.New()
	path := checkinStationsPath(event.ID)
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	setCheckinStationsPathParams(c, event.ID)

	if err := h.ListCheckinStations(c); err != nil {
		t.Fatalf("ListCheckinStations: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	var got CheckinStationListResponse
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(got.Stations) != 2 {
		t.Fatalf("got %d stations, want 2", len(got.Stations))
	}
	validateResponse(t, http.MethodGet, path, rec)
}

// Register/heartbeat/list on a foreign event (different tenant) all 404 —
// requireEventOwnership masks "foreign" as "missing", checked before any
// store call.
func TestOpenAPIContract_CheckinStations_ForeignEvent404(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	foreignTenantID := uuid.New()
	stationID := uuid.New()

	t.Run("register", func(t *testing.T) {
		h := newCheckinStationHandler(event, nil,
			func(uuid.UUID, string, *uuid.UUID) (*models.CheckinStation, error) {
				t.Fatalf("UpsertCheckinStation should not be called for a foreign event")
				return nil, nil
			},
			nil, nil,
		)
		e := echo.New()
		path := checkinStationsPath(event.ID)
		body := `{"name":"Main Entrance"}`
		c, rec := newAuthedContext(e, http.MethodPost, path, body, foreignTenantID.String(), "admin")
		setCheckinStationsPathParams(c, event.ID)
		if err := h.RegisterCheckinStation(c); err != nil {
			t.Fatalf("RegisterCheckinStation: %v", err)
		}
		if rec.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
		}
		validateResponse(t, http.MethodPost, path, rec)
	})

	t.Run("heartbeat", func(t *testing.T) {
		h := newCheckinStationHandler(event, nil, nil,
			func(uuid.UUID, uuid.UUID) error {
				t.Fatalf("HeartbeatCheckinStation should not be called for a foreign event")
				return nil
			},
			nil,
		)
		e := echo.New()
		path := checkinStationHeartbeatPath(event.ID, stationID)
		c, rec := newAuthedContext(e, http.MethodPost, path, "", foreignTenantID.String(), "admin")
		setCheckinStationHeartbeatPathParams(c, event.ID, stationID)
		if err := h.HeartbeatCheckinStation(c); err != nil {
			t.Fatalf("HeartbeatCheckinStation: %v", err)
		}
		if rec.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
		}
		validateResponse(t, http.MethodPost, path, rec)
	})

	t.Run("list", func(t *testing.T) {
		h := newCheckinStationHandler(event, nil, nil, nil,
			func(uuid.UUID) ([]*models.CheckinStation, error) {
				t.Fatalf("ListCheckinStations should not be called for a foreign event")
				return nil, nil
			},
		)
		e := echo.New()
		path := checkinStationsPath(event.ID)
		c, rec := newAuthedContext(e, http.MethodGet, path, "", foreignTenantID.String(), "admin")
		setCheckinStationsPathParams(c, event.ID)
		if err := h.ListCheckinStations(c); err != nil {
			t.Fatalf("ListCheckinStations: %v", err)
		}
		if rec.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
		}
		validateResponse(t, http.MethodGet, path, rec)
	})
}
