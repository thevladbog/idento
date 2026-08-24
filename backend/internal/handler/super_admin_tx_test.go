package handler

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// These tests pin the Batch-3-era deferred fix: every super-admin mutation
// handler used to run its read → update → LogAdminAction sequence as three
// independent statements, and a failed audit write was merely log.Printf'd —
// a mutation could land with NO audit row. Now the whole sequence runs
// inside Store.WithTx: the mutation and its audit row commit together or
// not at all, and an audit failure fails the request.
//
// The seam proof works with two fakes: the OUTER store only provides
// WithTx, which hands the handler a SEPARATE tx-scoped store. Any read or
// mutation the handler still performs on the outer store is recorded and
// failed — proving the whole sequence goes through the transaction.

type txSeam struct {
	outer     *fakeStore
	tx        *fakeStore
	outerUsed []string
	calls     []string
}

func newTxSeam(t *testing.T) *txSeam {
	t.Helper()
	s := &txSeam{outer: &fakeStore{}, tx: &fakeStore{}}
	s.outer.withTx = func(fn func(store.Store) error) error { return fn(s.tx) }
	return s
}

func (s *txSeam) record(name string) func() {
	return func() { s.calls = append(s.calls, name) }
}

func superCtx(e *echo.Echo, method, path, body, param string) (echo.Context, *httptest.ResponseRecorder) {
	tenantID := uuid.New().String()
	c, rec := newAuthedContext(e, method, path, body, tenantID, "admin")
	if param != "" {
		c.SetParamNames("id")
		c.SetParamValues(param)
	}
	return c, rec
}

