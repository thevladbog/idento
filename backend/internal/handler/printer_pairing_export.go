package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
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

	ip := shape.IP
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
