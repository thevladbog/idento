// Package handler — super-admin (platform operator) billing endpoints:
// catalog CRUD, invoice issuance/listing/lookup, mark-paid, and cancel
// (spec 2026-08-25-billing-invoices-design.md). SaaS-only surface, reached
// through the existing `superAdmin` route group (already SuperAdminOnly +
// SaaS-gated in handler.go) — no additional role guard needed here.
package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"idento/backend/internal/billing"
	"idento/backend/internal/config"
	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// toTxFail converts an error surfaced outside a WithTx closure (e.g. from
// buildInvoiceLines, which returns a plain *httpError) into the *txFail
// shape respondTxError expects, preserving status/message. Anything that
// isn't an *httpError becomes a 500 — a store failure with no more specific
// mapping.
func toTxFail(err error) *txFail {
	var he *httpError
	if errors.As(err, &he) {
		return &txFail{he.status, he.msg}
	}
	return &txFail{http.StatusInternalServerError, "Internal error"}
}

// validateCatalogItem checks the request-shape/kind-consistency rules the
// billing_catalog_kind_* CHECK constraints enforce at the DB layer, so a
// bad request 400s with a field-specific message instead of a raw
// constraint-violation 500. Returns "" when the item is valid.
func validateCatalogItem(item *models.BillingCatalogItem) string {
	if strings.TrimSpace(item.Name) == "" {
		return "name is required"
	}
	if item.Price < 0 {
		return "price must be non-negative"
	}
	if item.VATRate != nil && *item.VATRate <= 0 {
		return "vat_rate must be greater than 0 (omit it for «Без НДС»)"
	}
	switch item.Kind {
	case "plan":
		if item.PlanID == nil || item.Period == nil || item.DefaultActivation == nil {
			return "plan items require plan_id, period and default_activation"
		}
		if item.LimitKey != nil || item.LimitDelta != nil || item.Validity != nil || item.ValidityDays != nil {
			return "plan items must not set limit_key, limit_delta, validity or validity_days"
		}
	case "addon":
		if item.LimitKey == nil || item.LimitDelta == nil || item.Validity == nil {
			return "addon items require limit_key, limit_delta and validity"
		}
		if *item.LimitDelta <= 0 {
			return "limit_delta must be greater than 0"
		}
		if *item.Validity == "fixed_days" {
			if item.ValidityDays == nil {
				return "fixed_days addon items require validity_days"
			}
			if *item.ValidityDays <= 0 {
				return "validity_days must be greater than 0"
			}
		}
		if item.PlanID != nil || item.Period != nil || item.DefaultActivation != nil {
			return "addon items must not set plan_id, period or default_activation"
		}
	case "service":
		if item.PlanID != nil || item.Period != nil || item.DefaultActivation != nil ||
			item.LimitKey != nil || item.LimitDelta != nil || item.Validity != nil || item.ValidityDays != nil {
			return "service items must not set plan_id, period, default_activation, limit_key, limit_delta, validity or validity_days"
		}
	default:
		return "kind must be plan, service or addon"
	}
	return ""
}

