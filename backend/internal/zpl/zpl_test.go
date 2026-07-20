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

// TestGenerateBarcodeAlignment pins the backend half of barcode alignment
// (panel/src/features/badge/zpl/generateZpl.ts's barcodeFieldOrigin has the
// TypeScript twin of every case here, using the SAME numeric fixtures for
// cross-stack parity) -- the real check-in print path only ever calls this
// Go generator, never the panel's own TypeScript port, so alignment must
// work here too, not just in the panel's preview.
func TestGenerateBarcodeAlignment(t *testing.T) {
	cfg := Config{WidthMM: 90, HeightMM: 55, DPI: 300}

	t.Run("left/absent align is byte-identical to today's output (no ^FO third argument)", func(t *testing.T) {
		els := []BadgeElement{{ID: "e1", Type: "barcode", X: 5, Y: 5, Text: "ABC123"}}
		zpl := Generate(cfg, els, nil)
		// footprint(incl quiet)=((6+2)*11+13+20)=121; zoneWidthDots(354)/121 floors to 2 -> ^BY2.
		if want := "^BY2^FO59,59^BCN,118,Y,N,N^FH^FDABC123^FS"; !strings.Contains(zpl, want) {
			t.Fatalf("expected %q in output, got: %q", want, zpl)
		}
	})

	t.Run("right align appends ^FO's z=1 justification argument, x at the zone's right edge (default 30mm width)", func(t *testing.T) {
		els := []BadgeElement{{ID: "e1", Type: "barcode", X: 5, Y: 5, Text: "ABC123", Align: "right"}}
		zpl := Generate(cfg, els, nil)
		// x = zoneLeftDots(59) + zoneWidthDots(354) = 413; moduleWidth=2 as above (right doesn't shift x).
		if want := "^BY2^FO413,59,1^BCN,118,Y,N,N^FH^FDABC123^FS"; !strings.Contains(zpl, want) {
			t.Fatalf("expected %q in output, got: %q", want, zpl)
		}
	})

	t.Run("treats an explicit width: 0 the same as omitted width (falls back to the 30mm default zone)", func(t *testing.T) {
		els := []BadgeElement{{ID: "e1", Type: "barcode", X: 5, Y: 5, Width: 0, Text: "ABC123", Align: "right"}}
		zpl := Generate(cfg, els, nil)
		if want := "^BY2^FO413,59,1^BCN,118,Y,N,N^FH^FDABC123^FS"; !strings.Contains(zpl, want) {
			t.Fatalf("expected %q in output, got: %q", want, zpl)
		}
	})

	t.Run("right align honors an explicit width zone, not just the 30mm default", func(t *testing.T) {
		els := []BadgeElement{{ID: "e1", Type: "barcode", X: 5, Y: 5, Width: 50, Text: "ABC123", Align: "right"}}
		zpl := Generate(cfg, els, nil)
		// x = zoneLeftDots(59) + zoneWidthDots(591) = 650; fit=floor(591/121)=4, clamped to MAX=3 -> ^BY3.
		if want := "^BY3^FO650,59,1^BCN,118,Y,N,N^FH^FDABC123^FS"; !strings.Contains(zpl, want) {
			t.Fatalf("expected %q in output, got: %q", want, zpl)
		}
	})

	t.Run("center align computes an x offset with no ^FO third argument", func(t *testing.T) {
		els := []BadgeElement{{ID: "e1", Type: "barcode", X: 5, Y: 5, Text: "ABC123", Align: "center"}}
		zpl := Generate(cfg, els, nil)
		// moduleWidth=2 (as above); estimatedWidthDots = ((6+2)*11+13)*2 = 202; slack = 354-202 = 152; offset = round(152/2) = 76; x = 59+76 = 135.
		if want := "^BY2^FO135,59^BCN,118,Y,N,N^FH^FDABC123^FS"; !strings.Contains(zpl, want) {
			t.Fatalf("expected %q in output, got: %q", want, zpl)
		}
	})

	t.Run("center align clamps to zero offset when the estimate exceeds a narrow explicit width zone", func(t *testing.T) {
		els := []BadgeElement{{ID: "e1", Type: "barcode", X: 5, Y: 5, Width: 10, Text: "ABC123", Align: "center"}}
		zpl := Generate(cfg, els, nil)
		// zoneWidthDots=mmToDots(10,300)=118; fit=floor(118/121)=0, clamped up to MIN=2 -> ^BY2.
		// estimatedWidthDots=((6+2)*11+13)*2=202 -> negative slack clamps to 0 -> x=59.
		if want := "^BY2^FO59,59^BCN,118,Y,N,N^FH^FDABC123^FS"; !strings.Contains(zpl, want) {
			t.Fatalf("expected %q in output, got: %q", want, zpl)
		}
	})

	t.Run("uses rune count, not byte count, for Cyrillic barcode data", func(t *testing.T) {
		// "Привет" is 6 Cyrillic runes but 12 UTF-8 bytes -- byte-counting
		// would inflate the estimated width and shift the computed x.
		els := []BadgeElement{{ID: "e1", Type: "barcode", X: 5, Y: 5, Text: "Привет", Align: "center"}}
		zpl := Generate(cfg, els, nil)
		// estimatedWidthDots = ((6+2)*11+13)*2 = 202 (same as "ABC123", 6 runes); offset = 76; x = 135.
		if want := "^FO135,59"; !strings.Contains(zpl, want) {
			t.Fatalf("expected %q (rune-counted x) in output, got: %q", want, zpl)
		}
	})
}

