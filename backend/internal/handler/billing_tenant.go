// Package handler — tenant-facing billing self-service endpoints
// (spec 2026-08-25-billing-invoices-design.md): billing profile (buyer
// requisites), the public catalog, and bank-transfer invoice requests.
// SaaS-only surface, admin-role-only inside every handler.
package handler

import (
	"context"
	"math"
	"net/http"
	"regexp"
	"strings"

	"idento/backend/internal/billing"
	"idento/backend/internal/config"
	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// billingINNRe matches a Russian INN: 10 digits (organizations) or 12
// digits (individual entrepreneurs).
var billingINNRe = regexp.MustCompile(`^\d{10}$|^\d{12}$`)

// billingKPPRe matches a Russian KPP: always 9 digits.
var billingKPPRe = regexp.MustCompile(`^\d{9}$`)

// requireTenantAdminForBilling is the shared guard every billing handler
// starts with: billing is a tenant self-service surface restricted to the
// "admin" role (managers/staff are rejected, matching the brief's exact
// error string). Returns the caller's tenant ID on success.
func requireTenantAdminForBilling(c echo.Context) (uuid.UUID, error) {
	claims, err := claimsFromContext(c)
	if err != nil {
		return uuid.Nil, err
	}
	if claims.Role != "admin" {
		return uuid.Nil, newHTTPError(http.StatusForbidden, "Billing requires the admin role")
	}
	tenantID, err := uuid.Parse(claims.TenantID)
	if err != nil {
		return uuid.Nil, newHTTPError(http.StatusUnauthorized, "Invalid token")
	}
	return tenantID, nil
}

// GetBillingProfile returns the tenant's billing (buyer) profile.
func (h *Handler) GetBillingProfile(c echo.Context) error {
	tenantID, err := requireTenantAdminForBilling(c)
	if err != nil {
		return writeErr(c, err)
	}
	profile, err := h.Store.GetTenantBillingProfile(c.Request().Context(), tenantID)
	if err != nil {
		return writeErr(c, err)
	}
	if profile == nil {
		return writeErr(c, newHTTPError(http.StatusNotFound, "Billing profile is not set"))
	}
	return c.JSON(http.StatusOK, profile)
}

// billingProfileRequest is the PUT /billing/profile request body.
type billingProfileRequest struct {
	LegalName    string  `json:"legal_name"`
	INN          string  `json:"inn"`
	KPP          *string `json:"kpp"`
	LegalAddress string  `json:"legal_address"`
}

// PutBillingProfile creates or replaces the tenant's billing profile.
func (h *Handler) PutBillingProfile(c echo.Context) error {
	tenantID, err := requireTenantAdminForBilling(c)
	if err != nil {
		return writeErr(c, err)
	}

	var req billingProfileRequest
	if err := c.Bind(&req); err != nil {
		return writeErr(c, newHTTPError(http.StatusBadRequest, "Invalid request body"))
	}

	legalName := strings.TrimSpace(req.LegalName)
	if legalName == "" {
		return writeErr(c, newHTTPError(http.StatusBadRequest, "legal_name is required"))
	}
	legalAddress := strings.TrimSpace(req.LegalAddress)
	if legalAddress == "" {
		return writeErr(c, newHTTPError(http.StatusBadRequest, "legal_address is required"))
	}
	if !billingINNRe.MatchString(req.INN) {
		return writeErr(c, newHTTPError(http.StatusBadRequest, "inn must be 10 or 12 digits"))
	}
	var kpp *string
	if req.KPP != nil {
		if trimmed := strings.TrimSpace(*req.KPP); trimmed != "" {
			if !billingKPPRe.MatchString(trimmed) {
				return writeErr(c, newHTTPError(http.StatusBadRequest, "kpp must be 9 digits"))
			}
			kpp = &trimmed
		}
	}

	profile := &models.TenantBillingProfile{
		TenantID:     tenantID,
		LegalName:    legalName,
		INN:          req.INN,
		KPP:          kpp,
		LegalAddress: legalAddress,
	}
	if err := h.Store.UpsertTenantBillingProfile(c.Request().Context(), profile); err != nil {
		return writeErr(c, err)
	}
	return c.JSON(http.StatusOK, profile)
}

// GetBillingCatalog returns the public, active catalog items tenants can
// request invoices for.
func (h *Handler) GetBillingCatalog(c echo.Context) error {
	if _, err := requireTenantAdminForBilling(c); err != nil {
		return writeErr(c, err)
	}
	items, err := h.Store.GetCatalogItems(c.Request().Context(), true)
	if err != nil {
		return writeErr(c, err)
	}
	return c.JSON(http.StatusOK, items)
}

// invoiceLineInput is one line of a create-invoice request; shared by the
// tenant self-service flow (CreateTenantInvoice, below) and the operator
// flow (CreateInvoiceSuper, billing_super.go).
type invoiceLineInput struct {
	CatalogItemID uuid.UUID `json:"catalog_item_id"`
	Quantity      int       `json:"quantity"`
}

// createTenantInvoiceRequest is the POST /billing/invoices request body.
type createTenantInvoiceRequest struct {
	Lines   []invoiceLineInput `json:"lines"`
	Comment *string            `json:"comment"`
}

// buildInvoiceLines resolves invoice line inputs against the catalog into
// invoice line snapshots plus the invoice total, rounding each line to
// kopecks and again after summing (spec rounding rule). requirePublic
// additionally requires IsPublic — the tenant self-service catalog
// (CreateTenantInvoice) only offers public items; the operator flow
// (CreateInvoiceSuper) only requires IsActive, since operators can invoice
// against any active catalog item regardless of public visibility. Returns
// an *httpError (400, "Unknown or unavailable catalog item") when a line's
// item doesn't qualify, or the store's raw error on a lookup failure.
func buildInvoiceLines(ctx context.Context, s store.Store, inputs []invoiceLineInput, requirePublic bool) ([]*models.InvoiceLine, float64, error) {
	lines := make([]*models.InvoiceLine, 0, len(inputs))
	var total float64
	for i, l := range inputs {
		item, err := s.GetCatalogItemByID(ctx, l.CatalogItemID)
		if err != nil {
			return nil, 0, err
		}
		if item == nil || !item.IsActive || (requirePublic && !item.IsPublic) {
			return nil, 0, newHTTPError(http.StatusBadRequest, "Unknown or unavailable catalog item")
		}

		amount := math.Round(item.Price*float64(l.Quantity)*100) / 100
		total += amount

		catalogItemID := item.ID
		lines = append(lines, &models.InvoiceLine{
			Position:      i + 1,
			CatalogItemID: &catalogItemID,
			Kind:          item.Kind,
			Name:          item.Name,
			Price:         item.Price,
			VATRate:       item.VATRate,
			PlanID:        item.PlanID,
			Period:        item.Period,
			Activation:    item.DefaultActivation,
			LimitKey:      item.LimitKey,
			LimitDelta:    item.LimitDelta,
			Validity:      item.Validity,
			ValidityDays:  item.ValidityDays,
			Quantity:      l.Quantity,
			Amount:        amount,
		})
	}
	total = math.Round(total*100) / 100
	return lines, total, nil
}

// CreateTenantInvoice requests a bank-transfer invoice for one or more
// catalog items. Guards run in the order the brief specifies: request
// shape, seller configuration, billing profile presence, then each line's
// catalog item.
func (h *Handler) CreateTenantInvoice(c echo.Context) error {
	tenantID, err := requireTenantAdminForBilling(c)
	if err != nil {
		return writeErr(c, err)
	}
	claims, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}

	var req createTenantInvoiceRequest
	if err := c.Bind(&req); err != nil {
		return writeErr(c, newHTTPError(http.StatusBadRequest, "Invalid request body"))
	}
	if len(req.Lines) == 0 {
		return writeErr(c, newHTTPError(http.StatusBadRequest, "At least one line is required"))
	}
	for _, l := range req.Lines {
		if l.Quantity < 1 || l.Quantity > 100 {
			return writeErr(c, newHTTPError(http.StatusBadRequest, "quantity must be between 1 and 100"))
		}
	}

	seller := config.Seller()
	if !seller.Configured {
		return writeErr(c, newHTTPError(http.StatusConflict, "Seller requisites are not configured"))
	}

	ctx := c.Request().Context()
	profile, err := h.Store.GetTenantBillingProfile(ctx, tenantID)
	if err != nil {
		return writeErr(c, err)
	}
	if profile == nil {
		return writeErr(c, newHTTPError(http.StatusConflict, "Billing profile is required before requesting an invoice"))
	}

	lines, total, err := buildInvoiceLines(ctx, h.Store, req.Lines, true)
	if err != nil {
		return writeErr(c, err)
	}

	createdBy, err := uuid.Parse(claims.UserID)
	if err != nil {
		return writeErr(c, newHTTPError(http.StatusUnauthorized, "Invalid token"))
	}

	inv := &models.Invoice{
		TenantID:              tenantID,
		BuyerName:             profile.LegalName,
		BuyerINN:              profile.INN,
		BuyerKPP:              profile.KPP,
		BuyerAddress:          profile.LegalAddress,
		SellerName:            seller.Name,
		SellerINN:             seller.INN,
		SellerBankName:        seller.BankName,
		SellerBankAccount:     seller.BankAccount,
		SellerBankBIK:         seller.BankBIK,
		SellerBankCorrAccount: nilIfEmpty(seller.BankCorrAccount),
		Total:                 total,
		Comment:               req.Comment,
		CreatedBy:             &createdBy,
	}

	if err := h.Store.CreateInvoice(ctx, inv, lines); err != nil {
		return writeErr(c, err)
	}
	inv.Lines = lines
	inv.TotalInWords = billing.AmountInWords(inv.Total)
	return c.JSON(http.StatusCreated, inv)
}