// GetCatalogSuper returns the full catalog (operator view — includes
// non-public items). include_inactive=true additionally includes inactive
// items; otherwise only IsActive items are returned.
func (h *Handler) GetCatalogSuper(c echo.Context) error {
	items, err := h.Store.GetCatalogItems(c.Request().Context(), false)
	if err != nil {
		return writeErr(c, err)
	}
	if c.QueryParam("include_inactive") != "true" {
		filtered := make([]*models.BillingCatalogItem, 0, len(items))
		for _, item := range items {
			if item.IsActive {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}
	return c.JSON(http.StatusOK, items)
}

// CreateCatalogItemSuper creates a new catalog item.
func (h *Handler) CreateCatalogItemSuper(c echo.Context) error {
	var item models.BillingCatalogItem
	if err := c.Bind(&item); err != nil {
		return writeErr(c, newHTTPError(http.StatusBadRequest, "Invalid request body"))
	}
	if msg := validateCatalogItem(&item); msg != "" {
		return writeErr(c, newHTTPError(http.StatusBadRequest, msg))
	}
	claims, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}
	adminID, err := uuid.Parse(claims.UserID)
	if err != nil {
		return writeErr(c, newHTTPError(http.StatusUnauthorized, "Invalid token"))
	}

	ctx := c.Request().Context()
	txErr := h.Store.WithTx(ctx, func(tx store.Store) error {
		if err := tx.CreateCatalogItem(ctx, &item); err != nil {
			return &txFail{http.StatusInternalServerError, "Failed to create catalog item"}
		}
		if err := tx.LogAdminAction(ctx, adminID, "create_catalog_item", "billing_catalog_item", item.ID,
			map[string]interface{}{"item": item}, c.RealIP(), c.Request().UserAgent()); err != nil {
			return err
		}
		return nil
	})
	if txErr != nil {
		return respondTxError(c, txErr)
	}
	return c.JSON(http.StatusCreated, item)
}

// UpdateCatalogItemSuper replaces an existing catalog item. The old item is
// loaded first (inside the same transaction) both to 404 on an unknown id
// and to give the audit row an old/new diff.
func (h *Handler) UpdateCatalogItemSuper(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return writeErr(c, newHTTPError(http.StatusNotFound, "Catalog item not found"))
	}
	var item models.BillingCatalogItem
	if err := c.Bind(&item); err != nil {
		return writeErr(c, newHTTPError(http.StatusBadRequest, "Invalid request body"))
	}
	item.ID = id
	if msg := validateCatalogItem(&item); msg != "" {
		return writeErr(c, newHTTPError(http.StatusBadRequest, msg))
	}
	claims, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}
	adminID, err := uuid.Parse(claims.UserID)
	if err != nil {
		return writeErr(c, newHTTPError(http.StatusUnauthorized, "Invalid token"))
	}

	ctx := c.Request().Context()
	txErr := h.Store.WithTx(ctx, func(tx store.Store) error {
		old, err := tx.GetCatalogItemByID(ctx, id)
		if err != nil {
			return &txFail{http.StatusInternalServerError, "Failed to load catalog item"}
		}
		if old == nil {
			return &txFail{http.StatusNotFound, "Catalog item not found"}
		}
		item.CreatedAt = old.CreatedAt
		if err := tx.UpdateCatalogItem(ctx, &item); err != nil {
			return &txFail{http.StatusInternalServerError, "Failed to update catalog item"}
		}
		if err := tx.LogAdminAction(ctx, adminID, "update_catalog_item", "billing_catalog_item", id,
			map[string]interface{}{"old": old, "new": item}, c.RealIP(), c.Request().UserAgent()); err != nil {
			return err
		}
		return nil
	})
	if txErr != nil {
		return respondTxError(c, txErr)
	}
	return c.JSON(http.StatusOK, item)
}

// createSuperInvoiceRequest is the POST /super-admin/billing/invoices body.
type createSuperInvoiceRequest struct {
	TenantID uuid.UUID          `json:"tenant_id"`
	Lines    []invoiceLineInput `json:"lines"`
	Comment  *string            `json:"comment"`
}

