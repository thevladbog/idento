package main

import (
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"idento/agent/internal/printer"
	"idento/agent/internal/scanner"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/rs/cors"
)

type PrintRequest struct {
	PrinterName string                 `json:"printer_name"`
	ZPL         string                 `json:"zpl"`      // Raw ZPL data (new format)
	Template    string                 `json:"template"` // Legacy: ZPL or TSPL content with placeholders
	Data        map[string]interface{} `json:"data"`     // Legacy: Placeholders to replace
}

type NetworkPrinterConfig struct {
	Name string `json:"name"`
	IP   string `json:"ip"`
	Port int    `json:"port"`
}

type AgentConfig struct {
	NetworkPrinters []NetworkPrinterConfig `json:"network_printers"`
	ScannerPorts    []string               `json:"scanner_ports"`
}

func loadOpenAPISpec() ([]byte, error) {
	root, err := os.OpenRoot(".")
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := root.Close(); closeErr != nil {
			log.Printf("close openapi root: %v", closeErr)
		}
	}()

	candidatePaths := []string{
		filepath.Join("agent", "openapi.yaml"),
		"openapi.yaml",
	}
	for _, path := range candidatePaths {
		data, err := root.ReadFile(path)
		if err == nil {
			return data, nil
		}
		if !os.IsNotExist(err) {
			return nil, err
		}
	}
	return nil, fmt.Errorf("openapi spec not found")
}

// getConfigDir returns the absolute path to ~/.idento for os.Root-scoped config access.
func getConfigDir() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	configDir := filepath.Join(homeDir, ".idento")
	absDir, err := filepath.Abs(configDir)
	if err != nil {
		return "", err
	}
	return absDir, nil
}

func defaultConfig() *AgentConfig {
	return &AgentConfig{NetworkPrinters: []NetworkPrinterConfig{}, ScannerPorts: []string{}}
}

func loadConfig() (*AgentConfig, error) {
	configDir, err := getConfigDir()
	if err != nil {
		return defaultConfig(), nil
	}
	root, err := os.OpenRoot(configDir)
	if err != nil {
		return defaultConfig(), nil
	}
	defer func() {
		if closeErr := root.Close(); closeErr != nil {
			log.Printf("close config root: %v", closeErr)
		}
	}()
	data, err := root.ReadFile("agent_config.json")
	if err != nil {
		if os.IsNotExist(err) {
			return defaultConfig(), nil
		}
		return nil, err
	}
	var config AgentConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, err
	}
	if config.NetworkPrinters == nil {
		config.NetworkPrinters = []NetworkPrinterConfig{}
	}
	if config.ScannerPorts == nil {
		config.ScannerPorts = []string{}
	}
	return &config, nil
}

func saveConfig(config *AgentConfig) error {
	configDir, err := getConfigDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(configDir, 0750); err != nil {
		return err
	}
	root, err := os.OpenRoot(configDir)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := root.Close(); closeErr != nil {
			log.Printf("close config root: %v", closeErr)
		}
	}()
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	return root.WriteFile("agent_config.json", data, 0600)
}

