// P3.2 Task 5 -- the ZPL preview modal (board §4d). Two tabs, one shared
// generation pipeline:
//  - "ZPL code": the exact string `generateZpl` (Task 1) produces -- the
//    real bytes this editor would hand to a printer -- plus a Copy button.
//  - "Rendered": a real <canvas> composition at DOT scale (not the
//    mm/px-approximate editor canvas BadgeCanvas.tsx already owns).
//
// Generation AWAITS `useEventFontFaces`' readiness (reconciliation #9):
// starting generation before an event's uploaded fonts have loaded would
// silently rasterize the browser's fallback glyphs into the "true" preview.
// A fonts-load FAILURE doesn't block generation forever, though -- it
// proceeds with a visible `badgeFontsNotReady` warning instead, since an
// event fonts endpoint that never recovers must not brick the whole preview.
//
// Generation errors (canvas unavailable, mapped from
// `canvasRasterizer.ts`'s typed `RasterUnavailableError`) render as an
// in-modal error line, replacing BOTH tabs' content -- never a silently
// empty pre/canvas (plan Task 5 interface note).
import {
  Button, cn, Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@idento/ui";
import * as QRCode from "qrcode";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { resolveElementText } from "./canvasMath";
import type { BadgeConfig } from "./templateTypes";
import { rasterizeText, rasterizeTextToBitmap, RasterUnavailableError } from "./zpl/canvasRasterizer";
import {
  generateZpl, mapZPLFontToSystemFont, mmToDots, needsImageRendering, pointsToDots, type RawBadgeElement,
} from "./zpl/generateZpl";
import { collectMissingCustomFonts } from "./zpl/missingFonts";
import { useEventFontFaces } from "./zpl/useEventFontFaces";

// Physical-media exception (panel/AGENTS.md's documented class -- same
// pattern as BadgeCanvas.tsx's ARTBOARD_INK/WORK_SURFACE_BG and QrSvg.tsx):
// this canvas composition represents the physical printed label face, always
// black ink on a white substrate regardless of the app's light/dark theme --
// a theme token here would misrepresent the physical medium (e.g. print ink
// going invisible on a dark-mode-inverted face). Every literal color in this
// file's canvas-drawing code below is one of these two, referenced at each
// point of use.
const PRINT_SUBSTRATE = "#ffffff";
const PRINT_INK = "#000000";

export interface ZplPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The RAW serialized template doc (`serializeTemplateDoc`'s return value)
  // -- carries whatever extras a hand-edited/legacy doc has, per this
  // phase's "generate from the exact thing that would be saved" rule
  // (plan reconciliation #13). Only `.elements` is read here; width/height/
  // dpi come from the separate typed `config` prop below.
  doc: Record<string, unknown>;
  config: BadgeConfig;
  previewData: Record<string, string>;
  previewName: string;
  eventId: string;
}

type Tab = "zpl" | "rendered";

type Generation =
  | { status: "loading" }
  | { status: "ready"; zpl: string }
  | { status: "error"; message: string };

// Displaying the composed preview at 1:1 dot resolution would frequently be
// wider than the dialog itself (a 90mm@300dpi label is ~1063 dots) -- this
// caps the ON-SCREEN size only (via the canvas element's CSS width/height);
// the canvas's internal pixel buffer (its `width`/`height` ATTRIBUTES, set
// below) always stays at the full dot resolution, so raster-text bitmaps are
// still drawn at true, undownsampled print resolution.
const MAX_DISPLAY_PX = 760;

export function ZplPreviewModal({
  open, onOpenChange, doc, config, previewData, previewName, eventId,
}: ZplPreviewModalProps) {
  const { t } = useTranslation();
  const fontFaces = useEventFontFaces(eventId, open);

  const docKey = JSON.stringify(doc);
  const dataKey = JSON.stringify(previewData);

  const elements = React.useMemo<RawBadgeElement[]>(
    () => (Array.isArray(doc.elements) ? (doc.elements as RawBadgeElement[]) : []),
    // `doc` is a freshly-built object every render (serializeTemplateDoc
    // rebuilds its `elements` array on every call) -- keying this memo off
    // its JSON serialization instead of its object identity is what keeps
    // regeneration below tied to actual CONTENT changes rather than firing
    // on every unrelated parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docKey],
  );

  const [generation, setGeneration] = React.useState<Generation>({ status: "loading" });

  React.useEffect(() => {
    if (!open) return;
    // Await font readiness before ever generating (reconciliation #9): only
    // a TERMINAL fontFaces status -- "ready" (every font loaded) or "error"
    // (proceed anyway, with the visible badgeFontsNotReady warning below) --
    // unblocks generation. "idle"/"loading" just keep showing the
    // generating placeholder.
    if (fontFaces.status !== "ready" && fontFaces.status !== "error") {
      setGeneration({ status: "loading" });
      return;
    }

    let cancelled = false;
    setGeneration({ status: "loading" });

    async function run() {
      try {
        const zpl = await generateZpl(config, elements, previewData, { rasterizeText });
        if (!cancelled) setGeneration({ status: "ready", zpl });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof RasterUnavailableError
          ? t("badgeZplPreviewRasterError")
          : t("badgeZplPreviewError");
        setGeneration({ status: "error", message });
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
    // `elements`/`previewData` change identity every render (see
    // docKey/dataKey above); this effect is keyed on their CONTENT (docKey/
    // dataKey) plus the individual BadgeConfig fields instead, so it only
    // regenerates when the doc, the previewed attendee's data, the label's
    // own dimensions, or the fonts-readiness verdict actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fontFaces.status, docKey, dataKey, config.width_mm, config.height_mm, config.dpi]);

  const [tab, setTab] = React.useState<Tab>("zpl");
  const [copied, setCopied] = React.useState(false);
  const copiedTimeoutRef = React.useRef<number | undefined>(undefined);

  // Reset the ephemeral view state on close -- reopening (possibly for a
  // different doc/attendee) should never show a stale tab selection or a
  // "Copied" flag left over from a previous open.
  React.useEffect(() => {
    if (open) return;
    setTab("zpl");
    setCopied(false);
    window.clearTimeout(copiedTimeoutRef.current);
  }, [open]);

  function handleCopy() {
    if (generation.status !== "ready") return;
    const zpl = generation.zpl;
    // Await the write and only claim success once it actually resolves -- a
    // rejected clipboard write (e.g. permission blocked) must not flip the
    // button to "Copied" and mislead the user (P1.2 clipboard rule,
    // ApiKeysCard.tsx's handleCopy precedent).
    navigator.clipboard.writeText(zpl).then(
      () => {
        setCopied(true);
        window.clearTimeout(copiedTimeoutRef.current);
        copiedTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
      },
      () => {
        // No distinct failure-state copy exists for this yet (same call
        // ApiKeysCard.tsx's handleCopy makes) -- leave `copied` false.
      },
    );
  }

  const fontsWarning = fontFaces.status === "error";
  // PR #74 review round Fix 8: distinct from `fontsWarning` above -- that
  // one covers a fonts-LIST/individual-font LOAD failure; this covers a
  // customFont the template references that was never uploaded for this
  // event in the first place (so there's nothing that could have "failed
  // to load" -- the family simply doesn't exist). Unlike the drawer/bulk/
  // test-print SEND surfaces (usePrintBadge.ts's MissingFontError), this is
  // WARN-only: a preview rendering a fallback glyph on-screen is honest
  // enough for review; only a PHYSICAL print must be blocked.
  const missingFontFamilies = collectMissingCustomFonts(elements, fontFaces.families);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("workspaceDialogClose")} className="max-w-[860px]">
        <DialogHeader>
          <DialogTitle>{t("badgeZplPreviewTitle")}</DialogTitle>
          <p className="text-caption text-muted-foreground">
            {t("badgeZplPreviewPreviewing", { name: previewName })}
          </p>
        </DialogHeader>

        <div
          role="group"
          aria-label={t("badgeZplPreviewViewLabel")}
          className="inline-flex w-fit gap-1 rounded-md border border-border p-0.5"
        >
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={tab === "zpl"}
            className={cn(tab === "zpl" && "border-foreground bg-foreground text-background hover:bg-foreground/90")}
            onClick={() => setTab("zpl")}
          >
            {t("badgeZplPreviewTabZpl")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={tab === "rendered"}
            className={cn(tab === "rendered" && "border-foreground bg-foreground text-background hover:bg-foreground/90")}
            onClick={() => setTab("rendered")}
          >
            {t("badgeZplPreviewTabRendered")}
          </Button>
        </div>

        {fontsWarning ? <p className="text-body text-warning">{t("badgeFontsNotReady")}</p> : null}
        {missingFontFamilies.length > 0 ? (
          <p className="text-body text-warning">
            {t("badgePreviewMissingFont", { families: missingFontFamilies.join(", ") })}
          </p>
        ) : null}

        {generation.status === "error" ? (
          // Never a silently empty tab (plan Task 5 interface note): the
          // error line replaces BOTH tabs' content, regardless of which one
          // is active.
          <p className="text-body text-destructive" role="alert">{generation.message}</p>
        ) : tab === "zpl" ? (
          <div className="flex flex-col gap-3">
            <pre
              data-testid="badge-zpl-preview-code"
              // break-all is load-bearing: raster lines (^GFA + hex payload)
              // are ONE unbroken token that whitespace-pre-wrap alone cannot
              // wrap -- without it the pre grows horizontally off-screen on
              // any label containing rasterized (Cyrillic/customFont) text.
              className="max-h-[420px] overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/30 p-3 font-mono text-code"
            >
              {generation.status === "ready" ? generation.zpl : t("badgeZplPreviewGenerating")}
            </pre>
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              disabled={generation.status !== "ready"}
              onClick={handleCopy}
            >
              {copied ? t("badgeZplPreviewCopied") : t("badgeZplPreviewCopy")}
            </Button>
          </div>
        ) : (
          <RenderedPreview elements={elements} config={config} previewData={previewData} />
        )}
      </DialogContent>
    </Dialog>
  );
}

// True exactly when a text element routes through the raster (image) path --
// mirrors generateZpl.ts's generateTextZPL `useImageRendering` condition
// (Cyrillic/CJK/Arabic text OR a customFont set) so the Rendered tab draws
// (and labels) elements identically to how generation itself branches.
function isRasterText(element: RawBadgeElement, previewData: Record<string, string>): boolean {
  if (element.type !== "text") return false;
  const text = resolveElementText(element, previewData);
  return needsImageRendering(text) || !!(element.customFont && element.customFont.trim());
}

interface RenderedPreviewProps {
  elements: RawBadgeElement[];
  config: BadgeConfig;
  previewData: Record<string, string>;
}

// The Rendered tab: a real <canvas> composition at DOT scale. Raster-text
// elements draw the exact SAME bitmaps `generateZpl` embeds in the ZPL
// output (via `rasterizeTextToBitmap`, canvasRasterizer.ts's shared core) --
// true print pixels. Native elements (QR/barcode/plain text/line/box) are
// drawn as LABELED approximations (reconciliation #12): the real printer
// pipeline never rasterizes them either (QR/barcode stay native `^BQN`/
// `^BCN` commands), so an approximation here is an honest depiction, not a
// shortcut.
//
// jsdom (this repo's test environment) has no canvas 2D context at all
// (verified -- no `canvas` npm package installed): `canvasEl.getContext`
// returns `null` regardless of the doc's content, so this always falls back
// to the `badgeZplPreviewCanvasUnavailable` message node under test --
// structurally proving the guard exists, without ever being able to assert
// real pixel output (same jsdom limitation canvasRasterizer.ts documents).
function RenderedPreview({ elements, config, previewData }: RenderedPreviewProps) {
  const { t } = useTranslation();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [unavailable, setUnavailable] = React.useState(false);

  const widthDots = mmToDots(config.width_mm, config.dpi);
  const heightDots = mmToDots(config.height_mm, config.dpi);
  const displayScale = Math.min(1, MAX_DISPLAY_PX / Math.max(widthDots, 1));

  const hasRasterText = elements.some((el) => isRasterText(el, previewData));
  const hasNativeApprox = elements.some((el) => !isRasterText(el, previewData));

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);

    // PRINT_SUBSTRATE -- see this file's exception comment above.
    ctx.fillStyle = PRINT_SUBSTRATE;
    ctx.fillRect(0, 0, widthDots, heightDots);

    for (const element of elements) {
      drawElement(ctx, element, config, previewData);
    }
  }, [elements, config, previewData, widthDots, heightDots]);

  return (
    <div className="flex flex-col gap-3">
      {unavailable ? (
        <p className="text-body text-muted-foreground">{t("badgeZplPreviewCanvasUnavailable")}</p>
      ) : null}
      <div className="overflow-auto rounded-md border border-border p-2">
        <canvas
          ref={canvasRef}
          width={widthDots}
          height={heightDots}
          style={{ width: widthDots * displayScale, height: heightDots * displayScale }}
          className={unavailable ? "hidden" : undefined}
        />
      </div>
      <div className="flex flex-col gap-1 text-caption text-muted-foreground">
        {hasRasterText ? <p>{t("badgePreviewTrueRaster")}</p> : null}
        {hasNativeApprox ? <p>{t("badgePreviewNativeApprox")}</p> : null}
      </div>
    </div>
  );
}

function drawElement(
  ctx: CanvasRenderingContext2D,
  element: RawBadgeElement,
  config: BadgeConfig,
  previewData: Record<string, string>,
): void {
  const x = mmToDots(element.x, config.dpi);
  const y = mmToDots(element.y, config.dpi);

  switch (element.type) {
    case "text": {
      const text = resolveElementText(element, previewData);
      const fontSize = element.fontSize || 12;
      const fontSizePx = pointsToDots(fontSize, config.dpi);

      if (isRasterText(element, previewData)) {
        const fontFamily = element.customFont || mapZPLFontToSystemFont(element.fontFamily);
        const fontWeight: "bold" | "normal" = element.bold ? "bold" : "normal";
        const { bitmap, width, height } = rasterizeTextToBitmap(text, { fontFamily, fontSizePx, fontWeight });
        const imageData = ctx.createImageData(width, height);
        // Same PRINT_INK (0)/PRINT_SUBSTRATE (255) exception as the rest of
        // this file, expressed as raw RGB channel values instead of a CSS
        // color string -- ImageData has no `fillStyle` equivalent.
        for (let i = 0; i < bitmap.length; i += 1) {
          const on = bitmap[i] === 1;
          imageData.data[i * 4] = on ? 0 : 255;
          imageData.data[i * 4 + 1] = on ? 0 : 255;
          imageData.data[i * 4 + 2] = on ? 0 : 255;
          imageData.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(imageData, x, y);
        return;
      }

      // Native-font approximation -- a mapped system font, never the true
      // printer bitmap (built-in ZPL fonts only ever render for real on the
      // printer itself). PRINT_INK -- see this file's exception comment above.
      //
      // Task 5 review Important 1: the size MUST be in DOTS-as-px, not
      // `${n}pt`. This canvas buffer is dot-resolution (its width/height
      // attributes are mmToDots values, no ctx.scale anywhere), so every
      // drawn unit must be a dot -- but canvas `pt` units are CSS points
      // (1pt = 4/3 CSS px), which at 300dpi would draw text ~3x undersized
      // relative to the dot-space positions and raster-bitmap heights
      // everything else here uses. `fontSizePx` above is already
      // pointsToDots(fontSize, dpi) -- the same dot size the ZPL ^A command
      // and the raster path both use. Bold is honored the same way the
      // raster path honors it (element.bold). jsdom can't exercise this
      // drawing code (null 2D context) -- verified via Task 10's manual
      // printed-matrix checklist, noted in the task report.
      ctx.fillStyle = PRINT_INK;
      ctx.font = `${element.bold ? "bold " : ""}${fontSizePx}px ${mapZPLFontToSystemFont(element.fontFamily)}`;
      ctx.textBaseline = "top";
      ctx.fillText(text, x, y);
      return;
    }

    case "qrcode": {
      const value = resolveElementText(element, previewData);
      const widthMM = element.width || 20;
      const sizeDots = mmToDots(widthMM, config.dpi);
      try {
        // Local, pure-JS QR module data -- same `qrcode` dependency and
        // same no-3rd-party-API guarantee as QrSvg.tsx, just consumed via
        // its lower-level `create()` (a boolean module matrix) instead of
        // its SVG string renderer, since a canvas composition draws filled
        // rects directly rather than parsing markup.
        const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
        const moduleCount = qr.modules.size;
        const moduleSize = sizeDots / moduleCount;
        // PRINT_INK -- see this file's exception comment above.
        ctx.fillStyle = PRINT_INK;
        for (let row = 0; row < moduleCount; row += 1) {
          for (let col = 0; col < moduleCount; col += 1) {
            if (qr.modules.get(row, col)) {
              ctx.fillRect(x + col * moduleSize, y + row * moduleSize, moduleSize, moduleSize);
            }
          }
        }
      } catch {
        // Unencodable value (e.g. an empty string) -- leave the area blank
        // rather than crash the whole preview; the ZPL tab still shows the
        // real generated ^BQN command for review.
      }
      return;
    }

    case "barcode": {
      const value = resolveElementText(element, previewData);
      const heightDots = mmToDots(element.height || 10, config.dpi);
      const widthDots = mmToDots(element.width || 30, config.dpi);
      // Striped placeholder -- no barcode-rendering lib in this repo
      // (YAGNI, per plan), same honest "approximation, not scannable"
      // treatment BadgeCanvas.tsx's own barcode placeholder uses.
      // PRINT_INK -- see this file's exception comment above.
      ctx.fillStyle = PRINT_INK;
      const stripeWidth = Math.max(2, Math.round(widthDots / 40));
      for (let sx = 0; sx < widthDots; sx += stripeWidth * 2) {
        ctx.fillRect(x + sx, y, stripeWidth, heightDots);
      }
      ctx.font = `${Math.round(config.dpi / 25)}px monospace`;
      ctx.textBaseline = "top";
      ctx.fillText(value, x, y + heightDots + 4);
      return;
    }

    case "line": {
      const widthDots = mmToDots(element.width || 10, config.dpi);
      ctx.fillStyle = PRINT_INK; // see this file's exception comment above
      ctx.fillRect(x, y, widthDots, 2);
      return;
    }

    case "box": {
      const widthDots = mmToDots(element.width || 10, config.dpi);
      const heightDots = mmToDots(element.height || 10, config.dpi);
      ctx.strokeStyle = PRINT_INK; // see this file's exception comment above
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, widthDots, heightDots);
      return;
    }

    default:
      return;
  }
}
