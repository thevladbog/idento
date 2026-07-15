package handler

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// p2Attendee builds a fixture attendee with the given identity/status, used
// by the pagination/filter fake store below.
func p2Attendee(eventID uuid.UUID, firstName, lastName string, checkedIn bool) *models.Attendee {
	now := time.Now()
	return &models.Attendee{
		ID:            uuid.New(),
		EventID:       eventID,
		FirstName:     firstName,
		LastName:      lastName,
		Email:         strings.ToLower(firstName) + "@example.com",
		Code:          "CODE-" + strings.ToUpper(firstName),
		CheckinStatus: checkedIn,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
}

// fakeAttendeePager reproduces GetAttendeesPage's filter/count/page semantics
// in memory over a fixed attendee set, so the handler's query-param parsing,
// validation, and envelope/legacy branching can be exercised end-to-end
// through the fakeStore contract-test harness (house style: see
// openapi_contract_attendees_test.go). It is not a substitute for the real
// SQL correctness proof — that's covered by the pgxmock query-shape tests in
// internal/store/pg_store_attendees_page_test.go and the real-Postgres
// TestSeeded5kAttendees_ScaleExitCriterion test in
// internal/store/pg_store_attendees_page_integration_test.go (gated by
// TEST_DATABASE_URL).
type fakeAttendeePager struct {
	all        []*models.Attendee
	zoneAccess map[uuid.UUID]uuid.UUID // attendeeID -> zoneID it has an allowed=true override for
}

func (p *fakeAttendeePager) page(eventID uuid.UUID, f store.AttendeeFilter) ([]*models.Attendee, int, error) {
	var matched []*models.Attendee
	for _, a := range p.all {
		if a.EventID != eventID {
			continue
		}
		if f.Code != "" && a.Code != f.Code {
			continue
		}
		if f.Search != "" {
			s := strings.ToLower(f.Search)
			if !strings.Contains(strings.ToLower(a.FirstName), s) &&
				!strings.Contains(strings.ToLower(a.LastName), s) &&
				!strings.Contains(strings.ToLower(a.Email), s) &&
				!strings.Contains(strings.ToLower(a.Code), s) {
				continue
			}
		}
		if f.Status != nil && a.CheckinStatus != *f.Status {
			continue
		}
		if f.ZoneID != nil {
			zoneID, ok := p.zoneAccess[a.ID]
			if !ok || zoneID != *f.ZoneID {
				continue
			}
		}
		matched = append(matched, a)
	}
	total := len(matched)

	start := (f.Page - 1) * f.PerPage
	if start > len(matched) {
		start = len(matched)
	}
	end := start + f.PerPage
	if end > len(matched) {
		end = len(matched)
	}
	return matched[start:end], total, nil
}

func newP2Handler(pager *fakeAttendeePager, event *models.Event) *Handler {
	return New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeesPage: func(eventID uuid.UUID, f store.AttendeeFilter) ([]*models.Attendee, int, error) {
			return pager.page(eventID, f)
		},
		getAttendeesByEventID: func(uuid.UUID, string, string) ([]*models.Attendee, error) {
			all, _, _ := pager.page(event.ID, store.AttendeeFilter{Page: 1, PerPage: len(pager.all) + 1})
			return all, nil
		},
	})
}

