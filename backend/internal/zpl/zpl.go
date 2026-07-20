// Package zpl generates ZPL (Zebra Programming Language) for badge labels
// from a template (elements, size, DPI) and attendee data.
package zpl

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
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
	// ShowCaption is a barcode-only field (panel editor, 2026-07-20 live-run
	// request): whether ^BC prints its human-readable interpretation line.
	// A *bool (not bool) because the JSON key being ABSENT must still mean
	// "print it" -- every template saved before this field existed has no
	// such key at all, and a plain bool's Y/N zero value can't distinguish
	// that from an explicit false. Only an explicit `false` flips ^BC's
	// interpretation-line argument to N (generateBarcodeZPL below); nil and
	// a pointer to true both mean Y.
	ShowCaption *bool `json:"showCaption,omitempty"`
}

// qrModulesPerSide is the typical number of modules per side for a medium-sized
// QR symbol (e.g. version 3 is 29×29). Used to derive per-module dot size from
// the element width in mm: (widthDots / qrModulesPerSide) gives module size in dots.
const qrModulesPerSide = 30

func mmToDots(mm float64, dpi int) int {
	return int(math.Round((mm / 25.4) * float64(dpi)))
}

func pointsToDots(points float64, dpi int) int {
	return int(math.Round((points / 72) * float64(dpi)))
}