// CreateInvoiceSuper issues an invoice on a tenant's behalf. Same
// construction as the tenant self-service flow (buildInvoiceLines) except
// catalog items only need to exist and be IsActive — public visibility is
// not required, since an operator can invoice against any active item. The
// target tenant must still have a billing profile (409 otherwise).
func (h *Handler) CreateInvoiceSuper(c echo.Context) error {
	var req createSuperInvoiceRequest
	if err := c.Bind(&req); err != nil {
		return writeErr(c, newHTTPError(http.StatusBadRequest, "Invalid request body"))
	}
	if req.TenantID == uuid.Nil {
		return writeErr(c, newHTTPError(http.StatusBadRequest, "tenant_id is required"))
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

	claims, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}
	adminID, err := uuid.Parse(claims.UserID)
	if err != nil {
		return writeErr(c, newHTTPError(http.StatusUnauthorized, "Invalid token"))
	}

	ctx := c.Request().Context()
	var inv *models.Invoice
	txErr := h.Store.WithTx(ctx, func(tx store.Store) error {
		profile, err := tx.GetTenantBillingProfile(ctx, req.TenantID)
		if err != nil {
			return &txFail{http.StatusInternalServerError, "Failed to load billing profile"}
		}
		if profile == nil {
			return &txFail{http.StatusConflict, "Billing profile is required before issuing an invoice"}
		}

		lines, total, err := buildInvoiceLines(ctx, tx, req.Lines, false)
		if err != nil {
			return toTxFail(err)
		}

		newInv := &models.Invoice{
			TenantID:              req.TenantID,
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
			CreatedBy:             &adminID,
		}
		if err := tx.CreateInvoice(ctx, newInv, lines); err != nil {
			return &txFail{http.StatusInternalServerError, "Failed to create invoice"}
		}
		newInv.Lines = lines

		if err := tx.LogAdminAction(ctx, adminID, "create_invoice", "invoice", newInv.ID, map[string]interface{}{
			"number":    newInv.Number,
			"tenant_id": newInv.TenantID,
			"total":     newInv.Total,
		}, c.RealIP(), c.Request().UserAgent()); err != nil {
			return err
		}
		inv = newInv
		return nil
	})
	if txErr != nil {
		return respondTxError(c, txErr)
	}
	inv.TotalInWords = billing.AmountInWords(inv.Total)
	return c.JSON(http.StatusCreated, inv)
}

// ListInvoicesSuper lists invoices across all tenants, optionally filtered
// by tenant_id and/or status.
func (h *Handler) ListInvoicesSuper(c echo.Context) error {
	var filter store.InvoiceFilter
	if raw := c.QueryParam("tenant_id"); raw != "" {
		parsed, err := uuid.Parse(raw)
		if err != nil {
			return writeErr(c, newHTTPError(http.StatusBadRequest, "Invalid tenant_id"))
		}
		filter.TenantID = &parsed
	}
	if status := c.QueryParam("status"); status != "" {
		switch status {
		case "issued", "paid", "cancelled":
			filter.Status = status
		default:
			return writeErr(c, newHTTPError(http.StatusBadRequest, "status must be issued, paid or cancelled"))
		}
	}
	if raw := c.QueryParam("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 500 {
			return writeErr(c, newHTTPError(http.StatusBadRequest, "limit must be between 1 and 500"))
		}
		filter.Limit = limit
	} else {
		filter.Limit = 100
	}
	if raw := c.QueryParam("offset"); raw != "" {
		offset, err := strconv.Atoi(raw)
		if err != nil || offset < 0 {
			return writeErr(c, newHTTPError(http.StatusBadRequest, "offset must be 0 or greater"))
		}
		filter.Offset = offset
	}
	invoices, err := h.Store.ListInvoices(c.Request().Context(), filter)
	if err != nil {
		return writeErr(c, err)
	}
	return c.JSON(http.StatusOK, invoices)
}

// GetInvoiceSuper returns a single invoice by id, unscoped by tenant
// (operator view).
func (h *Handler) GetInvoiceSuper(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return writeErr(c, newHTTPError(http.StatusNotFound, "Invoice not found"))
	}
	inv, err := h.Store.GetInvoiceByID(c.Request().Context(), id)
	if err != nil {
		return writeErr(c, err)
	}
	if inv == nil {
		return writeErr(c, newHTTPError(http.StatusNotFound, "Invoice not found"))
	}
	inv.TotalInWords = billing.AmountInWords(inv.Total)
	return c.JSON(http.StatusOK, inv)
}

