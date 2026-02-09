package printer

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// PrinterInterface defines the basic operations for a printer
type PrinterInterface interface {
	SendRaw(data []byte) error
	Status() (string, error)
}

// MockPrinter simulates a printer for development without hardware
type MockPrinter struct {
	Name string
}

func NewMockPrinter(name string) *MockPrinter {
	return &MockPrinter{Name: name}
}

func (p *MockPrinter) SendRaw(data []byte) error {
	fmt.Printf("\n[PRINTER: %s] >>> Printing Data (%d bytes) <<<\n", p.Name, len(data))
	// Print a preview of the data (e.g. ZPL commands)
	content := string(data)
	lines := strings.Split(content, "\n")
	for _, line := range lines {
		if len(line) > 0 {
			fmt.Printf("   %s\n", line)
		}
	}
	fmt.Println(">>> Print Job Complete <<<")

	// Simulate delay
	time.Sleep(500 * time.Millisecond)
	return nil
}

func (p *MockPrinter) Status() (string, error) {
	return "Ready", nil
}

// Manager handles a collection of printers
type Manager struct {
	printers map[string]PrinterInterface
}

func NewManager() *Manager {
	return &Manager{
		printers: make(map[string]PrinterInterface),
	}
}

func (m *Manager) AddPrinter(name string, printer PrinterInterface) {
	m.printers[name] = printer
}

func (m *Manager) GetPrinter(name string) (PrinterInterface, error) {
	p, ok := m.printers[name]
	if !ok {
		return nil, fmt.Errorf("printer not found: %s", name)
	}
	return p, nil
}

func (m *Manager) ListPrinters() []string {
	list := make([]string, 0, len(m.printers))
	for name := range m.printers {
		list = append(list, name)
	}
	sort.Strings(list)
	return list
}

// RemovePrinter removes a printer by name. It is a no-op if the name is not found.
func (m *Manager) RemovePrinter(name string) {
	delete(m.printers, name)
}
