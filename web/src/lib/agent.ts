import axios from "axios";

const AGENT_URL = "http://localhost:12345";

export interface PrintRequest {
  printer_name: string;
  zpl: string; // Raw ZPL data
}

export interface PrintPDFRequest {
  printer_name: string;
  pdf_base64: string; // Base64 encoded PDF
}

export const agentApi = {
  checkHealth: async () => {
    try {
      const response = await axios.get(`${AGENT_URL}/health`, {
        timeout: 2000,
      });
      return response.status === 200;
    } catch {
      return false;
    }
  },

  getPrinters: async () => {
    try {
      const response = await axios.get<string[]>(`${AGENT_URL}/printers`);
      return response.data;
    } catch (error) {
      console.error("Failed to fetch printers", error);
      return [];
    }
  },

  print: async (request: PrintRequest) => {
    const response = await axios.post(`${AGENT_URL}/print`, request);
    return response.data;
  },

  printPDF: async (request: PrintPDFRequest) => {
    const response = await axios.post(`${AGENT_URL}/print-pdf`, request);
    return response.data;
  },

  checkPrinterCapabilities: async (printerName: string) => {
    try {
      // System printers support PDF, label printers (Network_*, Serial_*) support ZPL
      const isLabelPrinter =
        printerName.includes("Network_") ||
        printerName.includes("Serial_") ||
        printerName.toLowerCase().includes("zebra") ||
        printerName.toLowerCase().includes("brother");

      return {
        supportsPDF: !isLabelPrinter,
        supportsZPL: isLabelPrinter,
        isLabelPrinter: isLabelPrinter,
      };
    } catch (error) {
      console.error("Failed to check printer capabilities", error);
      return { supportsPDF: false, supportsZPL: true, isLabelPrinter: true };
    }
  },

  getScanners: async () => {
    try {
      const response = await axios.get<string[]>(`${AGENT_URL}/scanners`);
      return response.data;
    } catch (error) {
      console.error("Failed to fetch scanners", error);
      return [];
    }
  },

  getLastScan: async () => {
    try {
      const response = await axios.get<{ code: string; time: string }>(
        `${AGENT_URL}/scan/last`
      );
      return response.data;
    } catch (error) {
      console.error("Failed to get last scan", error);
      return null;
    }
  },

  clearLastScan: async () => {
    try {
      await axios.post(`${AGENT_URL}/scan/clear`);
    } catch (error) {
      console.error("Failed to clear scan", error);
    }
  },

  addNetworkPrinter: async (name: string, ip: string, port: number = 9100) => {
    try {
      const response = await axios.post(`${AGENT_URL}/printers/add`, {
        name,
        ip,
        port,
      });
      return response.data;
    } catch (error) {
      console.error("Failed to add network printer", error);
      throw error;
    }
  },

  getFonts: async () => {
    try {
      const response = await axios.get<{
        built_in: Array<{ id: string; name: string; type: string }>;
        custom_examples: string[];
        note: string;
      }>(`${AGENT_URL}/printers/fonts`);
      return response.data;
    } catch (error) {
      console.error("Failed to fetch fonts", error);
      return null;
    }
  },

  getPrinterFonts: async (printerName: string) => {
    try {
      const response = await axios.get<{
        printer: string;
        resident_fonts: string[];
        loaded_fonts_examples: string[];
        queried: boolean;
        query_method: string;
        note: string;
        instructions?: string;
        warning?: string;
        error?: string;
      }>(`${AGENT_URL}/printers/${encodeURIComponent(printerName)}/fonts`);
      return response.data;
    } catch (error) {
      console.error("Failed to fetch printer fonts", error);
      return null;
    }
  },

  addComScanner: async (portName: string) => {
    try {
      const response = await axios.post(`${AGENT_URL}/scanners/add`, {
        port_name: portName,
      });
      return response.data;
    } catch (error) {
      console.error("Failed to add COM scanner", error);
      throw error;
    }
  },

  testScanner: async (scannerId: string) => {
    try {
      const response = await axios.post(
        `${AGENT_URL}/scanners/${encodeURIComponent(scannerId)}/test`
      );
      return response.data;
    } catch (error) {
      console.error("Failed to test scanner", error);
      throw error;
    }
  },

  getAvailablePorts: async () => {
    try {
      const response = await axios.get<string[]>(`${AGENT_URL}/scanners/ports`);
      return response.data;
    } catch (error) {
      console.error("Failed to fetch available ports", error);
      return [];
    }
  },
};