func main() {
	port := flag.String("port", "12345", "Port to run the agent on")
	useMock := flag.Bool("mock", false, "Use mock printers instead of real hardware")
	flag.Parse()

	log.SetOutput(os.Stdout)

	// Initialize Printer Manager
	pm := printer.NewManager()

	// Initialize Scanner Manager
	sm := scanner.NewManager()

	// For storing scanned data temporarily
	var scanDataMutex sync.Mutex
	var lastScannedCode string
	var lastScanTime time.Time

	if *useMock {
		log.Println("Running in MOCK mode (no real printers)")
		pm.AddPrinter("Zebra_ZD420_Mock", printer.NewMockPrinter("Zebra_ZD420_Mock"))
		pm.AddPrinter("Brother_QL-820NWB_Mock", printer.NewMockPrinter("Brother_QL-820NWB_Mock"))
		pm.AddPrinter("Mock_Printer", printer.NewMockPrinter("Mock_Printer"))
	} else {
		log.Println("Detecting real printers...")

		// 1. Discover system-installed printers (recommended)
		systemPrinters, err := printer.DiscoverSystemPrinters()
		if err != nil {
			log.Printf("Failed to discover system printers: %v", err)
		} else {
			log.Printf("Found %d system printer(s)", len(systemPrinters))
			for _, printerName := range systemPrinters {
				log.Printf("  ✓ %s (System)", printerName)
				pm.AddPrinter(printerName, printer.NewSystemPrinter(printerName))
			}
		}

		// If no printers found, add a mock as fallback
		if len(pm.ListPrinters()) == 0 {
			log.Println("⚠️  No printers detected, adding fallback mock printer")
			pm.AddPrinter("Fallback_Mock", printer.NewMockPrinter("Fallback_Mock"))
		}

		// 2. Load saved configuration
		log.Println("Loading saved network printers...")
		config, err := loadConfig()
		if err != nil {
			log.Printf("Failed to load config: %v", err)
			config = defaultConfig()
		}
		if len(config.NetworkPrinters) > 0 {
			log.Printf("Found %d saved network printer(s)", len(config.NetworkPrinters))
			for _, np := range config.NetworkPrinters {
				log.Printf("  🌐 %s (%s:%d)", np.Name, np.IP, np.Port)
				networkPrinter := printer.NewNetworkPrinterFromIP(np.Name, np.IP, np.Port)
				pm.AddPrinter(np.Name, networkPrinter)
			}
		}

		// 3. Open allow-listed scanners
		if len(config.ScannerPorts) > 0 {
			log.Printf("Opening %d allow-listed scanner port(s)...", len(config.ScannerPorts))
			for _, portName := range config.ScannerPorts {
				if portName == "" {
					continue
				}
				scannerName := fmt.Sprintf("Scanner_%s", sanitizePortName(portName))
				s := scanner.NewScanner(scannerName, portName, 9600)
				s.OnScan(func(data string) {
					scanDataMutex.Lock()
					lastScannedCode = data
					lastScanTime = time.Now()
					scanDataMutex.Unlock()
					log.Printf("📋 Scan received: %s", data)
				})
				if err := s.Open(); err != nil {
					log.Printf("Failed to open allow-listed scanner %s (%s): %v", scannerName, portName, err)
					continue
				}
				sm.AddScanner(scannerName, s)
				log.Printf("Opened scanner: %s (%s)", scannerName, portName)
			}
		}
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte("Idento Agent is running")); err != nil {
			log.Printf("Failed to write health response: %v", err)
		}
	})

	mux.HandleFunc("/printers", func(w http.ResponseWriter, r *http.Request) {
		printers := pm.ListPrinters()

		// Marshal response to bytes first to avoid partial writes on error
		data, err := json.Marshal(printers)
		if err != nil {
			log.Printf("Failed to marshal printers response: %v", err)
			http.Error(w, "Failed to encode response", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write(data); err != nil {
			log.Printf("Failed to write printers response: %v", err)
		}
	})

	mux.HandleFunc("/printers/add", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			Name string `json:"name"`
			IP   string `json:"ip"`
			Port int    `json:"port"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if req.Name == "" || req.IP == "" {
			http.Error(w, "Name and IP are required", http.StatusBadRequest)
			return
		}

		if req.Port == 0 {
			req.Port = 9100 // Default ZPL port
		}

		log.Printf("Adding network printer: %s (%s:%d)", req.Name, req.IP, req.Port)

		// Create network printer
		networkPrinter := printer.NewNetworkPrinterFromIP(req.Name, req.IP, req.Port)
		pm.AddPrinter(req.Name, networkPrinter)

		// Save to config
		config, err := loadConfig()
		if err != nil {
			log.Printf("Warning: Failed to load config: %v", err)
			config = &AgentConfig{NetworkPrinters: []NetworkPrinterConfig{}}
		}

		// Check if printer already exists in config
		exists := false
		for _, np := range config.NetworkPrinters {
			if np.Name == req.Name {
				exists = true
				break
			}
		}

		if !exists {
			config.NetworkPrinters = append(config.NetworkPrinters, NetworkPrinterConfig{
				Name: req.Name,
				IP:   req.IP,
				Port: req.Port,
			})

			if err := saveConfig(config); err != nil {
				log.Printf("Warning: Failed to save config: %v", err)
			} else {
				log.Printf("Printer configuration saved")
			}
		}

		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(map[string]string{
			"status":  "added",
			"name":    req.Name,
			"address": fmt.Sprintf("%s:%d", req.IP, req.Port),
		}); err != nil {
			log.Printf("Failed to encode response: %v", err)
		}
	})

	mux.HandleFunc("/print", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req PrintRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		log.Printf("Received print job for printer: %s", req.PrinterName)

		p, err := pm.GetPrinter(req.PrinterName)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}

		var content string

		// New format: use ZPL directly if provided
		if req.ZPL != "" {
			content = req.ZPL
			log.Printf("Using direct ZPL (%d bytes)", len(content))
		} else if req.Template != "" {
			// Legacy format: template processing (replace {{key}} with value)
			content = req.Template
			for k, v := range req.Data {
				valStr := fmt.Sprintf("%v", v)
				content = replacePlaceholder(content, k, valStr)
			}
			log.Printf("Using template with %d data fields", len(req.Data))
		} else {
			http.Error(w, "Either 'zpl' or 'template' must be provided", http.StatusBadRequest)
			return
		}

		log.Printf("Sending %d bytes to printer...", len(content))
		if err := p.SendRaw([]byte(content)); err != nil {
			log.Printf("Print failed: %v", err)
			http.Error(w, "Print job failed", http.StatusInternalServerError)
			return
		}

		log.Println("Print job completed successfully ✓")
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "printed"}); err != nil {
			log.Printf("Failed to encode response: %v", err)
		}
	})

	// PDF Print endpoint
	mux.HandleFunc("/print-pdf", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			PrinterName string `json:"printer_name"`
			PDFBase64   string `json:"pdf_base64"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		log.Printf("Received PDF print job for printer: %s", req.PrinterName)

		p, err := pm.GetPrinter(req.PrinterName)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}

		// Check if printer supports PDF (only system printers)
		systemPrinter, ok := p.(*printer.SystemPrinter)
		if !ok {
			http.Error(w, "Printer does not support PDF printing. Use ZPL format for label printers.", http.StatusBadRequest)
			return
		}

		if !systemPrinter.SupportsPDF() {
			http.Error(w, "PDF printing not supported on this platform", http.StatusBadRequest)
			return
		}

		// Decode base64 PDF
		pdfData, err := base64.StdEncoding.DecodeString(req.PDFBase64)
		if err != nil {
			log.Printf("Failed to decode PDF: %v", err)
			http.Error(w, "Invalid PDF data (base64 decode failed)", http.StatusBadRequest)
			return
		}

		log.Printf("Sending PDF (%d bytes) to printer...", len(pdfData))
		if err := systemPrinter.PrintPDF(pdfData); err != nil {
			log.Printf("PDF print failed: %v", err)
			http.Error(w, "PDF print job failed", http.StatusInternalServerError)
			return
		}

		log.Println("PDF print job completed successfully ✓")
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "printed"}); err != nil {
			log.Printf("Failed to encode response: %v", err)
		}
	})

	// Get printer fonts endpoint (general reference)
	mux.HandleFunc("/printers/fonts", func(w http.ResponseWriter, r *http.Request) {
		// Return standard ZPL fonts + info about custom fonts
		fonts := map[string]interface{}{
			"built_in": []map[string]string{
				{"id": "0", "name": "0 - Smallest (9x5 dots)", "type": "built-in"},
				{"id": "A", "name": "A - Small (11x9 dots)", "type": "built-in"},
				{"id": "B", "name": "B - Medium (17x10 dots)", "type": "built-in"},
				{"id": "D", "name": "D - Large (21x13 dots)", "type": "built-in"},
				{"id": "E", "name": "E - Largest (28x15 dots)", "type": "built-in"},
				{"id": "F", "name": "F - OCR-B (26x13 dots)", "type": "built-in"},
				{"id": "G", "name": "G - OCR-A (60x40 dots)", "type": "built-in"},
				{"id": "H", "name": "H - Extra Large (34x22 dots)", "type": "built-in"},
			},
			"custom_examples": []string{
				"TT0003M_ (Common TrueType)",
				"ARIAL.TTF",
				"CYR.FNT (Cyrillic)",
				"SWISS.FNT",
			},
			"note": "For custom fonts, enter the exact name as loaded in your printer. Use ^WD* command to query printer for loaded fonts. Or use /printers/{name}/fonts to query a specific printer.",
		}

		// Marshal response to bytes first to avoid partial writes on error
		data, err := json.Marshal(fonts)
		if err != nil {
			log.Printf("Failed to marshal fonts response: %v", err)
			http.Error(w, "Failed to encode response", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write(data); err != nil {
			log.Printf("Failed to write fonts response: %v", err)
		}
	})

	// Query specific printer for fonts
	mux.HandleFunc("/printers/", func(w http.ResponseWriter, r *http.Request) {
		// Parse printer name and action from path: /printers/{name}/fonts
		path := strings.TrimPrefix(r.URL.Path, "/printers/")
		parts := strings.Split(path, "/")

		if len(parts) < 2 || parts[1] != "fonts" {
			http.Error(w, "Invalid path. Use /printers/{name}/fonts", http.StatusNotFound)
			return
		}

		printerName := parts[0]
		p, err := pm.GetPrinter(printerName)
		if err != nil {
			http.Error(w, "Printer not found", http.StatusNotFound)
			return
		}

		log.Printf("Querying printer '%s' for fonts...", printerName)

		// Send comprehensive ZPL commands to query fonts from different memory locations
		// Note: Most printers will PRINT the response on a label, not send it back via network
		queries := []struct {
			cmd  string
			desc string
		}{
			{"~HS^XA^WDE:*.*^XZ", "EPROM (E:) - loaded fonts"},
			{"~HS^XA^WDB:*.*^XZ", "Flash (B:) - loaded fonts"},
			{"~HS^XA^WDR:*.*^XZ", "RAM (R:) - temporary fonts"},
		}

		// Resident (built-in) fonts - these are always available and don't need to be queried
		// They're accessed by letter codes in ZPL
		residentFonts := []string{
			// Standard ZPL resident fonts (accessed via ^A command)
			"0 (9x5 dots) - use fontFamily='0'",
			"A (11x9 dots) - use fontFamily='A'",
			"B (17x10 dots) - use fontFamily='B'",
			"D (21x13 dots) - use fontFamily='D'",
			"E (28x15 dots) - use fontFamily='E'",
			"F (26x13 OCR-B) - use fontFamily='F'",
			"G (60x40 OCR-A) - use fontFamily='G'",
			"H (34x22 dots) - use fontFamily='H'",
		}

		fonts := map[string]interface{}{
			"printer":        printerName,
			"resident_fonts": residentFonts,
			"loaded_fonts_examples": []string{
				// Examples of user-loaded fonts (if any exist in printer memory)
				"TT0003M_",
				"ARIAL.TTF",
				"CYR.FNT",
				"SWISS.FNT",
			},
			"queried":      true,
			"query_method": "printed",
			"note":         "⚠️ ВАЖНО: Запросы отправлены на принтер. Проверьте напечатанные этикетки.",
			"instructions": "ВСТРОЕННЫЕ ШРИФТЫ (Resident Fonts):\n- Не нужно загружать, всегда доступны\n- Используйте выпадающий список 'Шрифт' (0, A, B, D, E, F, G, H)\n- Оставьте поле 'Кастомный шрифт' ПУСТЫМ\n\nЗАГРУЖЕННЫЕ ШРИФТЫ (Loaded Fonts):\n- Проверьте напечатанные этикетки для списка файлов\n- Если на этикетке пусто - значит нет дополнительных шрифтов\n- Введите точное имя файла (например: ARIAL.TTF) в поле 'Кастомный шрифт'",
		}

		// Send queries to all memory locations (will be printed on labels)
		for _, q := range queries {
			if err := p.SendRaw([]byte(q.cmd)); err != nil {
				log.Printf("Font query (%s) failed: %v", q.desc, err)
			} else {
				log.Printf("Font query sent: %s - check printed output", q.desc)
			}
		}

		// Marshal response to bytes first to avoid partial writes on error
		data, err := json.Marshal(fonts)
		if err != nil {
			log.Printf("Failed to marshal fonts response: %v", err)
			http.Error(w, "Failed to encode response", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write(data); err != nil {
			log.Printf("Failed to write fonts response: %v", err)
		}
	})

	// Scanner endpoints
	mux.HandleFunc("/scanners", func(w http.ResponseWriter, r *http.Request) {
		scanners := sm.ListScannerInfos()

		// Marshal response to bytes first to avoid partial writes on error
		data, err := json.Marshal(scanners)
		if err != nil {
			log.Printf("Failed to marshal scanners response: %v", err)
			http.Error(w, "Failed to encode response", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write(data); err != nil {
			log.Printf("Failed to write scanners response: %v", err)
		}
	})

	mux.HandleFunc("/scanners/ports", func(w http.ResponseWriter, r *http.Request) {
		ports, err := scanner.DiscoverScanners()
		if err != nil {
			log.Printf("Failed to discover scanner ports: %v", err)
			w.Header().Set("Content-Type", "application/json")
			if encErr := json.NewEncoder(w).Encode([]scanner.PortInfo{}); encErr != nil {
				log.Printf("Failed to encode empty response: %v", encErr)
			}
			return
		}

		// Ensure we always return an array, never null
		if ports == nil {
			ports = []scanner.PortInfo{}
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(ports); err != nil {
			log.Printf("Failed to encode ports response: %v", err)
		}
	})

	mux.HandleFunc("/scan/last", func(w http.ResponseWriter, r *http.Request) {
		scanDataMutex.Lock()
		defer scanDataMutex.Unlock()

		// Return last scanned code (for polling)
		response := map[string]interface{}{
			"code": lastScannedCode,
			"time": lastScanTime,
		}

		// Marshal response to bytes first to avoid partial writes on error
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
	})

	mux.HandleFunc("/scan/clear", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		scanDataMutex.Lock()
		lastScannedCode = ""
		lastScanTime = time.Time{}
		scanDataMutex.Unlock()

		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "cleared"}); err != nil {
			log.Printf("Failed to encode response: %v", err)
		}
	})

	mux.HandleFunc("/scanners/add", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			PortName string `json:"port_name"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if req.PortName == "" {
			http.Error(w, "port_name is required", http.StatusBadRequest)
			return
		}

		scannerName := fmt.Sprintf("Scanner_%s", sanitizePortName(req.PortName))

		// Check if scanner already exists
		config, err := loadConfig()
		if err != nil {
			log.Printf("Failed to load config: %v", err)
			config = defaultConfig()
		}

		allowListed := false
		for _, port := range config.ScannerPorts {
			if port == req.PortName {
				allowListed = true
				break
			}
		}
		if _, ok := sm.GetScanner(scannerName); ok {
			if !allowListed {
				config.ScannerPorts = append(config.ScannerPorts, req.PortName)
				if err := saveConfig(config); err != nil {
					log.Printf("Failed to save scanner allow-list: %v", err)
					http.Error(w, "Failed to save scanner configuration", http.StatusInternalServerError)
					return
				}
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			if err := json.NewEncoder(w).Encode(map[string]interface{}{
				"status": "exists",
				"name":   scannerName,
				"port":   req.PortName,
			}); err != nil {
				log.Printf("Failed to encode response: %v", err)
			}
			return
		}

		// Create scanner instance
		s := scanner.NewScanner(scannerName, req.PortName, 9600)

		// Register scan callback
		s.OnScan(func(data string) {
			scanDataMutex.Lock()
			lastScannedCode = data
			lastScanTime = time.Now()
			scanDataMutex.Unlock()
			log.Printf("📷 Scanned: %s", data)
		})

		// Try to open scanner
		if err := s.Open(); err != nil {
			log.Printf("Failed to open scanner %s: %v", scannerName, err)
			http.Error(w, fmt.Sprintf("Failed to open scanner: %v", err), http.StatusInternalServerError)
			return
		}
		if !allowListed {
			config.ScannerPorts = append(config.ScannerPorts, req.PortName)
			if err := saveConfig(config); err != nil {
				log.Printf("Failed to save scanner allow-list: %v", err)
				if closeErr := s.Close(); closeErr != nil {
					log.Printf("Failed to close scanner %s after config save failure: %v", scannerName, closeErr)
				}
				http.Error(w, "Failed to save scanner configuration", http.StatusInternalServerError)
				return
			}
		}
		sm.AddScanner(scannerName, s)

		log.Printf("Added scanner: %s (%s)", scannerName, req.PortName)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "added",
			"name":   scannerName,
			"port":   req.PortName,
		}); err != nil {
			log.Printf("Failed to encode response: %v", err)
		}
	})

	mux.HandleFunc("/scanners/remove", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			PortName string `json:"port_name"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if req.PortName == "" {
			http.Error(w, "port_name is required", http.StatusBadRequest)
			return
		}

		scannerName := fmt.Sprintf("Scanner_%s", sanitizePortName(req.PortName))
		if err := sm.RemoveScanner(scannerName); err != nil {
			log.Printf("Failed to remove scanner %s: %v", scannerName, err)
		}

		config, err := loadConfig()
		if err != nil {
			log.Printf("Failed to load config: %v", err)
			config = defaultConfig()
		}

		filtered := make([]string, 0, len(config.ScannerPorts))
		for _, port := range config.ScannerPorts {
			if port != req.PortName {
				filtered = append(filtered, port)
			}
		}
		config.ScannerPorts = filtered
		if err := saveConfig(config); err != nil {
			log.Printf("Failed to save scanner allow-list: %v", err)
			http.Error(w, "Failed to save scanner configuration", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "removed",
			"name":   scannerName,
			"port":   req.PortName,
		}); err != nil {
			log.Printf("Failed to encode response: %v", err)
		}
	})

	// OpenAPI spec endpoint
	mux.HandleFunc("/openapi.yaml", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/yaml")
		spec, err := loadOpenAPISpec()
		if err != nil {
			log.Printf("Failed to load OpenAPI spec: %v", err)
			http.Error(w, "OpenAPI spec not available", http.StatusInternalServerError)
			return
		}
		if _, err := w.Write(spec); err != nil {
			log.Printf("Failed to write OpenAPI spec: %v", err)
		}
	})

	// Scalar UI (modern API documentation)
	mux.HandleFunc("/docs", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		if _, err := w.Write([]byte(`
<!DOCTYPE html>
<html>
<head>
    <title>Idento Agent API Documentation</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
    <script id="api-reference" data-url="/openapi.yaml"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>
		`)); err != nil {
			log.Printf("Failed to write docs page: %v", err)
		}
	})

	// Setup CORS to allow requests from localhost web app
	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"http://localhost:5173", "http://localhost:3000"},
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type"},
		AllowCredentials: true,
	})

	handler := c.Handler(mux)

	fmt.Printf("\n========================================\n")
	fmt.Printf("🖨️  Idento Hardware Agent\n")
	fmt.Printf("========================================\n")
	fmt.Printf("Listening on: http://localhost:%s\n", *port)
	fmt.Printf("\n📄 Available printers: %d\n", len(pm.ListPrinters()))
	for _, name := range pm.ListPrinters() {
		fmt.Printf("  - %s\n", name)
	}
	fmt.Printf("\n📷 Available scanners: %d\n", len(sm.ListScanners()))
	for _, name := range sm.ListScanners() {
		fmt.Printf("  - %s\n", name)
	}
	fmt.Printf("========================================\n\n")

	server := &http.Server{
		Addr:              ":" + *port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func replacePlaceholder(template, key, value string) string {
	placeholder := "{{" + key + "}}"
	return strings.ReplaceAll(template, placeholder, value)
}

func sanitizePortName(portName string) string {
	// Convert /dev/tty.usbmodem14101 to usbmodem14101
	parts := strings.Split(portName, "/")
	name := parts[len(parts)-1]
	// Remove dots
	name = strings.ReplaceAll(name, ".", "_")
	return name
}