// nilIfEmpty returns nil for an empty string, else a pointer to s — used
// for SellerBankCorrAccount, which is optional (not every bank
// relationship uses a correspondent account).
func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// GetTenantInvoices lists the caller's tenant's invoices.
func (h *Handler) GetTenantInvoices(c echo.Context) error {
	tenantID, err := requireTenantAdminForBilling(c)
	if err != nil {
		return writeErr(c, err)
	}
	invoices, err := h.Store.ListInvoices(c.Request().Context(), store.InvoiceFilter{TenantID: &tenantID})
	if err != nil {
		return writeErr(c, err)
	}
	return c.JSON(http.StatusOK, invoices)
}

// GetTenantInvoice returns a single invoice scoped to the caller's tenant.
// Missing and foreign invoices are both 404 — no existence oracle.
func (h *Handler) GetTenantInvoice(c echo.Context) error {
	tenantID, err := requireTenantAdminForBilling(c)
	if err != nil {
		return writeErr(c, err)
	}
	invoiceID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return writeErr(c, newHTTPError(http.StatusNotFound, "Invoice not found"))
	}
	inv, err := h.Store.GetInvoiceByID(c.Request().Context(), invoiceID)
	if err != nil {
		return writeErr(c, err)
	}
	if inv == nil || inv.TenantID != tenantID {
		return writeErr(c, newHTTPError(http.StatusNotFound, "Invoice not found"))
	}
	inv.TotalInWords = billing.AmountInWords(inv.Total)
	return c.JSON(http.StatusOK, inv)
}
