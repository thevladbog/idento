package handler

import (
	"context"
	"net/http/httptest"
	"strings"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// fakeStore embeds store.Store so only the methods a test needs are overridden;
// any un-set method panics if called (which surfaces an unexpected dependency).
type fakeStore struct {
	store.Store
	getEventByID       func(id uuid.UUID) (*models.Event, error)
	getEventZoneByID   func(id uuid.UUID) (*models.EventZone, error)
	getAttendeeByID    func(id uuid.UUID) (*models.Attendee, error)
	getFontByID        func(id uuid.UUID) (*models.Font, error)
	getUsersByTenantID func(tenantID uuid.UUID) ([]*models.User, error)
	getZoneStaffAssign func(zoneID uuid.UUID) ([]*models.StaffZoneAssignment, error)
	getAttendeeByCode  func(eventID uuid.UUID, code string) (*models.Attendee, error)
}

func (f *fakeStore) GetEventByID(_ context.Context, id uuid.UUID) (*models.Event, error) {
	return f.getEventByID(id)
}
func (f *fakeStore) GetEventZoneByID(_ context.Context, id uuid.UUID) (*models.EventZone, error) {
	return f.getEventZoneByID(id)
}
func (f *fakeStore) GetAttendeeByID(_ context.Context, id uuid.UUID) (*models.Attendee, error) {
	return f.getAttendeeByID(id)
}
func (f *fakeStore) GetFontByID(_ context.Context, id uuid.UUID) (*models.Font, error) {
	return f.getFontByID(id)
}
func (f *fakeStore) GetUsersByTenantID(_ context.Context, tenantID uuid.UUID) ([]*models.User, error) {
	return f.getUsersByTenantID(tenantID)
}
func (f *fakeStore) GetZoneStaffAssignments(_ context.Context, zoneID uuid.UUID) ([]*models.StaffZoneAssignment, error) {
	return f.getZoneStaffAssign(zoneID)
}
func (f *fakeStore) GetAttendeeByCode(_ context.Context, eventID uuid.UUID, code string) (*models.Attendee, error) {
	return f.getAttendeeByCode(eventID, code)
}

// newAuthedContext builds an echo.Context with JWT claims already set under "user",
// mimicking what middleware.JWT does, so handlers can be tested without a token.
func newAuthedContext(e *echo.Echo, method, path, body, tenantID, role string) (echo.Context, *httptest.ResponseRecorder) {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("user", &models.JWTCustomClaims{
		UserID:   uuid.New().String(),
		TenantID: tenantID,
		Role:     role,
	})
	return c, rec
}

// newAuthedContextWithUserID is a variant of newAuthedContext that lets the
// caller pin down the JWT's UserID instead of a random one being generated.
// This is needed for tests that must prove a specific caller ID is (or isn't)
// present in a staff-zone assignment list, since the assignment has to be
// constructed to reference the exact same ID the handler will parse out of
// the token.
func newAuthedContextWithUserID(e *echo.Echo, method, path, body, tenantID string, userID uuid.UUID, role string) (echo.Context, *httptest.ResponseRecorder) {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("user", &models.JWTCustomClaims{
		UserID:   userID.String(),
		TenantID: tenantID,
		Role:     role,
	})
	return c, rec
}
