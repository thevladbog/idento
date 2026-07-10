package store

import "testing"

// Invalid client-supplied IPs must degrade to NULL, not fail the audit INSERT
// into the INET column (PR #29 review).
func TestAuditIPValue(t *testing.T) {
	cases := []struct {
		in   string
		want interface{}
	}{
		{"::1", "::1"},
		{"192.0.2.1", "192.0.2.1"},
		{"", nil},
		{"not-an-ip", nil},
		{"192.0.2.1, 10.0.0.1", nil}, // spoofed multi-value X-Forwarded-For
	}
	for _, tc := range cases {
		if got := auditIPValue(tc.in); got != tc.want {
			t.Errorf("auditIPValue(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}
