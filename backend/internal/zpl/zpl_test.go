package zpl

import (
	"strings"
	"testing"
)

// TestGenerateBarcodeIgnoresPanelOnlyShowCaptionField pins a cross-cutting
// contract for the panel editor's 2026-07-20 live-run request: `showCaption`
// on a barcode element (panel/src/features/badge/templateTypes.ts) is a
// PANEL-ONLY extension. This backend struct never declares the field, and
// Go's json.Unmarshal silently drops unknown object keys by default (no
// DisallowUnknownFields call anywhere in this package) -- so a template
// saved by the panel with `"showCaption": false` must still parse cleanly
// here and Generate must still emit the same hardcoded `^BCN,<h>,Y,N,N`
// interpretation-line argument it always has. If this ever regresses (e.g.
// someone adds strict decoding, or promotes the field into BadgeElement
// without updating generateBarcodeZPL), the kiosk/legacy check-in print path
// -- which only ever calls this Go generator, never the panel's TypeScript
// port -- would silently start behaving differently for templates the panel
// edited, which is exactly the drift this test exists to catch.
//
// Exercises ParseBadgeTemplate's map[string]interface{} decode path (the
// shape event custom_fields actually decode to off Postgres jsonb).
func TestGenerateBarcodeIgnoresPanelOnlyShowCaptionField(t *testing.T) {
	rawWithField := map[string]interface{}{
		"width_mm":  90.0,
		"height_mm": 55.0,
		"dpi":       300.0,
		"elements": []interface{}{
			map[string]interface{}{
				"id":          "b1",
				"type":        "barcode",
				"x":           5.0,
				"y":           5.0,
				"height":      10.0,
				"text":        "ABC123",
				"showCaption": false,
			},
		},
	}
	rawWithoutField := map[string]interface{}{
		"width_mm":  90.0,
		"height_mm": 55.0,
		"dpi":       300.0,
		"elements": []interface{}{
			map[string]interface{}{
				"id":     "b1",
				"type":   "barcode",
				"x":      5.0,
				"y":      5.0,
				"height": 10.0,
				"text":   "ABC123",
			},
		},
	}

	cfgWith, elsWith, err := ParseBadgeTemplate(rawWithField)
	if err != nil {
		t.Fatalf("ParseBadgeTemplate(with showCaption) error: %v", err)
	}
	cfgWithout, elsWithout, err := ParseBadgeTemplate(rawWithoutField)
	if err != nil {
		t.Fatalf("ParseBadgeTemplate(without showCaption) error: %v", err)
	}

	zplWith := Generate(cfgWith, elsWith, nil)
	zplWithout := Generate(cfgWithout, elsWithout, nil)

	if zplWith != zplWithout {
		t.Fatalf("showCaption presence changed backend output:\nwith:    %q\nwithout: %q", zplWith, zplWithout)
	}
	if want := "^BCN,118,Y,N,N"; !strings.Contains(zplWith, want) {
		t.Fatalf("expected barcode command %q in output, got: %q", want, zplWith)
	}
}

// TestParseBadgeTemplateStructRawPathAlsoIgnoresShowCaption exercises
// ParseBadgeTemplate's OTHER decode branch -- `raw` is some non-
// map[string]interface{} value (e.g. a typed struct already decoded off a
// json.RawMessage), which re-marshals and unmarshals through a second,
// separate anonymous struct (zpl.go's "Try JSON roundtrip" branch). Both
// branches must agree that an unknown `showCaption` key is silently dropped.
func TestParseBadgeTemplateStructRawPathAlsoIgnoresShowCaption(t *testing.T) {
	type rawElement struct {
		ID          string  `json:"id"`
		Type        string  `json:"type"`
		X           float64 `json:"x"`
		Y           float64 `json:"y"`
		Height      float64 `json:"height"`
		Text        string  `json:"text"`
		ShowCaption bool    `json:"showCaption"`
	}
	type rawDoc struct {
		WidthMM  float64      `json:"width_mm"`
		HeightMM float64      `json:"height_mm"`
		DPI      int          `json:"dpi"`
		Elements []rawElement `json:"elements"`
	}

	docWith := rawDoc{
		WidthMM: 90, HeightMM: 55, DPI: 300,
		Elements: []rawElement{{ID: "b1", Type: "barcode", X: 5, Y: 5, Height: 10, Text: "ABC123", ShowCaption: false}},
	}
	docWithout := rawDoc{
		WidthMM: 90, HeightMM: 55, DPI: 300,
		Elements: []rawElement{{ID: "b1", Type: "barcode", X: 5, Y: 5, Height: 10, Text: "ABC123"}},
	}

	cfgWith, elsWith, err := ParseBadgeTemplate(docWith)
	if err != nil {
		t.Fatalf("ParseBadgeTemplate(struct, with showCaption) error: %v", err)
	}
	cfgWithout, elsWithout, err := ParseBadgeTemplate(docWithout)
	if err != nil {
		t.Fatalf("ParseBadgeTemplate(struct, without showCaption) error: %v", err)
	}

	zplWith := Generate(cfgWith, elsWith, nil)
	zplWithout := Generate(cfgWithout, elsWithout, nil)

	if zplWith != zplWithout {
		t.Fatalf("showCaption presence changed backend output on the struct decode path:\nwith:    %q\nwithout: %q", zplWith, zplWithout)
	}
}
