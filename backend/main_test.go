package main

import (
	"strings"
	"testing"
)

// TestBackendOpenAPISpecEmbedsRealFile guards against a regression where
// backendOpenAPISpec drifts back to being a hardcoded, stale copy of the API
// spec instead of a //go:embed of the real backend/openapi.yaml.
//
// backend/openapi.yaml was made truthful during the P0.3 truth-up (63
// operations, contract-tested against real handler behavior — see
// internal/handler/openapi_contract_test.go). The old hardcoded
// backendOpenAPISpec constant still documented the wrong, pre-truth-up path
// "/api/auth/login"; Task 1 corrected the real spec to "/auth/login". This
// test verifies backendOpenAPISpec is wired to the real, current file and
// not a frozen/stale copy.
func TestBackendOpenAPISpecEmbedsRealFile(t *testing.T) {
	if backendOpenAPISpec == "" {
		t.Fatal("backendOpenAPISpec is empty; //go:embed of openapi.yaml did not populate it")
	}

	if !strings.Contains(backendOpenAPISpec, "/auth/login") {
		t.Error("backendOpenAPISpec does not contain the correct path \"/auth/login\"; " +
			"it should be the real, current backend/openapi.yaml")
	}

	if strings.Contains(backendOpenAPISpec, "/api/auth/login") {
		t.Error("backendOpenAPISpec contains the stale, incorrect path \"/api/auth/login\"; " +
			"this indicates backendOpenAPISpec is a hardcoded/frozen copy rather than an " +
			"embed of the real backend/openapi.yaml (Task 1 already fixed this path)")
	}
}
