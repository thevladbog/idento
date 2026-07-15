package handler

import (
	"context"
	"encoding/json"
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
	createEventZone           func(zone *models.EventZone) error
	getEventZones             func(eventID uuid.UUID) ([]*models.EventZone, error)
	getEventZonesWithStats    func(eventID uuid.UUID) ([]*models.EventZoneWithStats, error)
	updateEventZone           func(zone *models.EventZone) error
	deleteEventZone           func(id uuid.UUID) error
	createZoneAccessRule      func(rule *models.ZoneAccessRule) error
	getZoneAccessRules        func(zoneID uuid.UUID) ([]*models.ZoneAccessRule, error)
	bulkUpdateZoneAccessRules func(zoneID uuid.UUID, rules []*models.ZoneAccessRule) error
	getAttendeeByID           func(id uuid.UUID) (*models.Attendee, error)
	getFontByID               func(id uuid.UUID) (*models.Font, error)
	getFontsByEventID         func(eventID uuid.UUID) ([]*models.FontListItem, error)
	createFont                func(font *models.Font) error
	deleteFont                func(id uuid.UUID) error
	createAPIKey              func(apiKey *models.APIKey) error
	getUserByID               func(id uuid.UUID) (*models.User, error)
	getUsersByTenantID        func(tenantID uuid.UUID) ([]*models.User, error)
	getZoneStaffAssign        func(zoneID uuid.UUID) ([]*models.StaffZoneAssignment, error)
	checkZoneAccessAt         func(attendeeID, zoneID uuid.UUID, at time.Time) (bool, string, error)
	createZoneScanLog         func(zoneID uuid.UUID, attendeeID *uuid.UUID, verdict string) error
	checkAttendeeZoneCheckin  func(attendeeID, zoneID uuid.UUID, date time.Time) (*models.ZoneCheckin, error)
	createZoneCheckin         func(checkin *models.ZoneCheckin) error
	getAttendeeByCode         func(eventID uuid.UUID, code string) (*models.Attendee, error)
	getAttendeeZoneAccessByID func(id uuid.UUID) (*models.AttendeeZoneAccess, error)
	createAttendeeZoneAccess  func(access *models.AttendeeZoneAccess) error
	getAttendeeZoneAccessList func(attendeeID uuid.UUID) ([]*models.AttendeeZoneAccess, error)
	updateAttendeeZoneAccess  func(access *models.AttendeeZoneAccess) error
	deleteAttendeeZoneAccess  func(id uuid.UUID) error
	assignStaffToZone         func(assignment *models.StaffZoneAssignment) error
	removeStaffFromZone       func(userID, zoneID uuid.UUID) error
	checkZoneAccess           func(attendeeID, zoneID uuid.UUID) (bool, string, error)
	getZoneCheckins           func(zoneID uuid.UUID, date time.Time) ([]*models.ZoneCheckin, error)
	getStaffZoneAssignments   func(userID uuid.UUID) ([]*models.StaffZoneAssignment, error)
	getAPIKeysByEventID       func(eventID uuid.UUID) ([]*models.APIKey, error)
	revokeAPIKey              func(id uuid.UUID) error
	createAttendee            func(attendee *models.Attendee) error
	updateAttendee            func(attendee *models.Attendee) error
	getAttendeesByEventID     func(eventID uuid.UUID, code, search string) ([]*models.Attendee, error)
	countAttendeesByEventID   func(eventID uuid.UUID) (int, error)
	getAttendeesPage          func(eventID uuid.UUID, f store.AttendeeFilter) ([]*models.Attendee, int, error)
	getAttendeeZoneCheckins   func(attendeeID uuid.UUID) ([]*models.ZoneCheckin, error)

	createTenantWithDefaultSubscription func(tenant *models.Tenant) error
	provisionTenantWithAdmin            func(tenantName, email, password string) (*models.Tenant, *models.User, error)
	getTenantByID                       func(id uuid.UUID) (*models.Tenant, error)
	updateTenant                        func(tenant *models.Tenant) error
	getTenantStatus                     func(id uuid.UUID) (string, error)
	updateTenantStatus                  func(id uuid.UUID, status string) error
	getUserByEmail                      func(email string) (*models.User, error)
	getUserByQRToken                    func(token string) (*models.User, error)
	createUser                          func(u *models.User) error
	addUserToTenant                     func(ut *models.UserTenant) error
	getUserTenants                      func(userID uuid.UUID) ([]*models.Tenant, error)

	getSubscriptionByTenantID func(id uuid.UUID) (*models.Subscription, error)
	upsertSubscription        func(sub *models.Subscription) error
	updateSubscription        func(sub *models.Subscription) error
	getSubscriptionPlanByID   func(id uuid.UUID) (*models.SubscriptionPlan, error)
	updateSubscriptionPlan    func(plan *models.SubscriptionPlan) error
	logAdminAction            func(adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error
	getAuditLog               func(filters map[string]interface{}, limit, offset int) ([]*models.AdminAuditLog, int, error)

	getUserTenantRole func(userID, tenantID uuid.UUID) (string, error)
	updateUserQRToken func(userID uuid.UUID, token string, createdAt time.Time) error
	logUsage          func(log *models.UsageLog) error

	createProvisioningToken  func(tok *models.StationProvisioningToken) error
	consumeProvisioningToken func(token string) (*models.StationProvisioningToken, error)
	createStation            func(eventID, staffUserID uuid.UUID, deviceInfo map[string]interface{}) (*models.Station, error)

	getEventsByTenantID func(tenantID uuid.UUID) ([]*models.Event, error)
	createEvent         func(event *models.Event) error
	updateEvent         func(event *models.Event) error
	softDeleteEvent     func(id uuid.UUID) error
	getEventStaff       func(eventID uuid.UUID) ([]*models.User, error)
	assignStaffToEvent  func(assignment *models.EventStaff) error

	applyBatchCheckin     func(eventID, staffUserID uuid.UUID, item *models.BatchCheckinItem) (store.BatchCheckinOutcome, error)
	createCheckinOverride func(o *models.CheckinOverride) error
	getEventStats         func(eventID uuid.UUID, zoneID *uuid.UUID) (*models.EventStatsResponse, error)

	checkAttendeeLimit func(tenantID, eventID uuid.UUID, adding int) (bool, int, int, error)
	checkTenantLimit   func(tenantID uuid.UUID, resourceType string) (bool, int, int, error)

	getPlatformAnalytics func() (*models.PlatformAnalytics, error)
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
func (f *fakeStore) CreateEventZone(_ context.Context, zone *models.EventZone) error {
	return f.createEventZone(zone)
}
func (f *fakeStore) GetEventZones(_ context.Context, eventID uuid.UUID) ([]*models.EventZone, error) {
	return f.getEventZones(eventID)
}
func (f *fakeStore) GetEventZonesWithStats(_ context.Context, eventID uuid.UUID) ([]*models.EventZoneWithStats, error) {
	return f.getEventZonesWithStats(eventID)
}
func (f *fakeStore) UpdateEventZone(_ context.Context, zone *models.EventZone) error {
	return f.updateEventZone(zone)
}
func (f *fakeStore) DeleteEventZone(_ context.Context, id uuid.UUID) error {
	return f.deleteEventZone(id)
}
func (f *fakeStore) CreateZoneAccessRule(_ context.Context, rule *models.ZoneAccessRule) error {
	return f.createZoneAccessRule(rule)
}
func (f *fakeStore) GetZoneAccessRules(_ context.Context, zoneID uuid.UUID) ([]*models.ZoneAccessRule, error) {
	return f.getZoneAccessRules(zoneID)
}
func (f *fakeStore) BulkUpdateZoneAccessRules(_ context.Context, zoneID uuid.UUID, rules []*models.ZoneAccessRule) error {
	return f.bulkUpdateZoneAccessRules(zoneID, rules)
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
func (f *fakeStore) GetFontsByEventID(_ context.Context, eventID uuid.UUID) ([]*models.FontListItem, error) {
	return f.getFontsByEventID(eventID)
}
func (f *fakeStore) CreateFont(_ context.Context, font *models.Font) error {
	return f.createFont(font)
}
func (f *fakeStore) DeleteFont(_ context.Context, id uuid.UUID) error {
	return f.deleteFont(id)
}
func (f *fakeStore) CreateAPIKey(_ context.Context, apiKey *models.APIKey) error {
	return f.createAPIKey(apiKey)
}
func (f *fakeStore) GetUsersByTenantID(_ context.Context, tenantID uuid.UUID) ([]*models.User, error) {
	return f.getUsersByTenantID(tenantID)
}
func (f *fakeStore) GetZoneStaffAssignments(_ context.Context, zoneID uuid.UUID) ([]*models.StaffZoneAssignment, error) {
	return f.getZoneStaffAssign(zoneID)
}
func (f *fakeStore) CheckZoneAccessAt(_ context.Context, attendeeID, zoneID uuid.UUID, at time.Time) (bool, string, error) {
	return f.checkZoneAccessAt(attendeeID, zoneID, at)
}
func (f *fakeStore) CreateZoneScanLog(_ context.Context, zoneID uuid.UUID, attendeeID *uuid.UUID, verdict string) error {
	return f.createZoneScanLog(zoneID, attendeeID, verdict)
}
func (f *fakeStore) CheckAttendeeZoneCheckin(_ context.Context, attendeeID, zoneID uuid.UUID, date time.Time) (*models.ZoneCheckin, error) {
	return f.checkAttendeeZoneCheckin(attendeeID, zoneID, date)
}
func (f *fakeStore) CreateZoneCheckin(_ context.Context, checkin *models.ZoneCheckin) error {
	return f.createZoneCheckin(checkin)
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
func (f *fakeStore) CreateAttendeeZoneAccess(_ context.Context, access *models.AttendeeZoneAccess) error {
	return f.createAttendeeZoneAccess(access)
}
func (f *fakeStore) GetAttendeeZoneAccessList(_ context.Context, attendeeID uuid.UUID) ([]*models.AttendeeZoneAccess, error) {
	return f.getAttendeeZoneAccessList(attendeeID)
}
func (f *fakeStore) UpdateAttendeeZoneAccess(_ context.Context, access *models.AttendeeZoneAccess) error {
	return f.updateAttendeeZoneAccess(access)
}
func (f *fakeStore) DeleteAttendeeZoneAccess(_ context.Context, id uuid.UUID) error {
	return f.deleteAttendeeZoneAccess(id)
}
func (f *fakeStore) AssignStaffToZone(_ context.Context, assignment *models.StaffZoneAssignment) error {
	return f.assignStaffToZone(assignment)
}
func (f *fakeStore) RemoveStaffFromZone(_ context.Context, userID, zoneID uuid.UUID) error {
	return f.removeStaffFromZone(userID, zoneID)
}
func (f *fakeStore) CheckZoneAccess(_ context.Context, attendeeID, zoneID uuid.UUID) (bool, string, error) {
	return f.checkZoneAccess(attendeeID, zoneID)
}
func (f *fakeStore) GetZoneCheckins(_ context.Context, zoneID uuid.UUID, date time.Time) ([]*models.ZoneCheckin, error) {
	return f.getZoneCheckins(zoneID, date)
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
func (f *fakeStore) CreateAttendee(_ context.Context, attendee *models.Attendee) error {
	return f.createAttendee(attendee)
}
func (f *fakeStore) UpdateAttendee(_ context.Context, attendee *models.Attendee) error {
	return f.updateAttendee(attendee)
}
func (f *fakeStore) GetAttendeesByEventID(_ context.Context, eventID uuid.UUID, code, search string) ([]*models.Attendee, error) {
	return f.getAttendeesByEventID(eventID, code, search)
}
func (f *fakeStore) CountAttendeesByEventID(_ context.Context, eventID uuid.UUID) (int, error) {
	return f.countAttendeesByEventID(eventID)
}
func (f *fakeStore) GetAttendeesPage(_ context.Context, eventID uuid.UUID, filter store.AttendeeFilter) ([]*models.Attendee, int, error) {
	return f.getAttendeesPage(eventID, filter)
}
func (f *fakeStore) GetAttendeeZoneCheckins(_ context.Context, attendeeID uuid.UUID) ([]*models.ZoneCheckin, error) {
	return f.getAttendeeZoneCheckins(attendeeID)
}

func (f *fakeStore) CreateTenantWithDefaultSubscription(_ context.Context, tenant *models.Tenant) error {
	return f.createTenantWithDefaultSubscription(tenant)
}
func (f *fakeStore) ProvisionTenantWithAdmin(_ context.Context, tenantName, email, password string) (*models.Tenant, *models.User, error) {
	return f.provisionTenantWithAdmin(tenantName, email, password)
}
func (f *fakeStore) GetTenantByID(_ context.Context, id uuid.UUID) (*models.Tenant, error) {
	return f.getTenantByID(id)
}
func (f *fakeStore) UpdateTenant(_ context.Context, tenant *models.Tenant) error {
	return f.updateTenant(tenant)
}
func (f *fakeStore) GetTenantStatus(_ context.Context, id uuid.UUID) (string, error) {
	return f.getTenantStatus(id)
}
func (f *fakeStore) UpdateTenantStatus(_ context.Context, id uuid.UUID, status string) error {
	return f.updateTenantStatus(id, status)
}
func (f *fakeStore) GetUserByEmail(_ context.Context, email string) (*models.User, error) {
	return f.getUserByEmail(email)
}
func (f *fakeStore) GetUserByQRToken(_ context.Context, token string) (*models.User, error) {
	return f.getUserByQRToken(token)
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
func (f *fakeStore) UpsertSubscription(_ context.Context, sub *models.Subscription) error {
	return f.upsertSubscription(sub)
}
func (f *fakeStore) UpdateSubscription(_ context.Context, sub *models.Subscription) error {
	return f.updateSubscription(sub)
}
func (f *fakeStore) GetSubscriptionPlanByID(_ context.Context, id uuid.UUID) (*models.SubscriptionPlan, error) {
	return f.getSubscriptionPlanByID(id)
}
func (f *fakeStore) UpdateSubscriptionPlan(_ context.Context, plan *models.SubscriptionPlan) error {
	return f.updateSubscriptionPlan(plan)
}
func (f *fakeStore) LogAdminAction(_ context.Context, adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error {
	return f.logAdminAction(adminID, action, targetType, targetID, changes, ip, userAgent)
}
func (f *fakeStore) GetAuditLog(_ context.Context, filters map[string]interface{}, limit int, offset int) ([]*models.AdminAuditLog, int, error) {
	return f.getAuditLog(filters, limit, offset)
}
func (f *fakeStore) GetUserTenantRole(_ context.Context, userID, tenantID uuid.UUID) (string, error) {
	return f.getUserTenantRole(userID, tenantID)
}
func (f *fakeStore) UpdateUserQRToken(_ context.Context, userID uuid.UUID, token string, createdAt time.Time) error {
	return f.updateUserQRToken(userID, token, createdAt)
}
func (f *fakeStore) LogUsage(_ context.Context, log *models.UsageLog) error {
	return f.logUsage(log)
}

func (f *fakeStore) CreateProvisioningToken(_ context.Context, tok *models.StationProvisioningToken) error {
	return f.createProvisioningToken(tok)
}
func (f *fakeStore) ConsumeProvisioningToken(_ context.Context, token string) (*models.StationProvisioningToken, error) {
	return f.consumeProvisioningToken(token)
}
func (f *fakeStore) CreateStation(_ context.Context, eventID, staffUserID uuid.UUID, deviceInfo map[string]interface{}) (*models.Station, error) {
	return f.createStation(eventID, staffUserID, deviceInfo)
}

func (f *fakeStore) GetEventsByTenantID(_ context.Context, tenantID uuid.UUID) ([]*models.Event, error) {
	return f.getEventsByTenantID(tenantID)
}
func (f *fakeStore) CreateEvent(_ context.Context, event *models.Event) error {
	return f.createEvent(event)
}
func (f *fakeStore) UpdateEvent(_ context.Context, event *models.Event) error {
	return f.updateEvent(event)
}
func (f *fakeStore) SoftDeleteEvent(_ context.Context, id uuid.UUID) error {
	return f.softDeleteEvent(id)
}
func (f *fakeStore) GetEventStaff(_ context.Context, eventID uuid.UUID) ([]*models.User, error) {
	return f.getEventStaff(eventID)
}
func (f *fakeStore) AssignStaffToEvent(_ context.Context, assignment *models.EventStaff) error {
	return f.assignStaffToEvent(assignment)
}

func (f *fakeStore) ApplyBatchCheckin(_ context.Context, eventID, staffUserID uuid.UUID, item *models.BatchCheckinItem) (store.BatchCheckinOutcome, error) {
	return f.applyBatchCheckin(eventID, staffUserID, item)
}

func (f *fakeStore) CreateCheckinOverride(_ context.Context, o *models.CheckinOverride) error {
	return f.createCheckinOverride(o)
}

func (f *fakeStore) GetEventStats(_ context.Context, eventID uuid.UUID, zoneID *uuid.UUID) (*models.EventStatsResponse, error) {
	return f.getEventStats(eventID, zoneID)
}

func (f *fakeStore) CheckAttendeeLimit(_ context.Context, tenantID, eventID uuid.UUID, adding int) (bool, int, int, error) {
	return f.checkAttendeeLimit(tenantID, eventID, adding)
}
func (f *fakeStore) CheckTenantLimit(_ context.Context, tenantID uuid.UUID, resourceType string) (bool, int, int, error) {
	return f.checkTenantLimit(tenantID, resourceType)
}
func (f *fakeStore) GetPlatformAnalytics(_ context.Context) (*models.PlatformAnalytics, error) {
	return f.getPlatformAnalytics()
}

// newAuthedContext builds an echo.Context with JWT claims already set under "user",
// mimicking what middleware.JWT does, so handlers can be tested without a token.
func newAuthedContext(e *echo.Echo, method, path, body, tenantID, role string) (echo.Context, *httptest.ResponseRecorder) {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	req.Header.Set("User-Agent", "test-agent")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("user", &models.JWTCustomClaims{
		UserID:   uuid.New().String(),
		TenantID: tenantID,
		Role:     role,
	})
	return c, rec
}

// newUnauthedContext builds a plain echo.Context with no "user" set, for
// endpoints reached before a device has a JWT (e.g. station provisioning).
func newUnauthedContext(e *echo.Echo, method, path, body string) (echo.Context, *httptest.ResponseRecorder) {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	return e.NewContext(req, rec), rec
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

// jsonUnmarshalBody decodes a recorded response body into v.
func jsonUnmarshalBody(rec *httptest.ResponseRecorder, v interface{}) error {
	return json.Unmarshal(rec.Body.Bytes(), v)
}