// markInvoicePaidRequest is the POST .../mark-paid body.
type markInvoicePaidRequest struct {
	Reason *string `json:"reason"`
}

// MarkInvoicePaidSuper marks an invoice paid and applies every line's
// billing effect (plan activation / limit boost) in one transaction with
// the audit row.
func (h *Handler) MarkInvoicePaidSuper(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return writeErr(c, newHTTPError(http.StatusNotFound, "Invoice not found"))
	}
	var req markInvoicePaidRequest
	if err := c.Bind(&req); err != nil {
		return writeErr(c, newHTTPError(http.StatusBadRequest, "Invalid request body"))
	}
	claims, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}
	adminID, err := uuid.Parse(claims.UserID)
	if err != nil {
		return writeErr(c, newHTTPError(http.StatusUnauthorized, "Invalid token"))
	}

	ctx := c.Request().Context()
	var inv *models.Invoice
	var effects []store.AppliedLineEffect
	txErr := h.Store.WithTx(ctx, func(tx store.Store) error {
		result, eff, err := tx.ApplyInvoicePayment(ctx, id, time.Now())
		if err != nil {
			switch {
			case errors.Is(err, store.ErrInvoiceNotFound):
				return &txFail{http.StatusNotFound, "Invoice not found"}
			case errors.Is(err, store.ErrInvoiceNotIssued):
				return &txFail{http.StatusConflict, "invoice is not payable in its current status"}
			case errors.Is(err, store.ErrBoostNeedsEndDate):
				return &txFail{http.StatusConflict, "addon requires the subscription to have an end date — fix the subscription or use a fixed-days addon"}
			default:
				return &txFail{http.StatusInternalServerError, "Failed to mark invoice paid"}
			}
		}

		if err := tx.LogAdminAction(ctx, adminID, "invoice_paid", "invoice", id, map[string]interface{}{
			"number":    result.Number,
			"tenant_id": result.TenantID,
			"effects":   eff,
			"reason":    req.Reason,
		}, c.RealIP(), c.Request().UserAgent()); err != nil {
			return err
		}
		inv = result
		effects = eff
		return nil
	})
	if txErr != nil {
		return respondTxError(c, txErr)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"invoice": inv, "effects": effects})
}

// CancelInvoiceSuper cancels an issued invoice.
func (h *Handler) CancelInvoiceSuper(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return writeErr(c, newHTTPError(http.StatusNotFound, "Invoice not found"))
	}
	var body struct {
		Reason string `json:"reason"`
	}
	//nolint:errcheck
	_ = c.Bind(&body) // optional body; malformed/absent JSON leaves body.Reason == ""
	claims, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}
	adminID, err := uuid.Parse(claims.UserID)
	if err != nil {
		return writeErr(c, newHTTPError(http.StatusUnauthorized, "Invalid token"))
	}

	var changes map[string]interface{}
	if strings.TrimSpace(body.Reason) != "" {
		changes = map[string]interface{}{"reason": body.Reason}
	}
	ctx := c.Request().Context()
	txErr := h.Store.WithTx(ctx, func(tx store.Store) error {
		if err := tx.CancelInvoice(ctx, id); err != nil {
			switch {
			case errors.Is(err, store.ErrInvoiceNotFound):
				return &txFail{http.StatusNotFound, "Invoice not found"}
			case errors.Is(err, store.ErrInvoiceNotIssued):
				return &txFail{http.StatusConflict, "invoice is not cancellable in its current status"}
			default:
				return &txFail{http.StatusInternalServerError, "Failed to cancel invoice"}
			}
		}
		if err := tx.LogAdminAction(ctx, adminID, "invoice_cancelled", "invoice", id, changes,
			c.RealIP(), c.Request().UserAgent()); err != nil {
			return err
		}
		return nil
	})
	if txErr != nil {
		return respondTxError(c, txErr)
	}
	return c.JSON(http.StatusOK, map[string]string{"status": "cancelled"})
}
