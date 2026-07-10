package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// TestCreateUser_AddsUserToTenant guards against a regression where CreateUser
// wrote a row to `users` but never called AddUserToTenant, leaving the new
// staff/manager invisible to GetUserTenantRole (used by GenerateQRToken and
// CreateStationProvisioningToken), which silently 404'd for any normally
// created staff member.
func TestCreateUser_AddsUserToTenant(t *testing.T) {
	e := echo.New()
	tenant := uuid.New()

	var addedUserTenant *models.UserTenant
	var createdUserID uuid.UUID
	fs := &fakeStore{
		createUser: func(u *models.User) error {
			u.ID = uuid.New()
			createdUserID = u.ID
			return nil
		},
		addUserToTenant: func(ut *models.UserTenant) error {
			addedUserTenant = ut
			return nil
		},
		logUsage: func(log *models.UsageLog) error { return nil },
	}
	h := &Handler{Store: fs}

	c, rec := newAuthedContext(e, http.MethodPost, "/api/users",
		`{"email":"staff@example.com","password":"secret123","role":"staff"}`,
		tenant.String(), "admin")

	if err := h.CreateUser(c); err != nil {
		t.Fatalf("CreateUser returned error: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body: %s", rec.Code, rec.Body.String())
	}

	if addedUserTenant == nil {
		t.Fatal("CreateUser did not call AddUserToTenant")
	}
	if addedUserTenant.UserID != createdUserID {
		t.Errorf("AddUserToTenant UserID = %v, want %v (must match the user CreateUser just created)", addedUserTenant.UserID, createdUserID)
	}
	if addedUserTenant.TenantID != tenant {
		t.Errorf("AddUserToTenant TenantID = %v, want %v", addedUserTenant.TenantID, tenant)
	}
	if addedUserTenant.Role != "staff" {
		t.Errorf("AddUserToTenant Role = %q, want %q (must match request role, not hardcoded admin)", addedUserTenant.Role, "staff")
	}
}
