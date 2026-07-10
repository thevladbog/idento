package handler

import (
	"context"
	"net/http/httptest"
	"strings"
	"time"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// fakeStore embeds store.Store so only the methods a test needs are overridden;
// any un-set method panics if called (which surfaces an unexpected dependency).
type fakeStore struct {
	store.Store
	getEventByID              func(id uuid.UUID) (*models.Event, error)
	getEventZoneByID          func(id uuid.UUID) (*models.EventZone, error)
	getAttendeeByID           func(id uuid.UUID) (*models.Attendee, error)
	getFontByID               func(id uuid.UUID) (*models.Font, error)
	getUserByID               func(id uuid.UUID) (*models.User, error)
	getUsersByTenantID        func(tenantID uuid.UUID) ([]*models.User, error)
	getZoneStaffAssign        func(zoneID uuid.UUID) ([]*models.StaffZoneAssignment, error)
	getAttendeeByCode         func(eventID uuid.UUID, code string) (*models.Attendee, error)
	getAttendeeZoneAccessByID func(id uuid.UUID) (*models.AttendeeZoneAccess, error)
	getStaffZoneAssignments   func(userID uuid.UUID) ([]*models.StaffZoneAssignment, error)
	getAPIKeysByEventID       func(eventID uuid.UUID) ([]*models.APIKey, error)
	revokeAPIKey              func(id uuid.UUID) error

	createTenantWithDefaultSubscription func(tenant *models.Tenant) error
	getUserByEmail                      func(email string) (*models.User, error)
	createUser                          func(u *models.User) error
	addUserToTenant                     func(ut *models.UserTenant) error
	getUserTenants                      func(userID uuid.UUID) ([]*models.Tenant, error)

	getSubscriptionByTenantID func(id uuid.UUID) (*models.Subscription, error)
	createSubscription        func(sub *models.Subscription) error
	updateSubscription        func(sub *models.Subscription) error
	logAdminAction            func(adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}) error

	getUserTenantRole func(userID, tenantID uuid.UUID) (string, error)
	updateUserQRToken func(userID uuid.UUID, token string, createdAt time.Time) error
}

func (f *fakeStore) GetEventByID(_ context.Context, id uuid.UUID) (*models.Event, error) {
	return f.getEventByID(id)
}

func (f *fakeStore) GetEventByIDForTenant(_ context.Context, id, tenantID uuid.UUID) (*models.Event, error) {
	ev, err := f.getEventByID(id)
	if err != nil || ev == nil {
		return ev, err
	}
	if ev.TenantID != tenantID {
		return nil, nil
	}
	return ev, nil
}

func (f *fakeStore) GetEventZoneByID(_ context.Context, id uuid.UUID) (*models.EventZone, error) {
	return f.getEventZoneByID(id)
}
func (f *fakeStore) GetAttendeeByID(_ context.Context, id uuid.UUID) (*models.Attendee, error) {
	return f.getAttendeeByID(id)
}

func (f *fakeStore) GetAttendeeByIDForTenant(_ context.Context, id, tenantID uuid.UUID) (*models.Attendee, error) {
	a, err := f.getAttendeeByID(id)
	if err != nil || a == nil {
		return a, err
	}
	ev, err := f.getEventByID(a.EventID)
	if err != nil || ev == nil || ev.TenantID != tenantID {
		return nil, nil
	}
	return a, nil
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
func (f *fakeStore) GetUserByID(_ context.Context, id uuid.UUID) (*models.User, error) {
	return f.getUserByID(id)
}
func (f *fakeStore) GetAttendeeZoneAccessByID(_ context.Context, id uuid.UUID) (*models.AttendeeZoneAccess, error) {
	return f.getAttendeeZoneAccessByID(id)
}
func (f *fakeStore) GetStaffZoneAssignments(_ context.Context, userID uuid.UUID) ([]*models.StaffZoneAssignment, error) {
	return f.getStaffZoneAssignments(userID)
}
func (f *fakeStore) GetAPIKeysByEventID(_ context.Context, eventID uuid.UUID) ([]*models.APIKey, error) {
	return f.getAPIKeysByEventID(eventID)
}
func (f *fakeStore) RevokeAPIKey(_ context.Context, id uuid.UUID) error {
	return f.revokeAPIKey(id)
}

func (f *fakeStore) CreateTenantWithDefaultSubscription(_ context.Context, tenant *models.Tenant) error {
	return f.createTenantWithDefaultSubscription(tenant)
}
func (f *fakeStore) GetUserByEmail(_ context.Context, email string) (*models.User, error) {
	return f.getUserByEmail(email)
}
func (f *fakeStore) CreateUser(_ context.Context, u *models.User) error { return f.createUser(u) }
func (f *fakeStore) AddUserToTenant(_ context.Context, ut *models.UserTenant) error {
	return f.addUserToTenant(ut)
}
func (f *fakeStore) GetUserTenants(_ context.Context, userID uuid.UUID) ([]*models.Tenant, error) {
	return f.getUserTenants(userID)
}
func (f *fakeStore) GetSubscriptionByTenantID(_ context.Context, id uuid.UUID) (*models.Subscription, error) {
	return f.getSubscriptionByTenantID(id)
}
func (f *fakeStore) CreateSubscription(_ context.Context, sub *models.Subscription) error {
	return f.createSubscription(sub)
}
func (f *fakeStore) UpdateSubscription(_ context.Context, sub *models.Subscription) error {
	return f.updateSubscription(sub)
}
func (f *fakeStore) LogAdminAction(_ context.Context, adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}) error {
	return f.logAdminAction(adminID, action, targetType, targetID, changes)
}
func (f *fakeStore) GetUserTenantRole(_ context.Context, userID, tenantID uuid.UUID) (string, error) {
	return f.getUserTenantRole(userID, tenantID)
}
func (f *fakeStore) UpdateUserQRToken(_ context.Context, userID uuid.UUID, token string, createdAt time.Time) error {
	return f.updateUserQRToken(userID, token, createdAt)
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
