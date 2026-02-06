// ZPL Image Text Generator
// Converts text (including Cyrillic) to bitmap images embedded in ZPL
// This allows using any fonts on label printers without loading fonts into printer

/**
 * Render text to canvas and convert to ZPL graphic field
 */
export async function textToZPLImage(
  text: string,
  options: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: "normal" | "bold";
    fontStyle?: "normal" | "italic";
  } = {}
): Promise<{ zplCommand: string; width: number; height: number }> {
  const {
    fontFamily = "Arial",
    fontSize = 24,
    fontWeight = "normal",
    fontStyle = "normal",
  } = options;

  // Create canvas
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot get canvas context");

  // Set font
  const fontString = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.font = fontString;

  // Measure text
  const metrics = ctx.measureText(text);
  const textWidth = Math.ceil(metrics.width);
  const textHeight = fontSize * 1.5; // Add some padding

  // Set canvas size
  canvas.width = textWidth;
  canvas.height = textHeight;

  // Draw white background
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw black text
  ctx.fillStyle = "black";
  ctx.font = fontString;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, textHeight / 2);

  // Convert to monochrome bitmap
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const monochromeData = convertToMonochrome(imageData);

  // Convert to ZPL hex format
  const zplHex = bitmapToZPLHex(monochromeData, canvas.width, canvas.height);

  // Generate ZPL command
  const bytesPerRow = Math.ceil(canvas.width / 8);
  const totalBytes = bytesPerRow * canvas.height;

  const zplCommand = `^GFA,${totalBytes},${totalBytes},${bytesPerRow},${zplHex}`;

  return {
    zplCommand,
    width: canvas.width,
    height: canvas.height,
  };
}

/**
 * Convert RGBA image data to monochrome (black/white)
 */
function convertToMonochrome(imageData: ImageData): Uint8Array {
  const { width, height, data } = imageData;
  const monochromeData = new Uint8Array(width * height);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Convert to grayscale
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;

    // Threshold: > 127 = white (0), <= 127 = black (1)
    const pixelIndex = i / 4;
    monochromeData[pixelIndex] = gray > 127 ? 0 : 1;
  }

  return monochromeData;
}

/**
 * Convert monochrome bitmap to ZPL hex format
 */
function bitmapToZPLHex(
  monochromeData: Uint8Array,
  width: number,
  height: number
): string {
  const bytesPerRow = Math.ceil(width / 8);
  const hexData: string[] = [];

  for (let y = 0; y < height; y++) {
    let rowBytes = "";
    for (let x = 0; x < bytesPerRow; x++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const pixelX = x * 8 + bit;
        if (pixelX < width) {
          const pixelIndex = y * width + pixelX;
          if (monochromeData[pixelIndex] === 1) {
            byte |= 1 << (7 - bit);
          }
        }
      }
      rowBytes += byte.toString(16).toUpperCase().padStart(2, "0");
    }
    hexData.push(rowBytes);
  }

  return hexData.join("");
}

/**
 * Generate ZPL with text as image for Cyrillic support
 */
export async function generateZPLWithImageText(
  text: string,
  x: number, // dots
  y: number, // dots
  options: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: "normal" | "bold";
    fontStyle?: "normal" | "italic";
  } = {}
): Promise<string> {
  const { zplCommand } = await textToZPLImage(text, options);

  // ^FO sets position, ^GF draws the image
  return `^FO${x},${y}\n${zplCommand}\n^FS`;
}

/**
 * Check if text contains Cyrillic characters
 */
export function containsCyrillic(text: string): boolean {
  return /[\u0400-\u04FF]/.test(text);
}

/**
 * Check if text contains non-Latin characters that need image rendering
 */
export function needsImageRendering(text: string): boolean {
  // Cyrillic, Chinese, Arabic, etc.
  return /[\u0400-\u04FF\u4E00-\u9FFF\u0600-\u06FF]/.test(text);
}

