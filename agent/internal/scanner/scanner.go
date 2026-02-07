package scanner

import (
	"bufio"
	"fmt"
	"log"
	"strings"
	"time"

	"go.bug.st/serial"
)

// Scanner represents a barcode/QR scanner
type Scanner struct {
	Name       string
	Port       string
	BaudRate   int
	serialPort serial.Port
	callbacks  []func(string)
}

// NewScanner creates a new scanner instance
func NewScanner(name, port string, baudRate int) *Scanner {
	if baudRate == 0 {
		baudRate = 9600 // Default baud rate for most scanners
	}

	return &Scanner{
		Name:      name,
		Port:      port,
		BaudRate:  baudRate,
		callbacks: make([]func(string), 0),
	}
}

// Open opens the scanner connection
func (s *Scanner) Open() error {
	mode := &serial.Mode{
		BaudRate: s.BaudRate,
		Parity:   serial.NoParity,
		DataBits: 8,
		StopBits: serial.OneStopBit,
	}

	port, err := serial.Open(s.Port, mode)
	if err != nil {
		return fmt.Errorf("failed to open scanner port %s: %w", s.Port, err)
	}

	s.serialPort = port
	log.Printf("[SCANNER: %s] Opened on port %s at %d baud", s.Name, s.Port, s.BaudRate)

	// Start listening for scans
	go s.listen()

	return nil
}

// Close closes the scanner connection
func (s *Scanner) Close() error {
	if s.serialPort != nil {
		return s.serialPort.Close()
	}
	return nil
}

// listen continuously reads from the scanner
func (s *Scanner) listen() {
	if s.serialPort == nil {
		return
	}

	reader := bufio.NewReader(s.serialPort)
	buffer := ""

	for {
		data, err := reader.ReadString('\n')
		if err != nil {
			log.Printf("[SCANNER: %s] Read error: %v", s.Name, err)
			time.Sleep(100 * time.Millisecond)
			continue
		}

		// Scanners typically send data ending with CR/LF
		data = strings.TrimSpace(data)
		if data == "" {
			continue
		}

		// Accumulate data (some scanners send in chunks)
		buffer += data

		// If we have a complete scan (contains expected delimiter or sufficient length)
		if len(buffer) > 0 {
			scannedData := buffer
			buffer = ""

			log.Printf("[SCANNER: %s] Scanned: %s", s.Name, scannedData)

			// Trigger callbacks
			for _, callback := range s.callbacks {
				go callback(scannedData)
			}
		}
	}
}

// OnScan registers a callback for when data is scanned
func (s *Scanner) OnScan(callback func(string)) {
	s.callbacks = append(s.callbacks, callback)
}

// DiscoverScanners finds available COM/serial ports for scanners
func DiscoverScanners() ([]string, error) {
	ports, err := serial.GetPortsList()
	if err != nil {
		return nil, fmt.Errorf("failed to get ports list: %w", err)
	}

	var scannerPorts []string
	for _, port := range ports {
		// Filter for typical scanner ports
		// COM ports on Windows: COM1, COM2, etc.
		// USB serial on Mac: /dev/tty.usbserial*, /dev/tty.usbmodem*
		// USB serial on Linux: /dev/ttyUSB*, /dev/ttyACM*
		if strings.Contains(port, "COM") ||
			strings.Contains(port, "ttyUSB") ||
			strings.Contains(port, "ttyACM") ||
			strings.Contains(port, "usbserial") ||
			strings.Contains(port, "usbmodem") {
			scannerPorts = append(scannerPorts, port)
		}
	}

	return scannerPorts, nil
}

// Manager manages multiple scanners
type Manager struct {
	scanners map[string]*Scanner
}

func NewManager() *Manager {
	return &Manager{
		scanners: make(map[string]*Scanner),
	}
}

func (m *Manager) AddScanner(name string, scanner *Scanner) {
	m.scanners[name] = scanner
}

func (m *Manager) GetScanner(name string) (*Scanner, error) {
	scanner, ok := m.scanners[name]
	if !ok {
		return nil, fmt.Errorf("scanner not found: %s", name)
	}
	return scanner, nil
}

func (m *Manager) ListScanners() []string {
	names := make([]string, 0, len(m.scanners))
	for name := range m.scanners {
		names = append(names, name)
	}
	return names
}

func (m *Manager) RemoveScanner(name string) error {
	scanner, ok := m.scanners[name]
	if ok {
		if closeErr := scanner.Close(); closeErr != nil {
			fmt.Printf("Failed to close scanner: %v\n", closeErr)
		}
		delete(m.scanners, name)
	}
	return nil
}
