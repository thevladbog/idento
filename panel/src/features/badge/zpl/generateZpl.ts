// ZPL generator -- parity-first port of web/src/utils/zpl.ts's
// `generateZPL` pipeline (+ web/src/utils/zpl-image-text.ts for the raster
// branch) into the panel editor (P3.2 Task 1).
//
// This is a PORT, not a redesign: every documented limitation of the web
// pipeline is preserved on purpose, most importantly that the raster branch
// (fires when text needs non-Latin-script image rendering OR a customFont is
// set) returns immediately and silently DROPS rotation/valign/^FB-wrap/
// maxLines -- see generateTextZPL below. Deviating from that is a plan
// violation, not an improvement.
//
// The rasterizer itself is injected via `deps.rasterizeText` because jsdom
// (this task's test environment) has no canvas; the real browser canvas
// rasterizer is Task 5's module. This file and its tests are 100%
// jsdom-testable.
import { resolveElementText } from "../canvasMath";
import type { BadgeConfig, BadgeElement } from "../templateTypes";
import { buildGfaCommand, type RasterResult } from "./zplImage";

export type { RasterResult } from "./zplImage";

// Raw element shape generation reads from: panel's typed `BadgeElement` plus
// the one field the web editor's raw JSON element can carry that the panel's
// typed view doesn't promote (`bold` -- deliberately excluded from
// BadgeElement per P3.1 reconciliation #1; only THIS raster path reads it).
// `customFont` was promoted into the typed `BadgeElement` by P3.2 Task 4
// (templateTypes.ts), so it's no longer widened here. `valign` is already on
// `BadgeElement` as a plain `string` (templateTypes.ts:28) so it's listed
// here for self-documentation but isn't widening anything.
export type RawBadgeElement = BadgeElement & {
  bold?: boolean;
  valign?: string;
};

export type RasterizeTextFn = (
  text: string,
  opts: { fontFamily: string; fontSizePx: number; fontWeight: "bold" | "normal" },
) => Promise<RasterResult>;

export interface GenerateZplDeps {
  rasterizeText: RasterizeTextFn;
}

