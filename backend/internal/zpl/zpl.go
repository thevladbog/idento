// Package zpl generates ZPL (Zebra Programming Language) for badge labels
// from a template (elements, size, DPI) and attendee data.
package zpl

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Config holds label dimensions and DPI.
type Config struct {
	WidthMM  float64 `json:"width_mm"`
	HeightMM float64 `json:"height_mm"`
	DPI      int     `json:"dpi"` // 203 or 300
}

// BadgeElement represents one element in the badge template (text, qrcode, barcode, line, box).
type BadgeElement struct {
	ID         string  `json:"id"`
	Type       string  `json:"type"` // text, qrcode, barcode, line, box
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
	Width      float64 `json:"width,omitempty"`
	Height     float64 `json:"height,omitempty"`
	FontSize   float64 `json:"fontSize,omitempty"`
	Text       string  `json:"text,omitempty"`
	Source     string  `json:"source,omitempty"` // field name e.g. first_name
	Align      string  `json:"align,omitempty"`  // left, center, right
	Valign     string  `json:"valign,omitempty"`
	Rotation   int     `json:"rotation,omitempty"` // 0, 90, 180, 270
	FontFamily string  `json:"fontFamily,omitempty"`
	Bold       bool    `json:"bold,omitempty"`
	MaxLines   int     `json:"maxLines,omitempty"`
}

// BadgeTemplate is the structure stored in event.custom_fields.badgeTemplate.
type BadgeTemplate struct {
	Elements []BadgeElement `json:"elements"`
	WidthMM  float64        `json:"width_mm"`
	HeightMM float64        `json:"height_mm"`
	DPI      int            `json:"dpi"`
}

func mmToDots(mm float64, dpi int) int {
	return int(math.Round((mm / 25.4) * float64(dpi)))
}

func pointsToDots(points float64, dpi int) int {
	return int(math.Round((points / 72) * float64(dpi)))
}

func getZPLFont(fontSize float64) string {
	switch {
	case fontSize <= 10:
		return "0"
	case fontSize <= 14:
		return "A"
	case fontSize <= 18:
		return "B"
	case fontSize <= 24:
		return "D"
	default:
		return "E"
	}
}

func getZPLAlign(align string) string {
	switch align {
	case "center":
		return "C"
	case "right":
		return "R"
	default:
		return "L"
	}
}

func getZPLRotation(rotation int) string {
	switch rotation {
	case 90:
		return "R"
	case 180:
		return "I"
	case 270:
		return "B"
	default:
		return "N"
	}
}

// escapeZPL escapes special ZPL characters in text: \ ^ ~
func escapeZPL(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "^", "\\^")
	s = strings.ReplaceAll(s, "~", "\\~")
	return s
}

func getDataString(data map[string]interface{}, key string) string {
	if key == "" {
		return ""
	}
	v, ok := data[key]
	if !ok || v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case int:
		return strconv.Itoa(t)
	case bool:
		if t {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprint(v)
	}
}

func generateTextZPL(el BadgeElement, data map[string]interface{}, dpi int) string {
	x := mmToDots(el.X, dpi)
	y := mmToDots(el.Y, dpi)

	textContent := el.Text
	if el.Source != "" {
		if v := getDataString(data, el.Source); v != "" {
			textContent = v
		}
	}
	textContent = escapeZPL(textContent)

	fontSize := el.FontSize
	if fontSize <= 0 {
		fontSize = 12
	}
	fontHeight := pointsToDots(fontSize, dpi)
	fontWidth := fontHeight
	rot := getZPLRotation(el.Rotation)
	font := el.FontFamily
	if font == "" {
		font = getZPLFont(fontSize)
	}
	align := getZPLAlign(el.Align)

	if el.Valign != "" && el.Height > 0 {
		heightDots := mmToDots(el.Height, dpi)
		switch el.Valign {
		case "middle":
			y += (heightDots - fontHeight) / 2
		case "bottom":
			y += heightDots - fontHeight
		}
	}

	fontCmd := fmt.Sprintf("^A%s%s,%d,%d", font, rot, fontHeight, fontWidth)
	maxLines := el.MaxLines
	if maxLines <= 0 {
		maxLines = 1
	}

	if el.Width > 0 {
		width := mmToDots(el.Width, dpi)
		return fmt.Sprintf("^FO%d,%d^FB%d,%d,0,%s,0%s^FD%s^FS", x, y, width, maxLines, align, fontCmd, textContent)
	}
	return fmt.Sprintf("^FO%d,%d%s^FD%s^FS", x, y, fontCmd, textContent)
}

func generateQRCodeZPL(el BadgeElement, data map[string]interface{}, dpi int) string {
	x := mmToDots(el.X, dpi)
	y := mmToDots(el.Y, dpi)

	qrData := el.Text
	if el.Source != "" {
		if v := getDataString(data, el.Source); v != "" {
			qrData = v
		}
	}
	qrData = escapeZPL(qrData)

	widthMM := el.Width
	if widthMM <= 0 {
		widthMM = 20
	}
	moduleSize := mmToDots(widthMM, dpi) / 30
	if moduleSize < 2 {
		moduleSize = 2
	}

	return fmt.Sprintf("^FO%d,%d^BQN,2,%d^FDQA,%s^FS", x, y, moduleSize, qrData)
}

