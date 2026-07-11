package bootstrap

import (
	"context"
	"errors"
	"testing"

	"idento/backend/internal/config"
	"idento/backend/internal/models"
	"idento/backend/internal/store"
)

// fakeStore embeds store.Store so only the methods a test needs are
// overridden; any un-set method panics if called (surfaces an unexpected
// dependency), matching the pattern in internal/handler/testsupport_test.go.
type fakeStore struct {
	store.Store
	hasAnyUsers          func(ctx context.Context) (bool, error)
	provisionTenantAdmin func(tenantName, email, password string) (*models.Tenant, *models.User, error)
}

func (f *fakeStore) HasAnyUsers(ctx context.Context) (bool, error) {
	return f.hasAnyUsers(ctx)
}

func (f *fakeStore) ProvisionTenantWithAdmin(_ context.Context, tenantName, email, password string) (*models.Tenant, *models.User, error) {
	return f.provisionTenantAdmin(tenantName, email, password)
}

func TestOnPremAdminProvisionsOnEmptyDatabase(t *testing.T) {
	var gotName, gotEmail, gotPassword string
	s := &fakeStore{
		hasAnyUsers: func(context.Context) (bool, error) { return false, nil },
		provisionTenantAdmin: func(tenantName, email, password string) (*models.Tenant, *models.User, error) {
			gotName, gotEmail, gotPassword = tenantName, email, password
			return &models.Tenant{Name: tenantName}, &models.User{Email: email}, nil
		},
	}
	cfg := &config.Config{AdminEmail: "admin@example.com", AdminPassword: "s3cret!", AdminOrgName: "Acme Events"}

	if err := OnPremAdmin(context.Background(), s, cfg); err != nil {
		t.Fatalf("OnPremAdmin: %v", err)
	}
	if gotName != "Acme Events" {
		t.Errorf("tenant name = %q, want %q", gotName, "Acme Events")
	}
	if gotEmail != "admin@example.com" {
		t.Errorf("email = %q, want %q", gotEmail, "admin@example.com")
	}
	if gotPassword != "s3cret!" {
		t.Errorf("password = %q, want %q", gotPassword, "s3cret!")
	}
}

func TestOnPremAdminDefaultsOrgNameWhenUnset(t *testing.T) {
	var gotName string
	s := &fakeStore{
		hasAnyUsers: func(context.Context) (bool, error) { return false, nil },
		provisionTenantAdmin: func(tenantName, email, password string) (*models.Tenant, *models.User, error) {
			gotName = tenantName
			return &models.Tenant{Name: tenantName}, &models.User{Email: email}, nil
		},
	}
	cfg := &config.Config{AdminEmail: "admin@example.com", AdminPassword: "s3cret!", AdminOrgName: ""}

	if err := OnPremAdmin(context.Background(), s, cfg); err != nil {
		t.Fatalf("OnPremAdmin: %v", err)
	}
	if gotName != "My Organization" {
		t.Errorf("tenant name = %q, want default %q", gotName, "My Organization")
	}
}

func TestOnPremAdminNormalizesEmailCaseAndWhitespace(t *testing.T) {
	var gotEmail string
	s := &fakeStore{
		hasAnyUsers: func(context.Context) (bool, error) { return false, nil },
		provisionTenantAdmin: func(tenantName, email, password string) (*models.Tenant, *models.User, error) {
			gotEmail = email
			return &models.Tenant{Name: tenantName}, &models.User{Email: email}, nil
		},
	}
	cfg := &config.Config{AdminEmail: "  Admin@Example.com  ", AdminPassword: "s3cret!"}

	if err := OnPremAdmin(context.Background(), s, cfg); err != nil {
		t.Fatalf("OnPremAdmin: %v", err)
	}
	if gotEmail != "admin@example.com" {
		t.Errorf("email = %q, want normalized %q", gotEmail, "admin@example.com")
	}
}

func TestOnPremAdminErrorsWhenAdminEmailMissing(t *testing.T) {
	s := &fakeStore{
		hasAnyUsers: func(context.Context) (bool, error) { return false, nil },
		provisionTenantAdmin: func(string, string, string) (*models.Tenant, *models.User, error) {
			t.Fatal("ProvisionTenantWithAdmin must not be called when admin email is missing")
			return nil, nil, nil
		},
	}
	cfg := &config.Config{AdminEmail: "", AdminPassword: "s3cret!"}

	if err := OnPremAdmin(context.Background(), s, cfg); err == nil {
		t.Fatal("OnPremAdmin() error = nil, want non-nil when IDENTO_ADMIN_EMAIL is unset")
	}
}

func TestOnPremAdminErrorsWhenAdminPasswordMissing(t *testing.T) {
	s := &fakeStore{
		hasAnyUsers: func(context.Context) (bool, error) { return false, nil },
		provisionTenantAdmin: func(string, string, string) (*models.Tenant, *models.User, error) {
			t.Fatal("ProvisionTenantWithAdmin must not be called when admin password is missing")
			return nil, nil, nil
		},
	}
	cfg := &config.Config{AdminEmail: "admin@example.com", AdminPassword: ""}

	if err := OnPremAdmin(context.Background(), s, cfg); err == nil {
		t.Fatal("OnPremAdmin() error = nil, want non-nil when IDENTO_ADMIN_PASSWORD is unset")
	}
}

func TestOnPremAdminNoOpsWhenAUserAlreadyExists(t *testing.T) {
	s := &fakeStore{
		hasAnyUsers: func(context.Context) (bool, error) { return true, nil },
		provisionTenantAdmin: func(string, string, string) (*models.Tenant, *models.User, error) {
			t.Fatal("ProvisionTenantWithAdmin must not be called when a user already exists")
			return nil, nil, nil
		},
	}
	cfg := &config.Config{AdminEmail: "admin@example.com", AdminPassword: "s3cret!"}

	if err := OnPremAdmin(context.Background(), s, cfg); err != nil {
		t.Fatalf("OnPremAdmin() error = %v, want nil (idempotent no-op)", err)
	}
}

func TestOnPremAdminPropagatesHasAnyUsersError(t *testing.T) {
	wantErr := errors.New("connection reset")
	s := &fakeStore{
		hasAnyUsers: func(context.Context) (bool, error) { return false, wantErr },
	}
	cfg := &config.Config{AdminEmail: "admin@example.com", AdminPassword: "s3cret!"}

	if err := OnPremAdmin(context.Background(), s, cfg); err == nil {
		t.Fatal("OnPremAdmin() error = nil, want non-nil when HasAnyUsers fails")
	}
}

func TestOnPremAdminPropagatesProvisionError(t *testing.T) {
	wantErr := errors.New("unique constraint violation")
	s := &fakeStore{
		hasAnyUsers: func(context.Context) (bool, error) { return false, nil },
		provisionTenantAdmin: func(string, string, string) (*models.Tenant, *models.User, error) {
			return nil, nil, wantErr
		},
	}
	cfg := &config.Config{AdminEmail: "admin@example.com", AdminPassword: "s3cret!"}

	if err := OnPremAdmin(context.Background(), s, cfg); err == nil {
		t.Fatal("OnPremAdmin() error = nil, want non-nil when ProvisionTenantWithAdmin fails")
	}
}
