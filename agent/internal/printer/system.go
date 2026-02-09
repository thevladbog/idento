package printer

import (
	"fmt"
	"log"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
)

// safePrinterName allows only chars safe for lp/lpstat args (no shell or path injection).
var safePrinterName = regexp.MustCompile(`^[a-zA-Z0-9 _-]+$`)

func sanitizePrinterNameForExec(name string) (string, error) {
	if name == "" {
		return "", fmt.Errorf("printer name is empty")
	}
	if !safePrinterName.MatchString(name) {
		return "", fmt.Errorf("printer name contains invalid characters: %q", name)
	}
	return name, nil
}

// DiscoverSystemPrinters finds printers installed in the operating system
func DiscoverSystemPrinters() ([]string, error) {
	switch runtime.GOOS {
	case "darwin":
		return discoverMacOSPrinters()
	case "linux":
		return discoverLinuxPrinters()
	case "windows":
		return discoverWindowsPrinters()
	default:
		return nil, fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}
}

// discoverMacOSPrinters discovers printers on macOS using lpstat.
// Uses full path /usr/bin/lpstat to avoid PATH issues when running as a service.
// Falls back to lpstat -a if -p fails or returns empty; logs a warning if no printers found.
func discoverMacOSPrinters() ([]string, error) {
	// Use full path so discovery works when PATH is minimal (e.g. launchd)
	cmd := exec.Command("/usr/bin/lpstat", "-p")
	output, err := cmd.Output()
	if err != nil || len(output) == 0 {
		// Fallback: all printers (lpstat -a), first column is printer name
		cmd = exec.Command("/usr/bin/lpstat", "-a")
		output, err = cmd.Output()
		if err != nil {
			log.Printf("lpstat failed: %v", err)
			return nil, fmt.Errorf("failed to execute lpstat: %w", err)
		}
	}

	var printers []string
	seen := make(map[string]bool)
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// lpstat -p: "printer PrinterName is idle"
		if strings.HasPrefix(line, "printer ") {
			parts := strings.Fields(line)
			if len(parts) >= 2 && !seen[parts[1]] {
				seen[parts[1]] = true
				printers = append(printers, parts[1])
			}
			continue
		}
		// lpstat -a: "PrinterName accepting requests since ..."
		parts := strings.Fields(line)
		if len(parts) >= 1 && !seen[parts[0]] {
			seen[parts[0]] = true
			printers = append(printers, parts[0])
		}
	}

	if len(printers) == 0 {
		log.Printf("warning: no system printers found (lpstat returned empty or no known format)")
	}
	return printers, nil
}

// discoverLinuxPrinters discovers printers on Linux using lpstat (CUPS)
func discoverLinuxPrinters() ([]string, error) {
	// Same as macOS - both use CUPS
	cmd := exec.Command("lpstat", "-p")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to execute lpstat: %w", err)
	}

	var printers []string
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		if strings.HasPrefix(line, "printer ") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				printers = append(printers, parts[1])
			}
		}
	}

	return printers, nil
}

// discoverWindowsPrinters discovers printers on Windows.
// Prefers PowerShell (Get-Printer) for reliable one-name-per-line output; falls back to wmic.
func discoverWindowsPrinters() ([]string, error) {
	// Primary: PowerShell, one printer name per line, no table header
	cmd := exec.Command("powershell", "-NoProfile", "-Command", "Get-Printer | Select-Object -ExpandProperty Name")
	output, err := cmd.Output()
	if err == nil && len(output) > 0 {
		var printers []string
		lines := strings.Split(strings.TrimSpace(string(output)), "\n")
		for _, line := range lines {
			name := strings.TrimSpace(line)
			if name != "" {
				printers = append(printers, name)
			}
		}
		if len(printers) > 0 {
			return printers, nil
		}
	}

	// Fallback: wmic (deprecated but still present on many Windows 10/11)
	cmd = exec.Command("wmic", "printer", "get", "name")
	output, err = cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to discover printers (PowerShell and wmic): %w", err)
	}

	var printers []string
	lines := strings.Split(string(output), "\n")
	// wmic output: first line is "Name", then rows; columns may be padded
	for i, line := range lines {
		if i == 0 && strings.TrimSpace(line) == "Name" {
			continue
		}
		// Line may be "PrinterName    " or multi-column; take first column
		fields := strings.Fields(line)
		if len(fields) >= 1 {
			name := fields[0]
			if name != "Name" && name != "" {
				printers = append(printers, name)
			}
		}
	}

	if len(printers) == 0 {
		log.Printf("warning: no system printers found on Windows")
	}
	return printers, nil
}