/** Convert millimeters to dots based on DPI. Ports web/src/utils/zpl.ts:36-38. */
export function mmToDots(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

/** Convert points to dots based on DPI. Ports web/src/utils/zpl.ts:43-45. */
export function pointsToDots(points: number, dpi: number): number {
  return Math.round((points / 72) * dpi);
}

/**
 * Escape ZPL special characters in data destined for a ^FD (Field Data)
 * command. Ports web/src/utils/zpl.ts:66-71 verbatim -- backslash, then
 * caret, then tilde, in that order. Deliberately does NOT use ^FH
 * (hex-escape) framing; this is web's own escaping convention, preserved for
 * parity (reconciliation #8).
 */
export function escapeZplData(value: string): string {
  return value
    .replace(/\\/g, "\\\\") // Escape backslashes
    .replace(/\^/g, "\\^") // Escape caret (ZPL command prefix)
    .replace(/~/g, "\\~"); // Escape tilde (special character in ZPL)
}

/**
 * True when text contains Cyrillic, CJK, or Arabic characters that built-in
 * ZPL fonts can't render, so it must be rasterized to an image instead.
 * Ports web/src/utils/zpl-image-text.ts:157-160 verbatim.
 */
export function needsImageRendering(text: string): boolean {
  return /[Ѐ-ӿ一-鿿؀-ۿ]/.test(text);
}

/**
 * Map ZPL built-in font codes to system font names for image rendering.
 * Ports web/src/utils/zpl.ts:275-291 verbatim.
 */
export function mapZPLFontToSystemFont(zplFont?: string): string {
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
 * Get ZPL font code from size. Ports web/src/utils/zpl.ts:50-59 (internal,
 * not exported there either).
 */
function getZPLFont(fontSize: number): string {
  if (fontSize <= 10) return "0";
  if (fontSize <= 14) return "A";
  if (fontSize <= 18) return "B";
  if (fontSize <= 24) return "D";
  if (fontSize <= 32) return "E";
  return "E"; // Max size
}

/**
 * Get ZPL alignment code. Ports web/src/utils/zpl.ts:76-87 (internal there
 * too).
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
 * Generate ZPL for a text element. Ports web/src/utils/zpl.ts:92-184
 * (`generateTextZPL`).
 */
async function generateTextZPL(
  element: RawBadgeElement,
  data: Record<string, string>,
  dpi: number,
  deps: GenerateZplDeps,
): Promise<string> {
  const x = mmToDots(element.x, dpi);
  let y = mmToDots(element.y, dpi);

  // Text resolution: reuse canvasMath's resolveElementText (source wins only
  // when data[source] resolves non-empty) rather than re-deriving the same
  // rule web/src/utils/zpl.ts:101-105 hand-rolls per call site.
  const textContent = resolveElementText(element, data);

  // Use image rendering when text has non-Latin script OR when a custom
  // font is set (so one font renders all of an element's text). This branch
  // returns immediately -- rotation/valign/^FB-wrap/maxLines below are never
  // applied to a raster-rendered element. This is a KNOWN, INTENTIONAL
  // parity limitation of the web pipeline (reconciliation #7): do not "fix"
  // it here. Ports web/src/utils/zpl.ts:107-125.
  const useImageRendering = needsImageRendering(textContent) || !!(element.customFont && element.customFont.trim());
  if (useImageRendering) {
    const fontSize = element.fontSize || 12;
    const fontSizePixels = pointsToDots(fontSize, dpi); // web/src/utils/zpl.ts:114: round(fontSize/72*dpi)

    const fontFamily = element.customFont || mapZPLFontToSystemFont(element.fontFamily);
    const fontWeight: "bold" | "normal" = element.bold ? "bold" : "normal";

    const raster = await deps.rasterizeText(textContent, {
      fontFamily,
      fontSizePx: fontSizePixels,
      fontWeight,
    });
    return buildGfaCommand(x, y, raster);
  }

  // Escape special ZPL characters for regular (native) text.
  // web/src/utils/zpl.ts:127-130.
  const escapedText = escapeZplData(textContent);

  const fontSize = element.fontSize || 12;
  const rotation = element.rotation || 0;
  const fontHeight = pointsToDots(fontSize, dpi);
  const fontWidth = fontHeight; // Same as height by default -- web/src/utils/zpl.ts:132-135

  // Adjust Y position for vertical alignment. web/src/utils/zpl.ts:137-148.
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

  // Convert rotation to ZPL format (N=0, R=90, I=180, B=270).
  // web/src/utils/zpl.ts:150-154.
  let rotCode = "N";
  if (rotation === 90) rotCode = "R";
  else if (rotation === 180) rotCode = "I";
  else if (rotation === 270) rotCode = "B";

  // Generate font command. web/src/utils/zpl.ts:156-165.
  let fontCommand: string;
  if (element.customFont && element.customFont.trim()) {
    // Use custom/TrueType font: ^A@<orientation>,<height>,<width>,<font_name>
    fontCommand = `^A@${rotCode},${fontHeight},${fontWidth},${element.customFont.trim()}`;
  } else {
    // Use built-in ZPL font: ^A<font><orientation>,<height>,<width>
    const font = element.fontFamily || getZPLFont(fontSize);
    fontCommand = `^A${font}${rotCode},${fontHeight},${fontWidth}`;
  }

  // If width is specified (text zone), use block text with alignment.
  // web/src/utils/zpl.ts:167-181.
  if (element.width) {
    const width = mmToDots(element.width, dpi);
    const maxLines = element.maxLines || 1;
    const align = getZPLAlignment(element.align);

    // ^FB = Field Block
    // ^FB<width>,<max lines>,<line spacing>,<justification>,<hanging indent>
    return `^FO${x},${y}^FB${width},${maxLines},0,${align},0${fontCommand}^FD${escapedText}^FS`;
  }

  // Simple text field.
  return `^FO${x},${y}${fontCommand}^FD${escapedText}^FS`;
}

/**
 * Generate ZPL for a QR code element. Ports web/src/utils/zpl.ts:189-214
 * (`generateQRCodeZPL`).
 */
function generateQRCodeZPL(element: RawBadgeElement, data: Record<string, string>, dpi: number): string {
  const x = mmToDots(element.x, dpi);
  const y = mmToDots(element.y, dpi);

  const qrData = resolveElementText(element, data);

  // Calculate module size (size of each QR module). web/src/utils/zpl.ts:204-205:
  // `element.width || 20` -- a falsy (0/undefined) width falls back to 20mm,
  // not just an undefined one; roughly 30 modules per QR.
  const widthMM = element.width || 20;
  const moduleSize = Math.max(2, Math.round(mmToDots(widthMM, dpi) / 30));

  // ^BQ = QR Code. Model 2 is most common (QR Code Model 2).
  return `^FO${x},${y}^BQN,2,${moduleSize}^FDQA,${escapeZplData(qrData)}^FS`;
}

/**
 * Generate ZPL for a barcode (Code 128) element. Ports
 * web/src/utils/zpl.ts:219-240 (`generateBarcodeZPL`).
 */
function generateBarcodeZPL(element: RawBadgeElement, data: Record<string, string>, dpi: number): string {
  const x = mmToDots(element.x, dpi);
  const y = mmToDots(element.y, dpi);

  const barcodeData = resolveElementText(element, data);

  const heightMM = element.height || 10;
  const height = mmToDots(heightMM, dpi);

  // ^BC = Code 128
  return `^FO${x},${y}^BCN,${height},Y,N,N^FD${escapeZplData(barcodeData)}^FS`;
}

/**
 * Generate ZPL for a line element. Ports web/src/utils/zpl.ts:245-255
 * (`generateLineZPL`).
 */
function generateLineZPL(element: RawBadgeElement, dpi: number): string {
  const x = mmToDots(element.x, dpi);
  const y = mmToDots(element.y, dpi);
  const width = mmToDots(element.width || 10, dpi);
  const thickness = 2; // dots

  // ^GB = Graphic Box (line when height is small)
  return `^FO${x},${y}^GB${width},${thickness},${thickness}^FS`;
}

/**
 * Generate ZPL for a box/rectangle element. Ports web/src/utils/zpl.ts:260-270
 * (`generateBoxZPL`).
 */
function generateBoxZPL(element: RawBadgeElement, dpi: number): string {
  const x = mmToDots(element.x, dpi);
  const y = mmToDots(element.y, dpi);
  const width = mmToDots(element.width || 10, dpi);
  const height = mmToDots(element.height || 10, dpi);
  const thickness = 2;

  return `^FO${x},${y}^GB${width},${height},${thickness}^FS`;
}

/**
 * Generate a complete ZPL document from a badge template. Ports
 * web/src/utils/zpl.ts:296-355 (`generateZPL`).
 */
export async function generateZpl(
  config: BadgeConfig,
  elements: RawBadgeElement[],
  data: Record<string, string>,
  deps: GenerateZplDeps,
): Promise<string> {
  const { width_mm: widthMM, height_mm: heightMM, dpi } = config;

  const widthDots = mmToDots(widthMM, dpi);
  const heightDots = mmToDots(heightMM, dpi);

  let zpl = "";

  // ZPL Header. web/src/utils/zpl.ts:309-317.
  zpl += "^XA\n"; // Start format
  zpl += "^CI28\n"; // Set encoding to UTF-8 for Cyrillic and other Unicode characters
  zpl += `^PW${widthDots}\n`; // Print width
  zpl += `^LL${heightDots}\n`; // Label length
  zpl += "^PR4\n"; // Print speed (4 inches/sec)
  zpl += "^LH0,0\n"; // Label home position

  // Generate elements. web/src/utils/zpl.ts:319-349.
  for (const element of elements) {
    let elementZPL = "";

    switch (element.type) {
      case "text":
        elementZPL = await generateTextZPL(element, data, dpi, deps);
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

  // ZPL Footer. web/src/utils/zpl.ts:351-352.
  zpl += "^XZ\n"; // End format

  return zpl;
}