func generateBarcodeZPL(el BadgeElement, data map[string]interface{}, dpi int) string {
	x := mmToDots(el.X, dpi)
	y := mmToDots(el.Y, dpi)

	barcodeData := el.Text
	if el.Source != "" {
		if v := getDataString(data, el.Source); v != "" {
			barcodeData = v
		}
	}
	barcodeData = escapeZPL(barcodeData)

	heightMM := el.Height
	if heightMM <= 0 {
		heightMM = 10
	}
	height := mmToDots(heightMM, dpi)

	return fmt.Sprintf("^FO%d,%d^BCN,%d,Y,N,N^FD%s^FS", x, y, height, barcodeData)
}

func generateLineZPL(el BadgeElement, dpi int) string {
	x := mmToDots(el.X, dpi)
	y := mmToDots(el.Y, dpi)
	width := mmToDots(el.Width, dpi)
	if width <= 0 {
		width = mmToDots(10, dpi)
	}
	thickness := 2
	return fmt.Sprintf("^FO%d,%d^GB%d,%d,%d^FS", x, y, width, thickness, thickness)
}

func generateBoxZPL(el BadgeElement, dpi int) string {
	x := mmToDots(el.X, dpi)
	y := mmToDots(el.Y, dpi)
	width := mmToDots(el.Width, dpi)
	if width <= 0 {
		width = mmToDots(10, dpi)
	}
	height := mmToDots(el.Height, dpi)
	if height <= 0 {
		height = mmToDots(10, dpi)
	}
	thickness := 2
	return fmt.Sprintf("^FO%d,%d^GB%d,%d,%d^FS", x, y, width, height, thickness)
}

// Generate produces a full ZPL document from config, elements, and data.
func Generate(cfg Config, elements []BadgeElement, data map[string]interface{}) string {
	dpi := cfg.DPI
	if dpi <= 0 {
		dpi = 203
	}
	widthDots := mmToDots(cfg.WidthMM, dpi)
	heightDots := mmToDots(cfg.HeightMM, dpi)
	if widthDots <= 0 {
		widthDots = mmToDots(50, dpi)
	}
	if heightDots <= 0 {
		heightDots = mmToDots(30, dpi)
	}

	var b strings.Builder
	b.WriteString("^XA\n")
	b.WriteString("^CI28\n") // UTF-8
	b.WriteString(fmt.Sprintf("^PW%d\n", widthDots))
	b.WriteString(fmt.Sprintf("^LL%d\n", heightDots))
	b.WriteString("^PR4\n")
	b.WriteString("^LH0,0\n")

	for _, el := range elements {
		var line string
		switch el.Type {
		case "text":
			line = generateTextZPL(el, data, dpi)
		case "qrcode":
			line = generateQRCodeZPL(el, data, dpi)
		case "barcode":
			line = generateBarcodeZPL(el, data, dpi)
		case "line":
			line = generateLineZPL(el, dpi)
		case "box":
			line = generateBoxZPL(el, dpi)
		default:
			continue
		}
		if line != "" {
			b.WriteString(line)
			b.WriteString("\n")
		}
	}

	b.WriteString("^XZ\n")
	return b.String()
}

// ParseBadgeTemplate unmarshals badgeTemplate from event custom_fields (e.g. from JSON).
func ParseBadgeTemplate(raw interface{}) (cfg Config, elements []BadgeElement, err error) {
	if raw == nil {
		return Config{WidthMM: 50, HeightMM: 30, DPI: 203}, nil, nil
	}
	// If it's already a map, we need to extract fields.
	switch v := raw.(type) {
	case map[string]interface{}:
		if w, ok := v["width_mm"].(float64); ok {
			cfg.WidthMM = w
		} else {
			cfg.WidthMM = 50
		}
		if h, ok := v["height_mm"].(float64); ok {
			cfg.HeightMM = h
		} else {
			cfg.HeightMM = 30
		}
		if d, ok := v["dpi"].(float64); ok {
			cfg.DPI = int(d)
		} else {
			cfg.DPI = 203
		}
		if els := v["elements"]; els != nil {
			js, err := json.Marshal(els)
			if err != nil {
				return Config{}, nil, err
			}
			if err := json.Unmarshal(js, &elements); err != nil {
				return Config{}, nil, err
			}
		}
		return cfg, elements, nil
	default:
		// Try JSON roundtrip
		js, err := json.Marshal(raw)
		if err != nil {
			return Config{}, nil, err
		}
		var t struct {
			WidthMM  float64        `json:"width_mm"`
			HeightMM float64        `json:"height_mm"`
			DPI      int            `json:"dpi"`
			Elements []BadgeElement `json:"elements"`
		}
		if err := json.Unmarshal(js, &t); err != nil {
			return Config{}, nil, err
		}
		cfg.WidthMM = t.WidthMM
		cfg.HeightMM = t.HeightMM
		cfg.DPI = t.DPI
		if cfg.WidthMM <= 0 {
			cfg.WidthMM = 50
		}
		if cfg.HeightMM <= 0 {
			cfg.HeightMM = 30
		}
		if cfg.DPI <= 0 {
			cfg.DPI = 203
		}
		return cfg, t.Elements, nil
	}
}
