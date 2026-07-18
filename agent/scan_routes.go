package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"
)

// registerScanRoutes wires the /scan/* endpoints onto mux against the
// shared buf. Extracted out of main() so the atomic Consume behavior (the
// fix for the panel PR #77 read/clear race) is testable via httptest
// without booting the full agent (printers, scanners, auth, config).
func registerScanRoutes(mux *http.ServeMux, buf *scanBuffer) {
	mux.HandleFunc("/scan/last", func(w http.ResponseWriter, r *http.Request) {
		code, at := buf.Last()
		writeScanData(w, code, at)
	})

	mux.HandleFunc("/scan/clear", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		buf.Clear()
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "cleared"}); err != nil {
			log.Printf("Failed to encode response: %v", err)
		}
	})

	mux.HandleFunc("/scan/consume", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		code, at := buf.Consume()
		writeScanData(w, code, at)
	})
}

// writeScanData writes the shared ScanData JSON shape ({"code", "time"})
// used by /scan/last and /scan/consume.
func writeScanData(w http.ResponseWriter, code string, at time.Time) {
	response := map[string]interface{}{
		"code": code,
		"time": at,
	}

	// Marshal to bytes first to avoid partial writes on error.
	data, err := json.Marshal(response)
	if err != nil {
		log.Printf("Failed to marshal scan response: %v", err)
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(data); err != nil {
		log.Printf("Failed to write scan response: %v", err)
	}
}
