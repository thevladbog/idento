package handler

import "testing"

func TestSanitizeCSVField(t *testing.T) {
	cases := map[string]string{
		"=HYPERLINK(1)": "'=HYPERLINK(1)",
		"+1":            "'+1",
		"-1":            "'-1",
		"@cmd":          "'@cmd",
		"normal":        "normal",
		"":              "",
	}
	for in, want := range cases {
		if got := sanitizeCSVField(in); got != want {
			t.Errorf("sanitizeCSVField(%q) = %q, want %q", in, got, want)
		}
	}
}
