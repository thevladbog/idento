package models

// PrinterQRData представляет данные для QR-кода принтера
type PrinterQRData struct {
	Type        string `json:"type"`         // Должен быть "idento_printer"
	Version     string `json:"version"`      // Версия формата (1.0)
	PrinterType string `json:"printer_type"` // "bluetooth" или "ethernet"
	Name        string `json:"name" validate:"required"`

	// Bluetooth специфичные поля
	Address *string `json:"address,omitempty"` // MAC адрес (AA:BB:CC:DD:EE:FF)

	// Ethernet специфичные поля
	IP   *string `json:"ip,omitempty"`   // IP адрес (192.168.1.100)
	Port *int    `json:"port,omitempty"` // Порт (обычно 9100)

	// Опциональные поля
	Model    *string          `json:"model,omitempty"`    // Модель принтера
	Location *string          `json:"location,omitempty"` // Местоположение
	Settings *PrinterSettings `json:"settings,omitempty"` // Расширенные настройки
}

// PrinterSettings представляет расширенные настройки принтера
type PrinterSettings struct {
	DPI         *int `json:"dpi,omitempty"`          // 203 или 300
	LabelWidth  *int `json:"label_width,omitempty"`  // Ширина этикетки в мм
	LabelHeight *int `json:"label_height,omitempty"` // Высота этикетки в мм
	Darkness    *int `json:"darkness,omitempty"`     // Плотность печати (0-30)
}

// Константы для типов принтеров
const (
	PrinterTypeIdentifier = "idento_printer"
	PrinterTypeVersion    = "1.0"
	PrinterTypeBluetooth  = "bluetooth"
	PrinterTypeEthernet   = "ethernet"
)
