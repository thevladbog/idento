package handler

import (
	"encoding/json"
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

// (h) BulkCreateAttendees with per-row errors: row 2 duplicates an existing
// email, row 3 duplicates an existing code, all others are valid. Assert
// 201, correct created count, errors array with row/problem/data, legacy
// duplicates still populated.
func TestOpenAPIContract_BulkCreateAttendees_PerRowErrors(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Conference")

	// Existing attendee with email alice@example.com
	existing1 := &models.Attendee{
		ID:        uuid.New(),
		EventID:   event.ID,
		Email:     "alice@example.com",
		Code:      "CODE-ALICE",
		FirstName: "Alice",
		LastName:  "Smith",
	}
	// Existing attendee with code EXISTING-CODE (will be duplicated by row 3)
	existing2 := &models.Attendee{
		ID:        uuid.New(),
		EventID:   event.ID,
		Email:     "bob@example.com",
		Code:      "EXISTING-CODE",
		FirstName: "Bob",
		LastName:  "Jones",
	}

	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeesByEventID: func(uuid.UUID, string, string) ([]*models.Attendee, error) {
			return []*models.Attendee{existing1, existing2}, nil
		},
		checkAttendeeLimit: func(uuid.UUID, uuid.UUID, int) (bool, int, int, error) {
			return true, 2, 1000, nil // allowed, 2 current, 1000 max
		},
		createAttendee: func(a *models.Attendee) error {
			// Only fail for the specific row we want to test failure on
			// (in this test, we're only testing duplicates, so create succeeds for non-duplicates)
			return nil
		},
		updateEvent: func(*models.Event) error { return nil },
	})

	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/attendees/bulk"

	// Batch: row 1 valid, row 2 email dup, row 3 code dup, row 4 valid, row 5 valid
	body := map[string]interface{}{
		"attendees": []map[string]interface{}{
			{
				"first_name": "Charlie",
				"last_name":  "Brown",
				"email":      "charlie@example.com",
			},
			{
				"first_name": "Diana",
				"last_name":  "Prince",
				"email":      "alice@example.com", // DUPLICATE email from existing1
			},
			{
				"first_name": "Eve",
				"last_name":  "Davis",
				"code":       "EXISTING-CODE", // DUPLICATE code from existing2
			},
			{
				"first_name": "Frank",
				"last_name":  "Miller",
				"email":      "frank@example.com",
			},
			{
				"first_name": "Grace",
				"last_name":  "Lee",
				"email":      "grace@example.com",
			},
		},
	}

	bodyBytes, _ := json.Marshal(body)
	bodyStr := string(bodyBytes)

	c, rec := newAuthedContext(e, http.MethodPost, path, bodyStr, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/attendees/bulk")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())

	if err := h.BulkCreateAttendees(c); err != nil {
		t.Fatalf("BulkCreateAttendees: %v", err)
	}

	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}

	var got struct {
		Message    string          `json:"message"`
		Created    int             `json:"created"`
		Skipped    int             `json:"skipped"`
		Total      int             `json:"total"`
		Duplicates []DuplicateInfo `json:"duplicates,omitempty"`
		Errors     []struct {
			Row     int    `json:"row"`
			Data    string `json:"data"`
			Problem string `json:"problem"`
		} `json:"errors,omitempty"`
	}

	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	// Expect: 3 created (rows 1, 4, 5), 2 skipped (rows 2, 3), 5 total
	if got.Created != 3 || got.Skipped != 2 || got.Total != 5 {
		t.Fatalf("got created=%d skipped=%d total=%d, want 3/2/5", got.Created, got.Skipped, got.Total)
	}

	// Check errors array: should have exactly 2 entries for rows 2 and 3
	if len(got.Errors) != 2 {
		t.Fatalf("got %d errors, want 2. errors=%+v", len(got.Errors), got.Errors)
	}

	// Find error for row 2 (email duplicate)
	var row2Found, row3Found bool
	for i := range got.Errors {
		switch got.Errors[i].Row {
		case 2:
			row2Found = true
			if got.Errors[i].Problem != "duplicate_email" {
				t.Fatalf("row 2: got problem=%q, want duplicate_email", got.Errors[i].Problem)
			}
			if got.Errors[i].Data != "Diana Prince" {
				t.Fatalf("row 2: got data=%q, want 'Diana Prince'", got.Errors[i].Data)
			}
		case 3:
			row3Found = true
			if got.Errors[i].Problem != "duplicate_code" {
				t.Fatalf("row 3: got problem=%q, want duplicate_code", got.Errors[i].Problem)
			}
			if got.Errors[i].Data != "Eve Davis" {
				t.Fatalf("row 3: got data=%q, want 'Eve Davis'", got.Errors[i].Data)
			}
		}
	}

	if !row2Found {
		t.Fatalf("missing error for row 2")
	}
	if !row3Found {
		t.Fatalf("missing error for row 3")
	}

	// Check legacy duplicates field is still populated
	if len(got.Duplicates) != 2 {
		t.Fatalf("got %d duplicates, want 2. duplicates=%+v", len(got.Duplicates), got.Duplicates)
	}

	// Verify duplicates are in the response (unchanged behavior)
	var dup2Email, dup3Code *DuplicateInfo
	for i := range got.Duplicates {
		if got.Duplicates[i].Email == "alice@example.com" {
			dup2Email = &got.Duplicates[i]
		} else if got.Duplicates[i].Code == "EXISTING-CODE" {
			dup3Code = &got.Duplicates[i]
		}
	}

	if dup2Email == nil || dup2Email.Reason != "email" {
		t.Fatalf("missing or incorrect email duplicate in legacy duplicates")
	}
	if dup3Code == nil || dup3Code.Reason != "code" {
		t.Fatalf("missing or incorrect code duplicate in legacy duplicates")
	}

	validateResponse(t, http.MethodPost, "/api/events/"+event.ID.String()+"/attendees/bulk", rec)
}

