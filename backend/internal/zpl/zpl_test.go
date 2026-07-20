package zpl

import (
	"strings"
	"testing"
)

// TestGenerateBarcodeHonorsShowCaptionField pins the backend half of the
// panel editor's 2026-07-20 live-run request: `showCaption` on a barcode
// element (panel/src/features/badge/templateTypes.ts) must flip ^BC's
// human-readable interpretation-line argument on the REAL check-in print
// path too, not just the panel's own TypeScript preview/reprint port.
//
// web/src/pages/CheckinFullscreen.tsx (the actual check-in kiosk flow) posts
// to POST /api/events/:id/badge-zpl, which calls THIS package's Generate --
// never the panel's generateZpl.ts. An earlier version of this test asserted
// the field was silently ignored here; that was a real functional gap (bot
// review, PR #87): the toggle appeared to work in the panel's own preview
// but had zero effect on badges actually printed via check-in. `ShowCaption`
// is now a first-class *bool field (a plain bool can't distinguish "absent"
// from "explicitly false", and absent must still mean Y for back-compat with
// every template saved before this field existed).
//
// Exercises ParseBadgeTemplate's map[string]interface{} decode path (the
// shape event custom_fields actually decode to off Postgres jsonb).
func TestGenerateBarcodeHonorsShowCaptionField(t *testing.T) {
	buildRaw := func(elementExtra map[string]interface{}) map[string]interface{} {
		element := map[string]interface{}{
			"id":     "b1",
			"type":   "barcode",
			"x":      5.0,
			"y":      5.0,
			"height": 10.0,
			"text":   "ABC123",
		}
		for k, v := range elementExtra {
			element[k] = v
		}
		return map[string]interface{}{
			"width_mm":  90.0,
			"height_mm": 55.0,
			"dpi":       300.0,
			"elements":  []interface{}{element},
		}
	}

	generate := func(raw map[string]interface{}) string {
		cfg, els, err := ParseBadgeTemplate(raw)
		if err != nil {
			t.Fatalf("ParseBadgeTemplate error: %v", err)
		}
		return Generate(cfg, els, nil)
	}

	t.Run("absent showCaption keeps the interpretation line on (back-compat default)", func(t *testing.T) {
		zpl := generate(buildRaw(nil))
		if want := "^BCN,118,Y,N,N"; !strings.Contains(zpl, want) {
			t.Fatalf("expected %q in output, got: %q", want, zpl)
		}
	})

	t.Run("showCaption: true is byte-identical to the absent-field default", func(t *testing.T) {
		zplAbsent := generate(buildRaw(nil))
		zplTrue := generate(buildRaw(map[string]interface{}{"showCaption": true}))
		if zplTrue != zplAbsent {
			t.Fatalf("showCaption:true changed output:\nabsent: %q\ntrue:   %q", zplAbsent, zplTrue)
		}
	})

	t.Run("showCaption: false flips the interpretation-line argument to N", func(t *testing.T) {
		zpl := generate(buildRaw(map[string]interface{}{"showCaption": false}))
		if want := "^BCN,118,N,N,N"; !strings.Contains(zpl, want) {
			t.Fatalf("expected %q in output, got: %q", want, zpl)
		}
	})
}

// TestParseBadgeTemplateStructRawPathAlsoHonorsShowCaption exercises
// ParseBadgeTemplate's OTHER decode branch -- `raw` is some non-
// map[string]interface{} value (e.g. a typed struct already decoded off a
// json.RawMessage), which re-marshals and unmarshals through a second,
// separate anonymous struct (zpl.go's "Try JSON roundtrip" branch). Both
// branches must agree on showCaption's Y/N mapping.
func TestParseBadgeTemplateStructRawPathAlsoHonorsShowCaption(t *testing.T) {
	type rawElement struct {
		ID          string  `json:"id"`
		Type        string  `json:"type"`
		X           float64 `json:"x"`
		Y           float64 `json:"y"`
		Height      float64 `json:"height"`
		Text        string  `json:"text"`
		ShowCaption *bool   `json:"showCaption,omitempty"`
	}
	type rawDoc struct {
		WidthMM  float64      `json:"width_mm"`
		HeightMM float64      `json:"height_mm"`
		DPI      int          `json:"dpi"`
		Elements []rawElement `json:"elements"`
	}

	falseVal := false
	docFalse := rawDoc{
		WidthMM: 90, HeightMM: 55, DPI: 300,
		Elements: []rawElement{{ID: "b1", Type: "barcode", X: 5, Y: 5, Height: 10, Text: "ABC123", ShowCaption: &falseVal}},
	}
	docAbsent := rawDoc{
		WidthMM: 90, HeightMM: 55, DPI: 300,
		Elements: []rawElement{{ID: "b1", Type: "barcode", X: 5, Y: 5, Height: 10, Text: "ABC123"}},
	}

	cfgFalse, elsFalse, err := ParseBadgeTemplate(docFalse)
	if err != nil {
		t.Fatalf("ParseBadgeTemplate(struct, showCaption:false) error: %v", err)
	}
	cfgAbsent, elsAbsent, err := ParseBadgeTemplate(docAbsent)
	if err != nil {
		t.Fatalf("ParseBadgeTemplate(struct, showCaption absent) error: %v", err)
	}

	zplFalse := Generate(cfgFalse, elsFalse, nil)
	zplAbsent := Generate(cfgAbsent, elsAbsent, nil)

	if want := "^BCN,118,N,N,N"; !strings.Contains(zplFalse, want) {
		t.Fatalf("expected %q in struct-path output, got: %q", want, zplFalse)
	}
	if want := "^BCN,118,Y,N,N"; !strings.Contains(zplAbsent, want) {
		t.Fatalf("expected %q in struct-path output, got: %q", want, zplAbsent)
	}
}
