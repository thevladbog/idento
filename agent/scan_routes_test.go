package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

type scanDataResponse struct {
	Code string `json:"code"`
	Time string `json:"time"`
}

func newScanTestServer() (*httptest.Server, *scanBuffer) {
	buf := newScanBuffer()
	mux := http.NewServeMux()
	registerScanRoutes(mux, buf)
	return httptest.NewServer(mux), buf
}

func TestScanRoutes_Last_ReflectsBufferWithoutClearing(t *testing.T) {
	srv, buf := newScanTestServer()
	defer srv.Close()
	buf.Set("A")

	resp, err := http.Get(srv.URL + "/scan/last")
	if err != nil {
		t.Fatalf("GET /scan/last: %v", err)
	}
	defer resp.Body.Close()

	var got scanDataResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Code != "A" {
		t.Fatalf("expected code=A, got %q", got.Code)
	}

	// /scan/last must not clear the buffer.
	code, _ := buf.Last()
	if code != "A" {
		t.Fatalf("expected buffer to still hold A after GET /scan/last, got %q", code)
	}
}

func TestScanRoutes_Clear_RequiresPOST(t *testing.T) {
	srv, _ := newScanTestServer()
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/scan/clear")
	if err != nil {
		t.Fatalf("GET /scan/clear: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 for GET /scan/clear, got %d", resp.StatusCode)
	}
}

func TestScanRoutes_Clear_EmptiesBuffer(t *testing.T) {
	srv, buf := newScanTestServer()
	defer srv.Close()
	buf.Set("A")

	resp, err := http.Post(srv.URL+"/scan/clear", "application/json", nil)
	if err != nil {
		t.Fatalf("POST /scan/clear: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	code, _ := buf.Last()
	if code != "" {
		t.Fatalf("expected buffer cleared, got %q", code)
	}
}

func TestScanRoutes_Consume_RequiresPOST(t *testing.T) {
	srv, _ := newScanTestServer()
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/scan/consume")
	if err != nil {
		t.Fatalf("GET /scan/consume: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 for GET /scan/consume, got %d", resp.StatusCode)
	}
}

func TestScanRoutes_Consume_ReturnsAndClearsInOneRequest(t *testing.T) {
	srv, buf := newScanTestServer()
	defer srv.Close()
	buf.Set("A")

	resp, err := http.Post(srv.URL+"/scan/consume", "application/json", nil)
	if err != nil {
		t.Fatalf("POST /scan/consume: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var got scanDataResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Code != "A" {
		t.Fatalf("expected code=A, got %q", got.Code)
	}

	// The buffer must be empty immediately after the response — no separate
	// clear call is needed, and none is possible to race against.
	code, _ := buf.Last()
	if code != "" {
		t.Fatalf("expected buffer cleared after /scan/consume, got %q", code)
	}
}

func TestScanRoutes_Consume_EmptyBufferReturnsEmptyCode(t *testing.T) {
	srv, _ := newScanTestServer()
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/scan/consume", "application/json", nil)
	if err != nil {
		t.Fatalf("POST /scan/consume: %v", err)
	}
	defer resp.Body.Close()

	var got scanDataResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Code != "" {
		t.Fatalf("expected empty code from empty buffer, got %q", got.Code)
	}
}