// getZPLFont returns a ZPL font code. Prefer scalable "0" when fontSize does not
// exactly match a bitmap's base size so ^A fontHeight,fontWidth scale consistently.
// Bitmap fonts: A (12pt), B (14pt), C (18×10), D (24pt), E (28pt).
func getZPLFont(fontSize float64) string {
	pt := int(math.Round(fontSize))
	switch pt {
	case 12:
		return "A"
	case 14:
		return "B"
	case 18:
		return "C" // 18×10 bitmap
	case 24:
		return "D"
	case 28:
		return "E"
	default:
		return "0" // scalable; use for non-exact sizes
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

// sanitizeZPLFont returns a ZPL font code (one character: '0' or 'A'–'Z') for use in ^A.
// If fontFamily is empty, invalid, or not in the allowed set, returns getZPLFont(fontSize).
// Accepts single rune '0' or 'A'–'Z' (case-insensitive); maps common names to a valid code otherwise.
func sanitizeZPLFont(fontFamily string, fontSize float64) string {
	fontFamily = strings.TrimSpace(fontFamily)
	if fontFamily == "" {
		return getZPLFont(fontSize)
	}
	runes := []rune(fontFamily)
	if len(runes) == 1 {
		c := runes[0]
		if c == '0' || (c >= 'A' && c <= 'Z') {
			return string(c)
		}
		if c >= 'a' && c <= 'z' {
			return string(c - 32)
		}
		return getZPLFont(fontSize)
	}
	switch strings.ToLower(fontFamily) {
	case "scalable", "default":
		return "0"
	case "a", "12", "12pt":
		return "A"
	case "b", "14", "14pt":
		return "B"
	case "c", "18", "18pt":
		return "C"
	case "d", "24", "24pt":
		return "D"
	case "e", "28", "28pt":
		return "E"
	default:
		return getZPLFont(fontSize)
	}
}

// escapeZPL escapes special ZPL characters using ZPL hex (_ + hex): _ -> _5F, ^ -> _5E, ~ -> _7E.
// Order matters: escape _ first to avoid double-escaping the escape prefix.
func escapeZPL(s string) string {
	s = strings.ReplaceAll(s, "_", "_5F")
	s = strings.ReplaceAll(s, "^", "_5E")
	s = strings.ReplaceAll(s, "~", "_7E")
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
	font := sanitizeZPLFont(el.FontFamily, fontSize)
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
		return fmt.Sprintf("^FO%d,%d^FB%d,%d,0,%s,0%s^FH^FD%s^FS", x, y, width, maxLines, align, fontCmd, textContent)
	}
	return fmt.Sprintf("^FO%d,%d%s^FH^FD%s^FS", x, y, fontCmd, textContent)
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
	moduleSize := mmToDots(widthMM, dpi) / qrModulesPerSide
	if moduleSize < 2 {
		moduleSize = 2
	}

	return fmt.Sprintf("^FO%d,%d^BQN,2,%d^FH^FDQA,%s^FS", x, y, moduleSize, qrData)
}

// Fit-to-width Code 128 (2026-07-20-badge-barcode-fit-to-width-design.md):
// the module width is COMPUTED from the zone and data length and emitted as
// an explicit ^BY, so the estimate and the real print use the identical
// width -- superseding the old fixed-2 assumption, which broke on any
// printer whose persisted ^BY default wasn't 2 (the ZD410 center-shift
// bug). Mirrors panel/src/features/badge/zpl/generateZpl.ts's constants
// verbatim; both files must stay in sync.
const (
	barcodeQuietModules  = 10 // Code 128 min quiet zone, each side
	barcodeMinModuleDots = 2  // reliable-scan floor @203dpi
	barcodeMaxModuleDots = 3  // short-code ceiling
)

// barcodeFootprintModules is the total footprint in modules INCLUDING quiet
// zones -- the fit calc, so bars plus their required margins fit the zone.
// Mirrors panel/generateZpl.ts's barcodeFootprintModules exactly.
func barcodeFootprintModules(dataLength int) int {
	return (dataLength+2)*11 + 13 + 2*barcodeQuietModules
}

// barcodeFootprintBarModules is the bar-only module count -- the centering
// estimate; quiet zones are layout margin, not part of the ^FO-anchored
// symbol width.
func barcodeFootprintBarModules(dataLength int) int {
	return (dataLength+2)*11 + 13
}

// barcodeModuleWidthDots computes the ^BY module width that makes the
// barcode (bars + quiet zones) fit zoneWidthDots, clamped to
// [barcodeMinModuleDots, barcodeMaxModuleDots]. Mirrors panel/generateZpl.ts's
// barcodeModuleWidthDots exactly.
func barcodeModuleWidthDots(dataLength, zoneWidthDots int) int {
	fit := zoneWidthDots / barcodeFootprintModules(dataLength) // integer floor
	if fit < barcodeMinModuleDots {
		return barcodeMinModuleDots
	}
	if fit > barcodeMaxModuleDots {
		return barcodeMaxModuleDots
	}
	return fit
}

// barcodeOverflows reports whether the code can't fit its zone even at the
// readability floor. The Go print path has no UI to surface this (unlike
// the panel, which shows an advisory warning), so it's unused here -- kept
// only to mirror panel/generateZpl.ts's barcodeOverflows for parity and
// possible future use.
func barcodeOverflows(dataLength, zoneWidthDots int) bool {
	return barcodeFootprintModules(dataLength)*barcodeMinModuleDots > zoneWidthDots
}

// estimateBarcodeWidthDots returns an APPROXIMATE Code 128 rendered BAR
// width in dots for dataLength input characters, using the COMPUTED module
// width so the ^FO centering below matches the emitted ^BY (see design doc
// docs/superpowers/specs/2026-07-20-badge-barcode-fit-to-width-design.md):
// assumes Code Set B (one symbol character per input character, 11 modules
// each) plus a start character and a checksum character (also 11 modules
// each) and the wider 13-module stop character. All-numeric data may print
// NARROWER than this estimate if the printer's firmware auto-switches to
// Code Set C (two digits packed per symbol character) -- a documented,
// bounded left bias, not the old unbounded printer-^BY-state error. Mirrors
// panel/generateZpl.ts's estimateBarcodeWidthDots exactly.
func estimateBarcodeWidthDots(dataLength, moduleWidthDots int) int {
	return barcodeFootprintBarModules(dataLength) * moduleWidthDots
}

// barcodeFieldOrigin computes the ^FO x coordinate (whether to append ^FO's
// right-justification argument), and the ^BY module width for a barcode
// element. Mirrors panel/src/features/badge/zpl/generateZpl.ts's
// barcodeFieldOrigin exactly -- see that function's own comment for the
// full left/center/right rationale (^FO's native z=1 justification for
// right, zero estimation error; a computed estimate-based offset for
// center, since ^FO has no center-justification option; left/absent
// unchanged). The panel additionally returns `estimatedWidthDots` and
// `overflows` to drive its own UI warning; the Go print path has no such UI
// (YAGNI), so only `moduleWidthDots` is added here, needed so the caller
// can emit ^BY.
func barcodeFieldOrigin(el BadgeElement, dpi, dataLength int) (x int, rightJustified bool, moduleWidthDots int) {
	zoneLeft := mmToDots(el.X, dpi)
	widthMM := el.Width
	if widthMM <= 0 {
		widthMM = 30
	}
	zoneWidth := mmToDots(widthMM, dpi)
	moduleWidthDots = barcodeModuleWidthDots(dataLength, zoneWidth)

	switch el.Align {
	case "right":
		return zoneLeft + zoneWidth, true, moduleWidthDots
	case "center":
		estimated := estimateBarcodeWidthDots(dataLength, moduleWidthDots)
		offset := int(math.Round(float64(zoneWidth-estimated) / 2))
		if offset < 0 {
			offset = 0
		}
		return zoneLeft + offset, false, moduleWidthDots
	default:
		return zoneLeft, false, moduleWidthDots
	}
}

func generateBarcodeZPL(el BadgeElement, data map[string]interface{}, dpi int) string {
	y := mmToDots(el.Y, dpi)

	barcodeData := el.Text
	if el.Source != "" {
		if v := getDataString(data, el.Source); v != "" {
			barcodeData = v
		}
	}

	x, rightJustified, moduleWidth := barcodeFieldOrigin(el, dpi, utf8.RuneCountInString(barcodeData))
	barcodeData = escapeZPL(barcodeData)

	heightMM := el.Height
	if heightMM <= 0 {
		heightMM = 10
	}
	height := mmToDots(heightMM, dpi)

	// ^BC's third argument prints the human-readable interpretation line.
	// Only an explicit `showCaption: false` flips it to N -- nil (absent,
	// every template saved before this field existed) and a pointer to true
	// both keep it Y, matching the panel's own generateZpl.ts port exactly.
	interpretationLine := "Y"
	if el.ShowCaption != nil && !*el.ShowCaption {
		interpretationLine = "N"
	}

	foSuffix := ""
	if rightJustified {
		foSuffix = ",1"
	}

	// ^BY sets the module width for the barcode that follows -- emitted
	// explicitly so the print width equals estimateBarcodeWidthDots's
	// assumption (fit-to-width design). Persistent modal command, but this
	// label has one barcode and ^BY immediately precedes it, so there's no
	// cross-element leak. Keep the existing ^FH (Go generator's hex-escape
	// flag) exactly where it is -- only ^BY%d is prepended.
	return fmt.Sprintf("^BY%d^FO%d,%d%s^BCN,%d,%s,N,N^FH^FD%s^FS", moduleWidth, x, y, foSuffix, height, interpretationLine, barcodeData)
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
	fmt.Fprintf(&b, "^PW%d\n", widthDots)
	fmt.Fprintf(&b, "^LL%d\n", heightDots)
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
		if cfg.WidthMM <= 0 {
			cfg.WidthMM = 50
		}
		if cfg.HeightMM <= 0 {
			cfg.HeightMM = 30
		}
		if cfg.DPI <= 0 {
			cfg.DPI = 203
		}
		if els := v["elements"]; els != nil {
			js, err := json.Marshal(els)
			if err != nil {
				return Config{}, nil, fmt.Errorf("marshal els: %w", err)
			}
			if err := json.Unmarshal(js, &elements); err != nil {
				return Config{}, nil, fmt.Errorf("unmarshal elements: %w", err)
			}
		}
		return cfg, elements, nil
	default:
		// Try JSON roundtrip
		js, err := json.Marshal(raw)
		if err != nil {
			return Config{}, nil, fmt.Errorf("marshal template: %w", err)
		}
		var t struct {
			WidthMM  float64        `json:"width_mm"`
			HeightMM float64        `json:"height_mm"`
			DPI      int            `json:"dpi"`
			Elements []BadgeElement `json:"elements"`
		}
		if err := json.Unmarshal(js, &t); err != nil {
			return Config{}, nil, fmt.Errorf("unmarshal badge template: %w", err)
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
