package printer

import (
	"fmt"
	"net"
	"strings"
	"time"

	"go.bug.st/serial"
)

// SerialPrinter handles USB/COM port printers
type SerialPrinter struct {
	Name     string
	PortName string
	port     serial.Port
}

func NewSerialPrinter(name, portName string) (*SerialPrinter, error) {
	mode := &serial.Mode{
		BaudRate: 9600, // Standard for most label printers
		Parity:   serial.NoParity,
		DataBits: 8,
		StopBits: serial.OneStopBit,
	}

	port, err := serial.Open(portName, mode)
	if err != nil {
		return nil, fmt.Errorf("failed to open port %s: %w", portName, err)
	}

	return &SerialPrinter{
		Name:     name,
		PortName: portName,
		port:     port,
	}, nil
}

func (p *SerialPrinter) SendRaw(data []byte) error {
	if p.port == nil {
		return fmt.Errorf("printer port not initialized")
	}

	_, err := p.port.Write(data)
	if err != nil {
		return fmt.Errorf("failed to send data to printer: %w", err)
	}

	// Allow printer time to process
	time.Sleep(100 * time.Millisecond)
	return nil
}

func (p *SerialPrinter) Status() (string, error) {
	// ZPL status command: ~HQES
	// For simplicity, return "Ready" in MVP
	return "Ready", nil
}

func (p *SerialPrinter) Close() error {
	if p.port != nil {
		return p.port.Close()
	}
	return nil
}

// NetworkPrinter handles Ethernet/WiFi printers
type NetworkPrinter struct {
	Name    string
	Address string // IP:Port (e.g., "192.168.1.100:9100")
}

func NewNetworkPrinter(name, address string) *NetworkPrinter {
	return &NetworkPrinter{
		Name:    name,
		Address: address,
	}
}

// NewNetworkPrinterFromIP creates a network printer from separate IP and port
func NewNetworkPrinterFromIP(name, ip string, port int) *NetworkPrinter {
	address := fmt.Sprintf("%s:%d", ip, port)
	return NewNetworkPrinter(name, address)
}

func (p *NetworkPrinter) SendRaw(data []byte) error {
	conn, err := net.DialTimeout("tcp", p.Address, 5*time.Second)
	if err != nil {
		return fmt.Errorf("failed to connect to printer at %s: %w", p.Address, err)
	}
	defer func() { _ = conn.Close() }()

	_, err = conn.Write(data)
	if err != nil {
		return fmt.Errorf("failed to send data to printer: %w", err)
	}

	return nil
}

func (p *NetworkPrinter) Status() (string, error) {
	// Try to connect to verify status
	conn, err := net.DialTimeout("tcp", p.Address, 2*time.Second)
	if err != nil {
		return "Offline", nil
	}
	_ = conn.Close()
	return "Ready", nil
}

// DiscoverSerialPrinters finds available serial ports (potential printers)
func DiscoverSerialPrinters() ([]string, error) {
	ports, err := serial.GetPortsList()
	if err != nil {
		return nil, err
	}

	// Filter out Bluetooth ports and other non-printer devices
	var printerPorts []string
	for _, port := range ports {
		portLower := strings.ToLower(port)
		// Skip Bluetooth ports
		if strings.Contains(portLower, "bluetooth") {
			continue
		}
		printerPorts = append(printerPorts, port)
	}

	return printerPorts, nil
}