// TestOpenAPIContract_UnassignStaffFromEvent exercises the DELETE
// /api/events/{event_id}/staff/{user_id} endpoint, including basic
// idempotency and error cases.
func TestOpenAPIContract_UnassignStaffFromEvent(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	staffUser := &models.User{
		ID:       uuid.New(),
		Email:    "staff@example.com",
		Role:     "staff",
		TenantID: tenantID,
	}

	// Track which staff are assigned to the event (simulate store state)
	assignedStaff := map[uuid.UUID]bool{staffUser.ID: true}

	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventStaff: func(eventID uuid.UUID) ([]*models.User, error) {
			if assignedStaff[staffUser.ID] {
				return []*models.User{staffUser}, nil
			}
			return []*models.User{}, nil
		},
		removeStaffFromEvent: func(eventID, userID uuid.UUID) error {
			// Idempotent: just mark as not assigned (no error on already-unassigned)
			assignedStaff[userID] = false
			return nil
		},
	})

	e := echo.New()

	// Step 1: Verify staff is initially in list
	c, rec := newAuthedContext(e, http.MethodGet, "/api/events/"+event.ID.String()+"/staff", "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/staff")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetEventStaff(c); err != nil {
		t.Fatalf("GetEventStaff (before delete): %v", err)
	}
	var staffList []*models.User
	if err := jsonUnmarshalBody(rec, &staffList); err != nil {
		t.Fatalf("unmarshal staff list: %v", err)
	}
	if len(staffList) != 1 || staffList[0].ID != staffUser.ID {
		t.Fatalf("want 1 staff member initially, got %d staff", len(staffList))
	}

	// Step 2: DELETE staff from event → 204 success
	c, rec = newAuthedContext(e, http.MethodDelete, "/api/events/"+event.ID.String()+"/staff/"+staffUser.ID.String(), "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/staff/:user_id")
	c.SetParamNames("event_id", "user_id")
	c.SetParamValues(event.ID.String(), staffUser.ID.String())
	if err := h.UnassignStaffFromEvent(c); err != nil {
		t.Fatalf("UnassignStaffFromEvent: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE staff: want 204, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, "/api/events/"+event.ID.String()+"/staff/"+staffUser.ID.String(), rec)

	// Step 3: Verify staff is no longer in list
	c, rec = newAuthedContext(e, http.MethodGet, "/api/events/"+event.ID.String()+"/staff", "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/staff")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetEventStaff(c); err != nil {
		t.Fatalf("GetEventStaff (after delete): %v", err)
	}
	staffList = nil
	if err := jsonUnmarshalBody(rec, &staffList); err != nil {
		t.Fatalf("unmarshal staff list after delete: %v", err)
	}
	if len(staffList) != 0 {
		t.Fatalf("want 0 staff members after delete, got %d staff", len(staffList))
	}

	// Step 4: DELETE again on same pair → 204 (idempotent)
	c, rec = newAuthedContext(e, http.MethodDelete, "/api/events/"+event.ID.String()+"/staff/"+staffUser.ID.String(), "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/staff/:user_id")
	c.SetParamNames("event_id", "user_id")
	c.SetParamValues(event.ID.String(), staffUser.ID.String())
	if err := h.UnassignStaffFromEvent(c); err != nil {
		t.Fatalf("UnassignStaffFromEvent (idempotent): %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE staff (idempotent): want 204, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, "/api/events/"+event.ID.String()+"/staff/"+staffUser.ID.String(), rec)

	// Step 5: 400 — invalid event_id (not a UUID)
	c, rec = newAuthedContext(e, http.MethodDelete, "/api/events/not-a-uuid/staff/"+staffUser.ID.String(), "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/staff/:user_id")
	c.SetParamNames("event_id", "user_id")
	c.SetParamValues("not-a-uuid", staffUser.ID.String())
	if err := h.UnassignStaffFromEvent(c); err != nil {
		t.Fatalf("UnassignStaffFromEvent (invalid event_id): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("DELETE staff (invalid event_id): want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, "/api/events/not-a-uuid/staff/"+staffUser.ID.String(), rec)

	// Step 6: 400 — invalid user_id (not a UUID)
	c, rec = newAuthedContext(e, http.MethodDelete, "/api/events/"+event.ID.String()+"/staff/not-a-uuid", "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/staff/:user_id")
	c.SetParamNames("event_id", "user_id")
	c.SetParamValues(event.ID.String(), "not-a-uuid")
	if err := h.UnassignStaffFromEvent(c); err != nil {
		t.Fatalf("UnassignStaffFromEvent (invalid user_id): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("DELETE staff (invalid user_id): want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, "/api/events/"+event.ID.String()+"/staff/not-a-uuid", rec)

	// Step 7: 404 — foreign/nonexistent event (requires different tenant)
	c, rec = newAuthedContext(e, http.MethodDelete, "/api/events/"+event.ID.String()+"/staff/"+staffUser.ID.String(), "", uuid.New().String(), "admin")
	c.SetPath("/api/events/:event_id/staff/:user_id")
	c.SetParamNames("event_id", "user_id")
	c.SetParamValues(event.ID.String(), staffUser.ID.String())
	if err := h.UnassignStaffFromEvent(c); err != nil {
		t.Fatalf("UnassignStaffFromEvent (foreign tenant): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("DELETE staff (foreign event): want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, "/api/events/"+event.ID.String()+"/staff/"+staffUser.ID.String(), rec)
}

// TestOpenAPIContract_UnassignStaffFromEvent_Forbidden verifies that a
// non-admin/non-manager tenant member (e.g. plain "staff") cannot remove
// another staff member's event assignment — mirrors
// TestContractAssignStaffToEvent's role gate on the sibling endpoint.
// Like AssignStaffToEvent's own role check, the 403 is returned as an
// *echo.HTTPError rather than written via c.JSON, so — consistent with
// TestGenerateQRTokenNonMemberIs404's style for the same reason — this
// asserts on the returned error directly instead of rec.Code/validateResponse
// (calling the handler function directly here bypasses echo's central error
// handler, which is what would normally serialize the HTTPError onto the
// response in production).
func TestOpenAPIContract_UnassignStaffFromEvent_Forbidden(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	staffUser := &models.User{
		ID:       uuid.New(),
		Email:    "staff@example.com",
		Role:     "staff",
		TenantID: tenantID,
	}

	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		removeStaffFromEvent: func(eventID, userID uuid.UUID) error {
			t.Fatalf("RemoveStaffFromEvent should not be called when the caller lacks admin/manager role")
			return nil
		},
	})

	e := echo.New()
	c, _ := newAuthedContext(e, http.MethodDelete, "/api/events/"+event.ID.String()+"/staff/"+staffUser.ID.String(), "", tenantID.String(), "staff")
	c.SetPath("/api/events/:event_id/staff/:user_id")
	c.SetParamNames("event_id", "user_id")
	c.SetParamValues(event.ID.String(), staffUser.ID.String())

	err := h.UnassignStaffFromEvent(c)
	httpErr, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("expected *echo.HTTPError, got %v", err)
	}
	if httpErr.Code != http.StatusForbidden {
		t.Fatalf("code = %d, want 403 (non-admin/manager caller)", httpErr.Code)
	}
	if httpErr.Message != "Access denied" {
		t.Fatalf("message = %v, want %q (matches AssignStaffToEvent)", httpErr.Message, "Access denied")
	}
}
