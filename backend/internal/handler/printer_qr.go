package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"

	"idento/backend/internal/models"

	"github.com/labstack/echo/v4"
	"github.com/skip2/go-qrcode"
)

// GeneratePrinterQR генерирует QR-код для настройки принтера
func (h *Handler) GeneratePrinterQR(c echo.Context) error {
	var req models.PrinterQRData

	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request format")
	}

	// Устанавливаем обязательные системные поля
	req.Type = models.PrinterTypeIdentifier
	req.Version = models.PrinterTypeVersion

	// Валидация данных
	if err := validatePrinterQRData(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	// Генерируем JSON для QR
	jsonData, err := json.Marshal(req)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to encode printer data")
	}

	// Генерируем QR код
	// Размер 512x512 для лучшего качества печати, уровень коррекции Medium
	qrCode, err := qrcode.Encode(string(jsonData), qrcode.Medium, 512)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to generate QR code")
	}

	// Возвращаем PNG изображение
	c.Response().Header().Set("Content-Disposition", "attachment; filename=printer-qr.png")
	return c.Blob(http.StatusOK, "image/png", qrCode)
}

// validatePrinterQRData валидирует данные принтера для QR
func validatePrinterQRData(data *models.PrinterQRData) error {
	// Проверка обязательных полей
	if data.Name == "" {
		return errors.New("printer name is required")
	}

	if data.PrinterType == "" {
		return errors.New("printer_type is required (bluetooth or ethernet)")
	}

	// Валидация в зависимости от типа принтера
	switch data.PrinterType {
	case models.PrinterTypeBluetooth:
		// Для Bluetooth обязателен MAC адрес
		if data.Address == nil || *data.Address == "" {
			return errors.New("MAC address is required for Bluetooth printer")
		}

		// Валидация формата MAC адреса
		if !isValidMacAddress(*data.Address) {
			return errors.New("invalid MAC address format (expected: AA:BB:CC:DD:EE:FF)")
		}

	case models.PrinterTypeEthernet:
		// Для Ethernet обязателен IP адрес
		if data.IP == nil || *data.IP == "" {
			return errors.New("IP address is required for Ethernet printer")
		}

		// Валидация формата IP адреса
		if !isValidIPAddress(*data.IP) {
			return errors.New("invalid IP address format")
		}

		// Порт опционален (по умолчанию 9100)
		if data.Port != nil {
			if *data.Port < 1 || *data.Port > 65535 {
				return errors.New("port must be between 1 and 65535")
			}
		}

	default:
		return errors.New("printer_type must be 'bluetooth' or 'ethernet'")
	}

	// Валидация расширенных настроек (если есть)
	if data.Settings != nil {
		if data.Settings.DPI != nil {
			if *data.Settings.DPI != 203 && *data.Settings.DPI != 300 {
				return errors.New("DPI must be 203 or 300")
			}
		}

		if data.Settings.Darkness != nil {
			if *data.Settings.Darkness < 0 || *data.Settings.Darkness > 30 {
				return errors.New("darkness must be between 0 and 30")
			}
		}
	}

	return nil
}

// isValidMacAddress проверяет формат MAC адреса
func isValidMacAddress(mac string) bool {
	macRegex := regexp.MustCompile(`^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$`)
	return macRegex.MatchString(mac)
}

// isValidIPAddress проверяет формат IP адреса
func isValidIPAddress(ip string) bool {
	// Валидация IPv4 адреса
	// Разрешает: 0.0.0.0 - 255.255.255.255
	ipRegex := regexp.MustCompile(`^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$`)
	return ipRegex.MatchString(ip)
}