// SystemPrinter implements PrinterInterface for system-installed printers
type SystemPrinter struct {
	Name string
}

func NewSystemPrinter(name string) *SystemPrinter {
	return &SystemPrinter{Name: name}
}

func (p *SystemPrinter) SendRaw(data []byte) error {
	log.Printf("[SYSTEM PRINTER: %s] Sending %d bytes", p.Name, len(data))

	name, err := sanitizePrinterNameForExec(p.Name)
	if err != nil {
		return err
	}

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin", "linux":
		// Use lp command on Unix systems
		cmd = exec.Command("lp", "-d", name, "-o", "raw", "-") // #nosec G204 -- name validated by sanitizePrinterNameForExec
		cmd.Stdin = strings.NewReader(string(data))
	case "windows":
		// For Windows, we'd need to write to a temp file and use print command
		// Or use a more sophisticated approach with Windows API
		return fmt.Errorf("direct printing on Windows requires additional implementation")
	default:
		return fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("[SYSTEM PRINTER: %s] Print failed: %v, output: %s", p.Name, err, string(output))
		return fmt.Errorf("failed to print: %w", err)
	}

	log.Printf("[SYSTEM PRINTER: %s] Print job sent successfully", p.Name)
	return nil
}

// PrintPDF sends a PDF file to the system printer
// This is for office/label printers that support PDF
func (p *SystemPrinter) PrintPDF(pdfData []byte) error {
	log.Printf("[SYSTEM PRINTER: %s] Printing PDF (%d bytes)", p.Name, len(pdfData))

	name, err := sanitizePrinterNameForExec(p.Name)
	if err != nil {
		return err
	}

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin", "linux":
		// Use lp command without -o raw for PDF
		cmd = exec.Command("lp", "-d", name, "-") // #nosec G204 -- name validated by sanitizePrinterNameForExec
		cmd.Stdin = strings.NewReader(string(pdfData))
	case "windows":
		// For Windows, write to temp file and use default print command
		// This requires additional implementation
		return fmt.Errorf("PDF printing on Windows requires additional implementation")
	default:
		return fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("[SYSTEM PRINTER: %s] PDF print failed: %v, output: %s", p.Name, err, string(output))
		return fmt.Errorf("failed to print PDF: %w", err)
	}

	log.Printf("[SYSTEM PRINTER: %s] PDF print job sent successfully", p.Name)
	return nil
}

// SupportsPDF returns true if the printer supports PDF printing
func (p *SystemPrinter) SupportsPDF() bool {
	// System printers generally support PDF
	return runtime.GOOS == "darwin" || runtime.GOOS == "linux"
}

func (p *SystemPrinter) Status() (string, error) {
	name, err := sanitizePrinterNameForExec(p.Name)
	if err != nil {
		return "Unknown", err
	}
	switch runtime.GOOS {
	case "darwin", "linux":
		cmd := exec.Command("lpstat", "-p", name) // #nosec G204 -- name validated by sanitizePrinterNameForExec
		output, err := cmd.Output()
		if err != nil {
			return "Unknown", err
		}
		// Parse output to determine status
		status := string(output)
		if strings.Contains(status, "idle") {
			return "Ready", nil
		} else if strings.Contains(status, "printing") {
			return "Printing", nil
		}
		return "Unknown", nil
	case "windows":
		// Windows status check would require WMI query
		return "Unknown", nil
	default:
		return "Unknown", fmt.Errorf("unsupported OS")
	}
}
