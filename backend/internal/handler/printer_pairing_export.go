package handler

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/skip2/go-qrcode"
)

// errPairingQRUnsupportedDevice is returned by buildPrinterQRPayload for any
// device that cannot yield a mobile-scannable pairing QR: only a
// class=printer, kind=network device (a reachable ip:port) qualifies. A
// system/CUPS printer is bound to a machine's local agent and a scanner is
// not a printer at all — the mobile app can reach neither directly.
var errPairingQRUnsupportedDevice = errors.New("pairing QR is only available for network printers")

// buildPrinterQRPayload turns a registry device row into the exact
// PrinterQRData the mobile app parses (PrinterQRData.kt). It is the SINGLE
// source of truth for that mapping — both the PNG endpoint and the CSV
// export call it, so the qr_payload column and the scanned PNG are
// byte-identical (both json.Marshal(payload)). Returns
// errPairingQRUnsupportedDevice for anything but a class=printer/kind=network
// device, and the same config.ip/port errors as the equipment config
// validator when a network config is malformed.
func buildPrinterQRPayload(device models.EquipmentDevice) (models.PrinterQRData, error) {
	if device.Class != "printer" || device.Kind != "network" {
		return models.PrinterQRData{}, errPairingQRUnsupportedDevice
	}

	var shape networkPrinterConfigShape
	if err := decodeStrictConfig(device.Config, &shape); err != nil {
		return models.PrinterQRData{}, err
	}
	if strings.TrimSpace(shape.IP) == "" {
		return models.PrinterQRData{}, errors.New("config.ip is required")
	}
	if shape.Port < 1 || shape.Port > 65535 {
		return models.PrinterQRData{}, errors.New("config.port must be between 1 and 65535")
	}

	// Normalize the IP the same way the emptiness check above trims it — a
	// stored config value like " 10.0.0.5 " (validated non-empty, stored
	// verbatim) must not reach the QR as an unusable padded endpoint.
	ip := strings.TrimSpace(shape.IP)
	port := shape.Port
	payload := models.PrinterQRData{
		Type:        models.PrinterTypeIdentifier,
		Version:     models.PrinterTypeVersion,
		PrinterType: models.PrinterTypeEthernet,
		Name:        device.DisplayName,
		IP:          &ip,
		Port:        &port,
	}
	if shape.DPI != nil {
		payload.Settings = &models.PrinterSettings{DPI: shape.DPI}
	}
	return payload, nil
}

// slugForFilename reduces a device display_name to an ASCII filename stem
// (letters/digits kept, spaces/-/_ collapsed to '-'), falling back to the
// device id when nothing printable survives — e.g. an all-Cyrillic name.
func slugForFilename(name string, id uuid.UUID) string {
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '_':
			b.WriteRune('-')
		}
	}
	slug := strings.Trim(b.String(), "-")
	if slug == "" {
		return id.String()
	}
	return slug
}

// GetPrinterPairingQR streams a PNG QR code the mobile app scans to connect
// to this network printer. Only class=printer, kind=network devices are
// eligible (422 otherwise). The QR encodes the same PrinterQRData JSON the
// CSV export's qr_payload column carries — both come from
// buildPrinterQRPayload.
func (h *Handler) GetPrinterPairingQR(c echo.Context) error {
	deviceID, err := uuid.Parse(c.Param("device_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid device ID"})
	}
	tenantID, err := tenantIDFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}

	device, err := h.Store.GetEquipmentDeviceForTenant(c.Request().Context(), tenantID, deviceID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Internal error"})
	}
	if device == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Device not found"})
	}

	payload, err := buildPrinterQRPayload(*device)
	if err != nil {
		return c.JSON(http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to encode printer data"})
	}
	png, err := qrcode.Encode(string(jsonData), qrcode.Medium, 512)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate QR code"})
	}

	c.Response().Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="%s-pairing-qr.png"`, slugForFilename(device.DisplayName, device.ID)))
	return c.Blob(http.StatusOK, "image/png", png)
}

// ExportPrinterPairingCSV streams a CSV of every network printer in the
// tenant's registry, one row per printer, with a ready-to-bind qr_payload
// column (the exact PrinterQRData JSON) plus the human-readable fields a
// label tool prints alongside the QR. UTF-8 BOM so Excel opens Cyrillic
// names correctly; encoding/csv escaping (the ExportAttendeesCSV precedent),
// and sanitizeCSVField against formula injection on free-text columns.
func (h *Handler) ExportPrinterPairingCSV(c echo.Context) error {
	tenantID, err := tenantIDFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}

	printers, err := h.Store.ListEquipmentPrintersForTenant(c.Request().Context(), tenantID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load printers"})
	}

	var buf strings.Builder
	buf.WriteString("\ufeff") // UTF-8 BOM for Excel
	w := csv.NewWriter(&buf)

	if err := w.Write([]string{"name", "machine", "printer_type", "ip", "port", "dpi", "qr_payload", "device_id"}); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to write CSV header"})
	}

	for _, p := range printers {
		payload, err := buildPrinterQRPayload(p.Device)
		if err != nil {
			// A network printer with a malformed config (no ip/port) cannot
			// yield a scannable QR — skip it rather than emit a broken row.
			continue
		}
		jsonData, err := json.Marshal(payload)
		if err != nil {
			continue
		}

		ip := ""
		if payload.IP != nil {
			ip = *payload.IP
		}
		port := ""
		if payload.Port != nil {
			port = strconv.Itoa(*payload.Port)
		}
		dpi := ""
		if payload.Settings != nil && payload.Settings.DPI != nil {
			dpi = strconv.Itoa(*payload.Settings.DPI)
		}

		row := []string{
			sanitizeCSVField(p.Device.DisplayName),
			sanitizeCSVField(p.Hostname),
			"ethernet",
			sanitizeCSVField(ip),
			port,
			dpi,
			sanitizeCSVField(string(jsonData)),
			p.Device.ID.String(),
		}
		if err := w.Write(row); err != nil {
			c.Logger().Errorf("Failed to write CSV row: %v", err)
			continue
		}
	}

	w.Flush()
	if err := w.Error(); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate CSV"})
	}

	c.Response().Header().Set("Content-Type", "text/csv")
	c.Response().Header().Set("Content-Disposition", `attachment; filename="printers-pairing.csv"`)
	return c.String(http.StatusOK, buf.String())
}
