package handler

import (
	"errors"
	"strings"

	"idento/backend/internal/models"
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
