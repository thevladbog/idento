// ZPL Generation Utilities
import {
  generateZPLWithImageText,
  needsImageRendering,
} from "./zpl-image-text";

export interface ZPLConfig {
  widthMM: number;
  heightMM: number;
  dpi: 203 | 300;
  useImageForCyrillic?: boolean; // Auto-convert Cyrillic to images
}

export interface BadgeElement {
  id: string;
  type: "text" | "qrcode" | "barcode" | "line" | "box";
  x: number; // mm
  y: number; // mm
  width?: number; // mm (for text zones, qr codes)
  height?: number; // mm
  fontSize?: number; // points
  text?: string;
  source?: string; // field name like 'first_name'
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  rotation?: 0 | 90 | 180 | 270;
  fontFamily?: "0" | "A" | "B" | "D" | "E"; // ZPL built-in font codes
  customFont?: string; // Custom/TrueType font name (e.g., "TT0003M_" or "ARIAL.TTF")
  bold?: boolean;
  maxLines?: number;
}

/**
 * Convert millimeters to dots based on DPI
 */
export function mmToDots(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

/**
 * Convert points to dots based on DPI
 */
export function pointsToDots(points: number, dpi: number): number {
  return Math.round((points / 72) * dpi);
}

/**
 * Get ZPL font code from size
 */
function getZPLFont(fontSize: number, _bold: boolean = false): string {
  // ZPL fonts: 0 (smallest) to E (largest)
  // Map font size to ZPL font
  if (fontSize <= 10) return "0";
  if (fontSize <= 14) return "A";
  if (fontSize <= 18) return "B";
  if (fontSize <= 24) return "D";
  if (fontSize <= 32) return "E";
  return "E"; // Max size
}

/**
 * Get ZPL alignment code
 */
function getZPLAlignment(align: "left" | "center" | "right" = "left"): string {
  switch (align) {
    case "left":
      return "L";
    case "center":
      return "C";
    case "right":
      return "R";
    default:
      return "L";
  }
}

/**
 * Generate ZPL command for a text element
 */
async function generateTextZPL(
  element: BadgeElement,
  data: Record<string, unknown>,
  dpi: number,
  useImageForCyrillic: boolean = true
): Promise<string> {
  const x = mmToDots(element.x, dpi);
  let y = mmToDots(element.y, dpi);

  // Get text content
  let textContent = element.text || "";
  if (element.source && data[element.source]) {
    textContent = String(data[element.source]);
  }

  // Use image rendering when text has non-Latin script OR when custom font is set (so one font for all text)
  const useImageRendering =
    (useImageForCyrillic && needsImageRendering(textContent)) ||
    !!(element.customFont && element.customFont.trim());
  if (useImageRendering) {
    // Render text as image for full font support
    const fontSize = element.fontSize || 12;
    const fontSizePixels = Math.round((fontSize / 72) * dpi);

    const fontFamily =
      element.customFont || mapZPLFontToSystemFont(element.fontFamily);
    const fontWeight = element.bold ? "bold" : "normal";

    return await generateZPLWithImageText(textContent, x, y, {
      fontFamily,
      fontSize: fontSizePixels,
      fontWeight,
    });
  }

  // Escape special ZPL characters for regular text
  // Note: With ^CI28 (UTF-8), Cyrillic and other Unicode characters are supported directly
  // BUT built-in ZPL fonts don't support them - that's why we use images above
  textContent = textContent
    .replace(/\\/g, "\\\\") // Escape backslashes
    .replace(/\^/g, "\\^") // Escape caret (ZPL command prefix)
    .replace(/~/g, "\\~"); // Escape tilde (special character in ZPL)

  const fontSize = element.fontSize || 12;
  const rotation = element.rotation || 0;
  const fontHeight = pointsToDots(fontSize, dpi);
  const fontWidth = fontHeight; // Same as height by default

  // Adjust Y position for vertical alignment
  if (element.valign && element.height) {
    const heightDots = mmToDots(element.height, dpi);
    const fontHeightDots = pointsToDots(fontSize, dpi);

    if (element.valign === "middle") {
      y += Math.round((heightDots - fontHeightDots) / 2);
    } else if (element.valign === "bottom") {
      y += heightDots - fontHeightDots;
    }
    // 'top' is default, no adjustment needed
  }

  // Convert rotation to ZPL format (N=0, R=90, I=180, B=270)
  let rotCode = "N";
  if (rotation === 90) rotCode = "R";
  else if (rotation === 180) rotCode = "I";
  else if (rotation === 270) rotCode = "B";

  // Generate font command
  let fontCommand = "";
  if (element.customFont && element.customFont.trim()) {
    // Use custom/TrueType font: ^A@<orientation>,<height>,<width>,<font_name>
    fontCommand = `^A@${rotCode},${fontHeight},${fontWidth},${element.customFont.trim()}`;
  } else {
    // Use built-in ZPL font: ^A<font><orientation>,<height>,<width>
    const font = element.fontFamily || getZPLFont(fontSize, element.bold);
    fontCommand = `^A${font}${rotCode},${fontHeight},${fontWidth}`;
  }

  let zpl = "";

  // If width is specified (text zone), use block text with alignment
  if (element.width) {
    const width = mmToDots(element.width, dpi);
    const maxLines = element.maxLines || 1;
    const align = getZPLAlignment(element.align);

    // ^FB = Field Block
    // ^FB<width>,<max lines>,<line spacing>,<justification>,<hanging indent>
    zpl = `^FO${x},${y}^FB${width},${maxLines},0,${align},0${fontCommand}^FD${textContent}^FS`;
  } else {
    // Simple text field
    zpl = `^FO${x},${y}${fontCommand}^FD${textContent}^FS`;
  }

  return zpl;
}

/**
 * Generate ZPL command for a QR code
 */
function generateQRCodeZPL(
  element: BadgeElement,
  data: Record<string, unknown>,
  dpi: number
): string {
  const x = mmToDots(element.x, dpi);
  const y = mmToDots(element.y, dpi);

  // Get QR data
  let qrData = element.text || "";
  if (element.source && data[element.source]) {
    qrData = String(data[element.source]);
  }

  // Calculate module size (size of each QR module)
  const widthMM = element.width || 20;
  const moduleSize = Math.max(2, Math.round(mmToDots(widthMM, dpi) / 30)); // Roughly 30 modules per QR

  // ^BQ = QR Code
  // ^BQ<orientation>,<model>,<magnification>
  // Model 2 is most common (QR Code Model 2)
  // Magnification 1-10
  const zpl = `^FO${x},${y}^BQN,2,${moduleSize}^FDQA,${qrData}^FS`;

  return zpl;
}

/**
 * Generate ZPL command for a barcode (Code 128)
 */
function generateBarcodeZPL(
  element: BadgeElement,
  data: Record<string, unknown>,
  dpi: number
): string {
  const x = mmToDots(element.x, dpi);
  const y = mmToDots(element.y, dpi);

  let barcodeData = element.text || "";
  if (element.source && data[element.source]) {
    barcodeData = String(data[element.source]);
  }

  const heightMM = element.height || 10;
  const height = mmToDots(heightMM, dpi);

  // ^BC = Code 128
  // ^BC<orientation>,<height>,<print interpretation line>,<print interpretation line above>,<UCC check digit>
  const zpl = `^FO${x},${y}^BCN,${height},Y,N,N^FD${barcodeData}^FS`;

  return zpl;
}

/**
 * Generate ZPL command for a line
 */
function generateLineZPL(element: BadgeElement, dpi: number): string {
  const x = mmToDots(element.x, dpi);
  const y = mmToDots(element.y, dpi);
  const width = mmToDots(element.width || 10, dpi);
  const thickness = 2; // dots

  // ^GB = Graphic Box (line when height is small)
  const zpl = `^FO${x},${y}^GB${width},${thickness},${thickness}^FS`;

  return zpl;
}

/**
 * Generate ZPL command for a box/rectangle
 */
function generateBoxZPL(element: BadgeElement, dpi: number): string {
  const x = mmToDots(element.x, dpi);
  const y = mmToDots(element.y, dpi);
  const width = mmToDots(element.width || 10, dpi);
  const height = mmToDots(element.height || 10, dpi);
  const thickness = 2;

  const zpl = `^FO${x},${y}^GB${width},${height},${thickness}^FS`;

  return zpl;
}

/**
 * Map ZPL font codes to system font names for image rendering
 */
function mapZPLFontToSystemFont(zplFont?: string): string {
  // Default system fonts that support Cyrillic
  switch (zplFont) {
    case "0":
    case "A":
    case "B":
      return "Arial"; // Sans-serif, supports Cyrillic
    case "D":
    case "E":
      return "Arial Black"; // Bold sans-serif
    case "F":
    case "G":
      return "Courier New"; // Monospace, supports Cyrillic
    default:
      return "Arial"; // Default fallback
  }
}

/**
 * Generate complete ZPL document from badge template
 */
export async function generateZPL(
  config: ZPLConfig,
  elements: BadgeElement[],
  data: Record<string, unknown>
): Promise<string> {
  const { widthMM, heightMM, dpi, useImageForCyrillic = true } = config;

  // Calculate label size in dots
  const widthDots = mmToDots(widthMM, dpi);
  const heightDots = mmToDots(heightMM, dpi);

  let zpl = "";

  // ZPL Header
  zpl += "^XA\n"; // Start format
  zpl += "^CI28\n"; // Set encoding to UTF-8 for Cyrillic and other Unicode characters

  // Set label size and print speed
  zpl += `^PW${widthDots}\n`; // Print width
  zpl += `^LL${heightDots}\n`; // Label length
  zpl += "^PR4\n"; // Print speed (4 inches/sec, adjust as needed)
  zpl += "^LH0,0\n"; // Label home position

  // Generate elements
  for (const element of elements) {
    let elementZPL = "";

    switch (element.type) {
      case "text":
        elementZPL = await generateTextZPL(
          element,
          data,
          dpi,
          useImageForCyrillic
        );
        break;
      case "qrcode":
        elementZPL = generateQRCodeZPL(element, data, dpi);
        break;
      case "barcode":
        elementZPL = generateBarcodeZPL(element, data, dpi);
        break;
      case "line":
        elementZPL = generateLineZPL(element, dpi);
        break;
      case "box":
        elementZPL = generateBoxZPL(element, dpi);
        break;
    }

    if (elementZPL) {
      zpl += elementZPL + "\n";
    }
  }

  // ZPL Footer
  zpl += "^XZ\n"; // End format

  return zpl;
}

/**
 * Preview: replace data placeholders in template
 */
export function previewTemplate(
  elements: BadgeElement[],
  sampleData: Record<string, unknown>
): BadgeElement[] {
  return elements.map((el) => {
    if (el.type === "text" && el.source && sampleData[el.source]) {
      return {
        ...el,
        text: String(sampleData[el.source]),
      };
    }
    return el;
  });
}