func TestSuperAdminMutationsRunMutationAndAuditInOneTransaction(t *testing.T) {
	subID := uuid.New()
	planID := uuid.New()

	cases := []struct {
		name string
		// wire seam.tx (and outer read markers), return the handler call.
		setup  func(s *txSeam, h *Handler, e *echo.Echo) (echo.Context, *httptest.ResponseRecorder)
		okCode int
		// call names expected on the tx store, in order.
		wantCalls []string
	}{
		{
			name: "UpdateTenantSubscription",
			setup: func(s *txSeam, h *Handler, e *echo.Echo) (echo.Context, *httptest.ResponseRecorder) {
				s.outer.getSubscriptionByTenantID = func(uuid.UUID) (*models.Subscription, error) {
					s.outerUsed = append(s.outerUsed, "getSubscriptionByTenantID")
					return &models.Subscription{ID: subID, Status: "active", StartDate: time.Now()}, nil
				}
				s.tx.getSubscriptionByTenantID = func(uuid.UUID) (*models.Subscription, error) {
					s.record("read")()
					return &models.Subscription{ID: subID, Status: "active", StartDate: time.Now()}, nil
				}
				s.tx.updateSubscription = func(*models.Subscription) error { s.record("mutate")(); return nil }
				id := uuid.New().String()
				return superCtx(e, http.MethodPut, "/api/super-admin/tenants/"+id+"/subscription",
					`{"status":"suspended","reason":"test"}`, id)
			},
			okCode:    http.StatusOK,
			wantCalls: []string{"read", "mutate", "audit"},
		},
		{
			name: "CreateSubscriptionPlan",
			setup: func(s *txSeam, h *Handler, e *echo.Echo) (echo.Context, *httptest.ResponseRecorder) {
				s.tx.createSubscriptionPlan = func(*models.SubscriptionPlan) error { s.record("mutate")(); return nil }
				return superCtx(e, http.MethodPost, "/api/super-admin/plans", `{"name":"Pro"}`, "")
			},
			okCode:    http.StatusCreated,
			wantCalls: []string{"mutate", "audit"},
		},
		{
			name: "UpdateSubscriptionPlanSuper",
			setup: func(s *txSeam, h *Handler, e *echo.Echo) (echo.Context, *httptest.ResponseRecorder) {
				s.outer.getSubscriptionPlanByID = func(uuid.UUID) (*models.SubscriptionPlan, error) {
					s.outerUsed = append(s.outerUsed, "getSubscriptionPlanByID")
					return &models.SubscriptionPlan{ID: planID, Name: "Old"}, nil
				}
				s.tx.getSubscriptionPlanByID = func(uuid.UUID) (*models.SubscriptionPlan, error) {
					s.record("read")()
					return &models.SubscriptionPlan{ID: planID, Name: "Old"}, nil
				}
				s.tx.updateSubscriptionPlan = func(*models.SubscriptionPlan) error { s.record("mutate")(); return nil }
				return superCtx(e, http.MethodPut, "/api/super-admin/plans/"+planID.String(),
					`{"name":"New"}`, planID.String())
			},
			okCode:    http.StatusOK,
			wantCalls: []string{"read", "mutate", "audit"},
		},
		{
			name: "CreateTenantSuper",
			setup: func(s *txSeam, h *Handler, e *echo.Echo) (echo.Context, *httptest.ResponseRecorder) {
				s.tx.createTenantWithDefaultSubscription = func(tenant *models.Tenant) error {
					tenant.ID = uuid.New()
					s.record("mutate")()
					return nil
				}
				return superCtx(e, http.MethodPost, "/api/super-admin/tenants", `{"name":"Acme"}`, "")
			},
			okCode:    http.StatusCreated,
			wantCalls: []string{"mutate", "audit"},
		},
		{
			name: "SuspendTenant",
			setup: func(s *txSeam, h *Handler, e *echo.Echo) (echo.Context, *httptest.ResponseRecorder) {
				s.outer.getTenantStatus = func(uuid.UUID) (string, error) {
					s.outerUsed = append(s.outerUsed, "getTenantStatus")
					return "active", nil
				}
				s.tx.getTenantStatus = func(uuid.UUID) (string, error) { s.record("read")(); return "active", nil }
				s.tx.updateTenantStatus = func(uuid.UUID, string) error { s.record("mutate")(); return nil }
				id := uuid.New().String()
				return superCtx(e, http.MethodPost, "/api/super-admin/tenants/"+id+"/suspend",
					`{"reason":"test"}`, id)
			},
			okCode:    http.StatusOK,
			wantCalls: []string{"read", "mutate", "audit"},
		},
	}

	handlers := map[string]func(h *Handler, c echo.Context) error{
		"UpdateTenantSubscription":    func(h *Handler, c echo.Context) error { return h.UpdateTenantSubscription(c) },
		"CreateSubscriptionPlan":      func(h *Handler, c echo.Context) error { return h.CreateSubscriptionPlan(c) },
		"UpdateSubscriptionPlanSuper": func(h *Handler, c echo.Context) error { return h.UpdateSubscriptionPlanSuper(c) },
		"CreateTenantSuper":           func(h *Handler, c echo.Context) error { return h.CreateTenantSuper(c) },
		"SuspendTenant":               func(h *Handler, c echo.Context) error { return h.SuspendTenant(c) },
	}

	for _, tc := range cases {
		t.Run(tc.name+" -- mutation and audit both run on the tx store, in order", func(t *testing.T) {
			seam := newTxSeam(t)
			seam.tx.logAdminAction = func(uuid.UUID, string, string, uuid.UUID, interface{}, string, string) error {
				seam.record("audit")()
				return nil
			}
			// Any audit on the OUTER store is the exact bug this fix removes.
			seam.outer.logAdminAction = func(uuid.UUID, string, string, uuid.UUID, interface{}, string, string) error {
				seam.outerUsed = append(seam.outerUsed, "logAdminAction")
				return nil
			}
			h := New(seam.outer)
			e := echo.New()
			c, rec := tc.setup(seam, h, e)
			if err := handlers[tc.name](h, c); err != nil {
				t.Fatalf("%s: %v", tc.name, err)
			}
			if rec.Code != tc.okCode {
				t.Fatalf("status = %d, want %d (body: %s)", rec.Code, tc.okCode, rec.Body.String())
			}
			if len(seam.outerUsed) != 0 {
				t.Fatalf("handler bypassed the transaction for: %v", seam.outerUsed)
			}
			if len(seam.calls) != len(tc.wantCalls) {
				t.Fatalf("tx calls = %v, want %v", seam.calls, tc.wantCalls)
			}
			for i, want := range tc.wantCalls {
				if seam.calls[i] != want {
					t.Fatalf("tx call order = %v, want %v", seam.calls, tc.wantCalls)
				}
			}
		})

		t.Run(tc.name+" -- a failed audit write fails the whole request", func(t *testing.T) {
			seam := newTxSeam(t)
			seam.tx.logAdminAction = func(uuid.UUID, string, string, uuid.UUID, interface{}, string, string) error {
				return errors.New("audit insert failed")
			}
			seam.outer.logAdminAction = func(uuid.UUID, string, string, uuid.UUID, interface{}, string, string) error {
				seam.outerUsed = append(seam.outerUsed, "logAdminAction")
				return nil
			}
			h := New(seam.outer)
			e := echo.New()
			c, rec := tc.setup(seam, h, e)
			if err := handlers[tc.name](h, c); err != nil {
				t.Fatalf("%s: %v", tc.name, err)
			}
			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want %d -- an unaudited admin mutation must not report success", rec.Code, http.StatusInternalServerError)
			}
		})
	}
}

// ImpersonateTenant performs no DB mutation, but an impersonation token
// minted WITHOUT its audit row is a real accountability hole -- the audit
// write failing must fail the request before the token is returned.
func TestImpersonateTenantFailsClosedWhenAuditWriteFails(t *testing.T) {
	f := &fakeStore{
		getTenantStatus: func(uuid.UUID) (string, error) { return "active", nil },
		logAdminAction: func(uuid.UUID, string, string, uuid.UUID, interface{}, string, string) error {
			return errors.New("audit insert failed")
		},
	}
	h := New(f)
	e := echo.New()
	id := uuid.New().String()
	c, rec := superCtx(e, http.MethodPost, "/api/super-admin/tenants/"+id+"/impersonate", `{"reason":"support"}`, id)
	t.Setenv("JWT_SECRET", "test-secret")
	if err := h.ImpersonateTenant(c); err != nil {
		t.Fatalf("ImpersonateTenant: %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	if body := rec.Body.String(); strings.Contains(body, "expires_at") {
		t.Fatalf("response leaked an unaudited impersonation token: %s", body)
	}
}