// (a) Neither page nor per_page present: response is the unchanged legacy
// bare array, not the envelope.
func TestOpenAPIContract_AttendeesP2_NoParamsIsLegacyBareArray(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	pager := &fakeAttendeePager{all: []*models.Attendee{
		p2Attendee(event.ID, "Ada", "Lovelace", false),
		p2Attendee(event.ID, "Bob", "Baker", false),
	}}
	h := newP2Handler(pager, event)
	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/attendees"
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetAttendees(c); err != nil {
		t.Fatalf("GetAttendees: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	body := strings.TrimSpace(rec.Body.String())
	if !strings.HasPrefix(body, "[") {
		t.Fatalf("want bare array (body starting with '['), got %s", body)
	}
	validateResponse(t, http.MethodGet, path, rec)
}

// (b) page=1&per_page=2 returns the envelope with exactly 2 items and the
// correct total across all matching attendees.
func TestOpenAPIContract_AttendeesP2_FirstPageEnvelope(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	pager := &fakeAttendeePager{all: []*models.Attendee{
		p2Attendee(event.ID, "Ada", "Lovelace", false),
		p2Attendee(event.ID, "Bob", "Baker", false),
		p2Attendee(event.ID, "Cid", "Carter", false),
	}}
	h := newP2Handler(pager, event)
	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/attendees?page=1&per_page=2"
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetAttendees(c); err != nil {
		t.Fatalf("GetAttendees: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Attendees []*models.Attendee `json:"attendees"`
		Total     int                `json:"total"`
		Page      int                `json:"page"`
		PerPage   int                `json:"per_page"`
	}
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(got.Attendees) != 2 || got.Total != 3 || got.Page != 1 || got.PerPage != 2 {
		t.Fatalf("got %+v, want 2 attendees/total=3/page=1/per_page=2", got)
	}
	validateResponse(t, http.MethodGet, "/api/events/"+event.ID.String()+"/attendees", rec)
}

// (c) page=2&per_page=2 returns the next slice (the remaining 1 of 3).
func TestOpenAPIContract_AttendeesP2_SecondPageSlice(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	pager := &fakeAttendeePager{all: []*models.Attendee{
		p2Attendee(event.ID, "Ada", "Lovelace", false),
		p2Attendee(event.ID, "Bob", "Baker", false),
		p2Attendee(event.ID, "Cid", "Carter", false),
	}}
	h := newP2Handler(pager, event)
	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/attendees?page=2&per_page=2"
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetAttendees(c); err != nil {
		t.Fatalf("GetAttendees: %v", err)
	}
	var got struct {
		Attendees []*models.Attendee `json:"attendees"`
		Total     int                `json:"total"`
	}
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(got.Attendees) != 1 || got.Total != 3 {
		t.Fatalf("got %+v, want 1 attendee (remainder)/total=3", got)
	}
	validateResponse(t, http.MethodGet, "/api/events/"+event.ID.String()+"/attendees", rec)
}

// (d) status=checked_in filters to only checked-in attendees.
func TestOpenAPIContract_AttendeesP2_StatusFilter(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	checkedIn := p2Attendee(event.ID, "Ada", "Lovelace", true)
	pager := &fakeAttendeePager{all: []*models.Attendee{
		checkedIn,
		p2Attendee(event.ID, "Bob", "Baker", false),
	}}
	h := newP2Handler(pager, event)
	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/attendees?page=1&per_page=50&status=checked_in"
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetAttendees(c); err != nil {
		t.Fatalf("GetAttendees: %v", err)
	}
	var got struct {
		Attendees []*models.Attendee `json:"attendees"`
		Total     int                `json:"total"`
	}
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Total != 1 || len(got.Attendees) != 1 || got.Attendees[0].ID != checkedIn.ID {
		t.Fatalf("got %+v, want exactly the checked-in attendee", got)
	}
	validateResponse(t, http.MethodGet, "/api/events/"+event.ID.String()+"/attendees", rec)
}

// (e) zone=<uuid> filters to attendees with an (simulated) allowed=true
// attendee_zone_access row for that zone.
func TestOpenAPIContract_AttendeesP2_ZoneFilter(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zoneID := uuid.New()
	inZone := p2Attendee(event.ID, "Ada", "Lovelace", false)
	pager := &fakeAttendeePager{
		all: []*models.Attendee{
			inZone,
			p2Attendee(event.ID, "Bob", "Baker", false),
		},
		zoneAccess: map[uuid.UUID]uuid.UUID{inZone.ID: zoneID},
	}
	h := newP2Handler(pager, event)
	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/attendees?page=1&per_page=50&zone=" + zoneID.String()
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetAttendees(c); err != nil {
		t.Fatalf("GetAttendees: %v", err)
	}
	var got struct {
		Attendees []*models.Attendee `json:"attendees"`
		Total     int                `json:"total"`
	}
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Total != 1 || len(got.Attendees) != 1 || got.Attendees[0].ID != inZone.ID {
		t.Fatalf("got %+v, want exactly the in-zone attendee", got)
	}
	validateResponse(t, http.MethodGet, "/api/events/"+event.ID.String()+"/attendees", rec)
}

// (f) Invalid pagination params (per_page=0, per_page=201, page=0) all 400
// with the standard Error shape.
func TestOpenAPIContract_AttendeesP2_InvalidPaginationParams400(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	pager := &fakeAttendeePager{all: []*models.Attendee{p2Attendee(event.ID, "Ada", "Lovelace", false)}}
	h := newP2Handler(pager, event)
	e := echo.New()

	for _, qs := range []string{"per_page=0", "per_page=201", "page=0"} {
		path := "/api/events/" + event.ID.String() + "/attendees?" + qs
		c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
		c.SetPath("/api/events/:event_id/attendees")
		c.SetParamNames("event_id")
		c.SetParamValues(event.ID.String())
		if err := h.GetAttendees(c); err != nil {
			t.Fatalf("GetAttendees(%s): %v", qs, err)
		}
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: want 400, got %d, body=%s", qs, rec.Code, rec.Body.String())
		}
		validateResponse(t, http.MethodGet, "/api/events/"+event.ID.String()+"/attendees", rec)
	}
}

// (g) Filters compose: search narrows within the zone/status-filtered set.
func TestOpenAPIContract_AttendeesP2_FiltersCompose(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	target := p2Attendee(event.ID, "Jane", "Doe", true)
	pager := &fakeAttendeePager{all: []*models.Attendee{
		target,
		p2Attendee(event.ID, "Jane", "Smith", false), // same first name, not checked in -> excluded by status
		p2Attendee(event.ID, "Bob", "Baker", true),   // checked in, but doesn't match search -> excluded
	}}
	h := newP2Handler(pager, event)
	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/attendees?page=1&per_page=50&status=checked_in&search=jane"
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetAttendees(c); err != nil {
		t.Fatalf("GetAttendees: %v", err)
	}
	var got struct {
		Attendees []*models.Attendee `json:"attendees"`
		Total     int                `json:"total"`
	}
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Total != 1 || len(got.Attendees) != 1 || got.Attendees[0].ID != target.ID {
		t.Fatalf("got %+v, want exactly the composed-filter match", got)
	}
	validateResponse(t, http.MethodGet, "/api/events/"+event.ID.String()+"/attendees", rec)
}
