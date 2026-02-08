package scanner

import (
	"bufio"
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
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
	closeOnce  sync.Once
	closed     uint32
}

// PortInfo describes a serial/COM port available for scanner usage.
type PortInfo struct {
	PortName     string `json:"port_name"`
	DisplayName  string `json:"display_name,omitempty"`
	DeviceType   string `json:"device_type,omitempty"`
	Transport    string `json:"transport,omitempty"`
	VendorID     string `json:"vendor_id,omitempty"`
	ProductID    string `json:"product_id,omitempty"`
	Manufacturer string `json:"manufacturer,omitempty"`
	Product      string `json:"product,omitempty"`
	SerialNumber string `json:"serial_number,omitempty"`
}

// Info describes an active scanner managed by the agent.
type Info struct {
	Name     string `json:"name"`
	PortName string `json:"port_name"`
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
	if err := port.SetReadTimeout(150 * time.Millisecond); err != nil {
		log.Printf("[SCANNER: %s] Failed to set read timeout: %v", s.Name, err)
	}

	s.serialPort = port
	log.Printf("[SCANNER: %s] Opened on port %s at %d baud", s.Name, s.Port, s.BaudRate)

	// Start listening for scans
	go s.listen()

	return nil
}

// Close closes the scanner connection
func (s *Scanner) Close() error {
	var err error
	s.closeOnce.Do(func() {
		atomic.StoreUint32(&s.closed, 1)
		if s.serialPort != nil {
			err = s.serialPort.Close()
		}
	})
	return err
}

// listen continuously reads from the scanner
func (s *Scanner) listen() {
	if s.serialPort == nil {
		return
	}

	reader := bufio.NewReader(s.serialPort)
	buffer := ""
	lastByte := time.Time{}
	var bufferMu sync.Mutex
	flushBuffer := func() {
		bufferMu.Lock()
		if buffer == "" {
			bufferMu.Unlock()
			return
		}
		scannedData := strings.TrimSpace(buffer)
		buffer = ""
		bufferMu.Unlock()
		if scannedData == "" {
			return
		}

		log.Printf("[SCANNER: %s] Scanned: %s", s.Name, scannedData)

		// Trigger callbacks
		for _, callback := range s.callbacks {
			go callback(scannedData)
		}
	}

	flushTicker := time.NewTicker(50 * time.Millisecond)
	defer flushTicker.Stop()
	flushDone := make(chan struct{})
	defer close(flushDone)

	go func() {
		for {
			select {
			case <-flushDone:
				return
			case <-flushTicker.C:
				if atomic.LoadUint32(&s.closed) == 1 {
					return
				}
				bufferMu.Lock()
				idle := !lastByte.IsZero() && buffer != "" && time.Since(lastByte) >= 80*time.Millisecond
				bufferMu.Unlock()
				if idle {
					flushBuffer()
				}
			}
		}
	}()

	for {
		b, err := reader.ReadByte()
		if err != nil {
			if atomic.LoadUint32(&s.closed) == 1 {
				return
			}
			if timeoutErr, ok := err.(interface{ Timeout() bool }); ok && timeoutErr.Timeout() {
				continue
			}
			if strings.Contains(err.Error(), "multiple Read calls return no data or error") {
				continue
			}
			log.Printf("[SCANNER: %s] Read error: %v", s.Name, err)
			time.Sleep(100 * time.Millisecond)
			continue
		}

		// Scanners typically send data ending with CR/LF.
		if b == '\n' || b == '\r' {
			flushBuffer()
			continue
		}

		bufferMu.Lock()
		buffer += string(b)
		lastByte = time.Now()
		bufferMu.Unlock()
	}
}

// OnScan registers a callback for when data is scanned
func (s *Scanner) OnScan(callback func(string)) {
	s.callbacks = append(s.callbacks, callback)
}

// DiscoverScanners finds available COM/serial ports for scanners.
func DiscoverScanners() ([]PortInfo, error) {
	ports, err := serial.GetPortsList()
	if err != nil {
		return nil, fmt.Errorf("failed to get ports list: %w", err)
	}

	var scannerPorts []PortInfo
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
			info := PortInfo{
				PortName:   port,
				DeviceType: "serial",
			}
			if strings.Contains(port, "ttyUSB") || strings.Contains(port, "usbserial") || strings.Contains(port, "usbmodem") {
				info.Transport = "usb"
			}
			if info.Transport != "" {
				info.DisplayName = fmt.Sprintf("%s (%s)", port, info.Transport)
			} else {
				info.DisplayName = port
			}
			scannerPorts = append(scannerPorts, info)
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

func (m *Manager) GetScanner(name string) (*Scanner, bool) {
	scanner, ok := m.scanners[name]
	return scanner, ok
}

func (m *Manager) ListScanners() []string {
	names := make([]string, 0, len(m.scanners))
	for name := range m.scanners {
		names = append(names, name)
	}
	return names
}

func (m *Manager) ListScannerInfos() []Info {
	infos := make([]Info, 0, len(m.scanners))
	for name, s := range m.scanners {
		infos = append(infos, Info{Name: name, PortName: s.Port})
	}
	return infos
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
