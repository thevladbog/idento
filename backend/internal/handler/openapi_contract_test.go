package handler

import (
	"context"
	"fmt"
	"net/http/httptest"
	"os"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/gorillamux"
)

// The contract harness validates recorded handler responses against
// backend/openapi.yaml. The spec is the contract; handlers are the truth.
// On mismatch, fix the spec (P0.3 rule) — never silence the test.
var (
	specOnce   sync.Once
	specDoc    *openapi3.T
	specRouter routers.Router
	specErr    error

	coverageMu sync.Mutex
	// keys: "METHOD /spec/path/{template}" — written by validateResponse,
	// asserted complete by TestMain when OPENAPI_COVERAGE=1.
	coverage = map[string]bool{}
)

func loadSpec(t *testing.T) routers.Router {
	t.Helper()
	specOnce.Do(func() {
		loader := openapi3.NewLoader()
		specDoc, specErr = loader.LoadFromFile("../../openapi.yaml")
		if specErr != nil {
			return
		}
		if specErr = specDoc.Validate(loader.Context); specErr != nil {
			return
		}
		specRouter, specErr = gorillamux.NewRouter(specDoc)
	})
	if specErr != nil {
		t.Fatalf("backend/openapi.yaml failed to load or validate: %v", specErr)
	}
	return specRouter
}

// validateResponse matches the concrete request URL against openapi.yaml and
// validates rec's status/headers/body against the matched operation's schema.
// An undocumented path or status fails the test.
func validateResponse(t *testing.T, method, url string, rec *httptest.ResponseRecorder) {
	t.Helper()
	router := loadSpec(t)
	req := httptest.NewRequest(method, url, nil)
	route, pathParams, err := router.FindRoute(req)
	if err != nil {
		t.Fatalf("%s %s is not documented in openapi.yaml: %v", method, url, err)
	}
	input := &openapi3filter.RequestValidationInput{
		Request:    req,
		PathParams: pathParams,
		Route:      route,
		Options:    &openapi3filter.Options{AuthenticationFunc: openapi3filter.NoopAuthenticationFunc},
	}
	respInput := &openapi3filter.ResponseValidationInput{
		RequestValidationInput: input,
		Status:                 rec.Code,
		Header:                 rec.Header(),
	}
	respInput.SetBodyBytes(rec.Body.Bytes())
	if err := openapi3filter.ValidateResponse(context.Background(), respInput); err != nil {
		t.Errorf("%s %s → %d does not match openapi.yaml:\n%v", method, url, rec.Code, err)
	}
	coverageMu.Lock()
	coverage[method+" "+route.Path] = true
	coverageMu.Unlock()
}

func TestMain(m *testing.M) {
	code := m.Run()
	if code == 0 && os.Getenv("OPENAPI_COVERAGE") == "1" {
		if err := assertSpecCoverage(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			code = 1
		}
	}
	os.Exit(code)
}

// assertSpecCoverage fails when openapi.yaml documents an operation no
// contract test validated. Gated behind OPENAPI_COVERAGE=1 so a local
// `go test -run TestX` on a single test doesn't spuriously fail.
func assertSpecCoverage() error {
	if specDoc == nil {
		loader := openapi3.NewLoader()
		doc, err := loader.LoadFromFile("../../openapi.yaml")
		if err != nil {
			return fmt.Errorf("coverage check could not load openapi.yaml: %w", err)
		}
		specDoc = doc
	}
	var missing []string
	for path, item := range specDoc.Paths.Map() {
		for method := range item.Operations() {
			key := method + " " + path
			if !coverage[key] {
				missing = append(missing, key)
			}
		}
	}
	if len(missing) == 0 {
		return nil
	}
	sort.Strings(missing)
	return fmt.Errorf("openapi.yaml operations with no contract test (add one calling validateResponse):\n  %s",
		strings.Join(missing, "\n  "))
}