// TestBarcodeModuleWidth pins barcodeModuleWidthDots/barcodeOverflows
// against panel/src/features/badge/zpl/generateZpl.ts's identically-named
// twins -- both files share the same fit formula (footprint = (len+2)*11 +
// 13 + 20 quiet-zone modules, clamped to [2,3]) and must agree on every
// case.
func TestBarcodeModuleWidth(t *testing.T) {
	cases := []struct {
		name         string
		dataLen      int
		zoneWidth    int
		wantWidth    int
		wantOverflow bool
	}{
		{"short code wide zone caps at MAX", 10, 795, 3, false},
		{"medium code fits at floor", 30, 795, 2, false},
		{"uuid clamps up to floor and overflows", 36, 795, 2, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := barcodeModuleWidthDots(c.dataLen, c.zoneWidth); got != c.wantWidth {
				t.Errorf("moduleWidth = %d, want %d", got, c.wantWidth)
			}
			if got := barcodeOverflows(c.dataLen, c.zoneWidth); got != c.wantOverflow {
				t.Errorf("overflows = %v, want %v", got, c.wantOverflow)
			}
		})
	}
}

// TestGenerateBarcodeZPL_EmitsBYAndCenters pins the fit-to-width feature end
// to end through the real Generate/ParseBadgeTemplate entry point (the real
// check-in print path never calls generateBarcodeZPL directly): a wide
// short-code zone caps the module width at 3 and centers using the
// COMPUTED width, matching panel/generateZpl.ts's identical
// QA-EN-0001 fixture (its own test asserts the same `^BY3^FO184,` prefix).
func TestGenerateBarcodeZPL_EmitsBYAndCenters(t *testing.T) {
	cfg := Config{WidthMM: 50, HeightMM: 30, DPI: 203}
	els := []BadgeElement{{ID: "b1", Type: "barcode", Source: "code", X: 0.5, Y: 37, Width: 99.5, Height: 17.5, Align: "center"}}
	data := map[string]interface{}{"code": "QA-EN-0001"}
	got := Generate(cfg, els, data)
	// module width capped to 3; center x = 4 + round((795 - 145*3)/2) = 184.
	if want := "^BY3^FO184,"; !strings.Contains(got, want) {
		t.Errorf("missing %q prefix: %s", want, got)
	}
}
