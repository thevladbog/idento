package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"idento/backend/internal/models"

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
