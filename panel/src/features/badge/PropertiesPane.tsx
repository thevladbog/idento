import {
  Button, Input, Label, Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
  Switch, cn,
} from "@idento/ui";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
} from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { bindingOptions, displayBinding } from "./bindings";
import { clampPosition, clampSize, elementFootprint, resolveElementText } from "./canvasMath";
import type { BadgeConfig, BadgeElement } from "./templateTypes";
import { ZPL_FONTS } from "./templateTypes";
import { barcodeFieldOrigin } from "./zpl/generateZpl";
import type { components } from "../../shared/api/schema";

// Same alias FontsCard.tsx / useEventFontFaces.ts use for this exact schema
// type (GET /api/events/{event_id}/fonts's per-item shape).
type FontListItem = components["schemas"]["FontListItem"];

export interface PropertiesPaneProps {
  // `null` when nothing is selected (ElementsPane/BadgeCanvas both allow a
  // null selectedId) -- the pane renders its own muted hint in that case,
  // never a blank/empty-looking panel.
  element: BadgeElement | null;
  // Same `event.field_schema ?? []` convention ElementsPane already takes
  // -- fed straight into bindings.ts's bindingOptions() for the binding
  // <select>'s option list.
  fieldSchema: string[];
  // Needed by canvasMath's clampPosition/clampSize (both take a
  // BadgeConfig) so a typed X/Y/Width/Height change clamps to the SAME
  // artboard bounds BadgeCanvas's own drag/resize/nudge paths already
  // enforce -- one clamp rule, never re-derived here. Also the CURRENT
  // values shown/edited by the "nothing selected" document-settings
  // section below.
  config: BadgeConfig;
  // P3.2 Task 4: the event's uploaded fonts (BadgeEditorPage's own inline
  // `$api.useQuery("get", "/api/events/{event_id}/fonts", ...)`, mirroring
  // the SAME "fetch once at the page, pass down" convention `fieldSchema`
  // already uses) -- the font <select>'s "Event fonts" optgroup lists one
  // option per FAMILY here (weight/style variants of the same family
  // collapse to the first occurrence -- see `fontsByFamily` below), keyed
  // by id, valued by `family`.
  fonts: FontListItem[];
  // P3.2 Task 2's `useFontCoverage(eventId)` result, passed straight
  // through -- `true`/`false`/`undefined` (still loading or unparseable)
  // per font id, rendered as a coverage flag appended to that font's option
  // label. Never re-derived here; this pane only renders what it's handed.
  fontCoverage: Record<string, boolean | undefined>;
  onUpdate: (id: string, patch: Partial<BadgeElement>) => void;
  // Document settings (width_mm/height_mm/dpi), edited from the "nothing
  // selected" branch below -- a single-field patch per change, same
  // "never batch several fields into one call" convention `onUpdate`
  // above documents for per-element edits.
  onUpdateConfig: (patch: Partial<BadgeConfig>) => void;
  // The previewed attendee's data -- same `preview.data` ZplPreviewModal/
  // BadgeCanvas receive -- used to length-check a barcode's resolved code
  // for the overflow advisory.
  previewData: Record<string, string>;
}

// Appends a translated Cyrillic-coverage flag to an event font's option
// label -- `coverage === undefined` (still loading, or the font failed to
// parse) deliberately adds NO flag text at all, never a false ✓ or ✗ (same
// honesty rule fontCoverage.ts's own `useFontCoverage` documents: undefined
// must never collapse to a guess).
function fontOptionLabel(family: string, coverage: boolean | undefined, t: TFunction): string {
  if (coverage === true) return `${family} (${t("badgeFontCoverageYes")})`;
  if (coverage === false) return `${family} (${t("badgeFontCoverageNo")})`;
  return family;
}

const ROTATIONS: ReadonlyArray<0 | 90 | 180 | 270> = [0, 90, 180, 270];

const ALIGN_OPTIONS: { value: "left" | "center" | "right"; icon: typeof AlignLeft; labelKey: string }[] = [
  { value: "left", icon: AlignLeft, labelKey: "badgeAlignLeft" },
  { value: "center", icon: AlignCenter, labelKey: "badgeAlignCenter" },
  { value: "right", icon: AlignRight, labelKey: "badgeAlignRight" },
];

// 2026-07-20 live-run request: mirrors ALIGN_OPTIONS's shape exactly (same
// segmented-button pattern) for the vertical axis. Values match
// generateZpl.ts's generateTextZPL valign check verbatim ("middle"/"bottom";
// any other value, including "top", takes the no-adjustment default path).
const VALIGN_OPTIONS: { value: "top" | "middle" | "bottom"; icon: typeof AlignLeft; labelKey: string }[] = [
  { value: "top", icon: AlignVerticalJustifyStart, labelKey: "badgeValignTop" },
  { value: "middle", icon: AlignVerticalJustifyCenter, labelKey: "badgeValignMiddle" },
  { value: "bottom", icon: AlignVerticalJustifyEnd, labelKey: "badgeValignBottom" },
];

// One id per control, hard-coded (not derived from element.id) -- exactly
// one PropertiesPane is ever mounted at a time (board 4a's right column),
// so a static id can never collide with another instance's, and label
// `htmlFor` wiring stays simple across re-selection.
const IDS = {
  x: "badge-props-x",
  y: "badge-props-y",
  width: "badge-props-width",
  height: "badge-props-height",
  binding: "badge-props-binding",
  text: "badge-props-text",
  font: "badge-props-font",
  fontSize: "badge-props-font-size",
  rotation: "badge-props-rotation",
  maxLines: "badge-props-max-lines",
  barcodeCaption: "badge-props-barcode-caption",
  docWidth: "badge-props-doc-width",
  docHeight: "badge-props-doc-height",
  docDpi: "badge-props-doc-dpi",
};

// Sane UI-only bounds for width_mm/height_mm (the backend places no upper
// bound at all -- zpl.ParseBadgeTemplate only rejects <= 0 -- so this is
// purely a guard rail against an obviously-unprintable label: below 10mm
// nothing meaningful fits, above 200mm exceeds the desktop thermal label/
// badge stock this editor's registered printers (the equipment hub's
// Zebra ZD-series) actually take).
const DOC_MM_MIN = 10;
const DOC_MM_MAX = 200;

// The three DPIs zpl.go/generateZpl.ts's mm<->dots arithmetic (a plain
// mm/25.4*dpi multiply, no dpi-specific branching) handles correctly --
// 203/300 are the two the panel's own golden ZPL matrix already pins;
// goldenMatrix.test.ts adds a 600dpi cell alongside this change to prove
// the pipeline is dpi-generic, not just parity-tested at two values.
const DPI_OPTIONS = [203, 300, 600] as const;

// Radix's Select throws if any SelectItem has value="" -- the binding
// select's "Static text" option used to be a native `<option value="">`
// (source: undefined). This sentinel stands in for it and is mapped back to
// `undefined` at the onValueChange boundary (same pattern as
// AttendeesPage.tsx's ZONE_FILTER_ALL/STATUS_FILTER_ANY), so `element.source`
// is unchanged from before this migration. Never collides with a real
// binding name: bindingOptions() only ever returns field-schema identifiers.
const BINDING_STATIC = "__static";

// Board 4a's Properties pane (P3.1 Task 9): the right column of the badge
// editor's three-pane grid. Renders the common X/Y/Width/Height controls for
// EVERY element type, plus a per-type section: text gets binding + static
// text + font + font size + alignment + vertical align + rotation + max
// lines; qrcode gets a binding select only (same options as text's); barcode
// gets a binding select + the human-readable-caption toggle (2026-07-20);
// line/box get nothing beyond the common section. Every control here
// dispatches a single-field `onUpdate(id, patch)` call -- never a batched
// multi-field patch -- so each keystroke/click is independently
// undoable-in-principle and mirrors editorState.ts's "update" action shape
// (`{id, patch: Partial<BadgeElement>}`).
export function PropertiesPane({
  element, fieldSchema, config, fonts, fontCoverage, onUpdate, onUpdateConfig, previewData,
}: PropertiesPaneProps) {
  const { t } = useTranslation();

  // Typed number field -> clamped-patch dispatch for the document-settings
  // section below. Clamped to DOC_MM_MIN/MAX client-side before dispatch
  // (the reducer's "updateConfig" case only clamps ELEMENTS against
  // whatever config it's given -- it doesn't re-validate the config's own
  // bounds, so an out-of-range value must never reach it in the first
  // place).
  function handleConfigMmChange(field: "width_mm" | "height_mm", event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.target.valueAsNumber;
    if (Number.isNaN(value)) return;
    const clamped = Math.min(Math.max(value, DOC_MM_MIN), DOC_MM_MAX);
    onUpdateConfig(field === "width_mm" ? { width_mm: clamped } : { height_mm: clamped });
  }

  function handleDpiChange(value: string) {
    onUpdateConfig({ dpi: Number(value) });
  }

  // A template saved before this feature existed (or before the operator
  // ever picks a new value from this select) can carry any positive dpi --
  // zpl.ParseBadgeTemplate only rejects <= 0 -- not just one of
  // DPI_OPTIONS's three. See the disabled placeholder option below.
  const isKnownDpi = DPI_OPTIONS.some((dpi: number) => dpi === config.dpi);

  if (!element) {
    return (
      <div className="flex h-full flex-col gap-4 rounded-lg border border-border p-4" data-testid="badge-pane-properties">
        <h3 className="text-body font-medium text-muted-foreground">{t("badgePaneProperties")}</h3>

        <div className="flex flex-col gap-3">
          <h4 className="text-card-title text-foreground">{t("badgePropsDocTitle")}</h4>
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              id={IDS.docWidth}
              label={t("badgePropsWidth")}
              value={config.width_mm}
              step={1}
              min={DOC_MM_MIN}
              max={DOC_MM_MAX}
              onChange={(e) => handleConfigMmChange("width_mm", e)}
            />
            <NumberField
              id={IDS.docHeight}
              label={t("badgePropsHeight")}
              value={config.height_mm}
              step={1}
              min={DOC_MM_MIN}
              max={DOC_MM_MAX}
              onChange={(e) => handleConfigMmChange("height_mm", e)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={IDS.docDpi}>{t("badgePropsDpi")}</Label>
            <Select value={String(config.dpi)} onValueChange={handleDpiChange}>
              <SelectTrigger id={IDS.docDpi}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DPI_OPTIONS.map((dpi) => (
                  <SelectItem key={dpi} value={String(dpi)}>
                    {dpi}
                  </SelectItem>
                ))}
                {/* A template saved before this picker existed (or edited via
                    a raw API call -- exactly how the Zebra hardware run that
                    prompted this feature ended up fixing a wrong dpi in the
                    first place) can carry a dpi outside the three listed
                    options. Same "honest disabled placeholder" pattern as the
                    font select's own missingFontFamily option above: without
                    it, this controlled Select's value wouldn't match any
                    SelectItem, and it would silently DISPLAY the first
                    option (203) while the actual saved config.dpi stayed
                    whatever it really was -- showing the wrong value
                    without changing it. */}
                {!isKnownDpi && (
                  <SelectItem value={String(config.dpi)} disabled>
                    {t("badgePropsDpiCustom", { dpi: config.dpi })}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          {/* Always-visible, same "editing aid honesty" convention as
              BadgeCanvas.tsx's own permanent badgeCanvasApproximation
              caption -- not a dynamic per-edit notice (no new transient
              state to track), just a standing disclosure of what a shrink
              does to elements that no longer fit. */}
          <p className="text-caption text-muted-foreground">{t("badgePropsDocShrinkHint")}</p>
        </div>

        <p className="text-caption text-muted-foreground">{t("badgePropsEmpty")}</p>
      </div>
    );
  }

  // Dispatches exactly the fields the caller passes -- callers always pass
  // a single-key object (see each handler below), never accumulate several
  // fields into one call.
  function patch(fields: Partial<BadgeElement>) {
    onUpdate(element!.id, fields);
  }

  function handleNumberChange(
    field: "x" | "y" | "width" | "height",
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const value = event.target.valueAsNumber;
    // A cleared/invalid field reports NaN -- ignore rather than dispatching
    // a patch that would corrupt the element's position/size.
    if (Number.isNaN(value)) return;

    // elementFootprint, NOT raw element.width/height: a width/height-less
    // element (a fresh text element) renders 40x8mm on the canvas, and its
    // drag/nudge paths clamp against that same footprint -- clamping a
    // typed X/Y against `width ?? 0` here would let this THIRD input path
    // park the rendered box past the edge the other two enforce (one
    // footprint rule; see canvasMath.ts's elementFootprint doc).
    const footprint = elementFootprint(element!);
    const candidate = {
      x: element!.x,
      y: element!.y,
      width: footprint.width,
      height: footprint.height,
      [field]: value,
    };

    if (field === "x" || field === "y") {
      const clamped = clampPosition(candidate, config);
      patch({ [field]: clamped[field] } as Partial<BadgeElement>);
    } else {
      const clamped = clampSize(candidate, config);
      patch({ [field]: clamped[field] } as Partial<BadgeElement>);
    }
  }

  function handleBindingChange(value: string) {
    patch({ source: value === BINDING_STATIC ? undefined : value });
  }

  // P3.2 Task 4: the font <select> now mixes native ZPL codes (option value
  // = code, e.g. "A") with event-font family names (option value = family,
  // e.g. "Roboto") in one flat list. Telling them apart on change is a
  // membership check against the FIXED native-code set, never a lookup
  // against `fonts` -- a native code is selected precisely when it's one of
  // ZPL_FONTS's six codes, regardless of whether some uploaded font also
  // happens to share that literal family name (an unlikely, out-of-scope
  // collision). Selecting a native code clears `customFont` (web parity:
  // an element renders with AT MOST one of the two font mechanisms active
  // at generation time -- see generateZpl.ts's own customFont-wins rule).
  // Selecting an event font leaves `fontFamily` untouched entirely: it's
  // simply not read by the generator once `customFont` is set, so there is
  // nothing useful to overwrite it with.
  // Bot review (PR #87, finding #3): generateZpl.ts's native valign block
  // only applies when `element.height` is truthy (generateTextZPL:178) -- a
  // fresh text element carries none (elementFootprint's 8mm default is a
  // DISPLAY fallback only, never written onto the element). Patching just
  // {valign} on such an element would silently do nothing at generation
  // time. When height is already explicit, only valign is patched (the
  // operator's own Height stays authoritative); the footprint height is
  // read from the SAME `footprint` this pane already computes for the
  // Width/Height fields below, so what gets persisted matches what's shown.
  function handleValignChange(value: "top" | "middle" | "bottom") {
    if (element!.height) {
      patch({ valign: value });
    } else {
      patch({ valign: value, height: footprint.height });
    }
  }

  function handleFontChange(value: string) {
    const isNativeCode = ZPL_FONTS.some((font) => font.code === value);
    if (isNativeCode) {
      patch({ customFont: undefined, fontFamily: value });
    } else {
      patch({ customFont: value });
    }
  }

  const isTextType = element.type === "text";
  const isBarcodeType = element.type === "barcode";
  const hasBindingSection = element.type === "text" || element.type === "qrcode" || element.type === "barcode";

  // Advisory only: a barcode whose resolved code can't fit its zone at the
  // readability floor (^BY2). Non-blocking -- guides long values to the QR
  // element (the compact answer; linear symbologies are wider). Recomputes
  // when the previewed persona changes (previewData is that reactive input).
  const barcodeOverflow =
    isBarcodeType &&
    barcodeFieldOrigin(element!, config.dpi, resolveElementText(element!, previewData).length).overflows;

  // Trim-aware "is customFont actually set?" -- the SAME rule generation
  // applies (generateZpl.ts's raster gate `customFont && customFont.trim()`
  // at :152 and its native-font command at :199): an empty or whitespace-only
  // customFont is NOT set. web's own editor legitimately persists
  // `customFont: ""` (BadgeTemplateEditorV2.tsx:801-804 writes its free-text
  // field verbatim), so a bare `??`/truthy check here would disagree with
  // what actually prints -- `{fontFamily: "B", customFont: ""}` prints with
  // B, and the select must say so, not silently sit on the first option.
  const trimmedCustomFont = element.customFont?.trim() ? element.customFont : undefined;
  // The font matching the element's (effectively set) customFont, if any --
  // used to decide whether customFont names a font that's since been
  // DELETED from the event (no match: the "missing font" branch below).
  const customFontMatch = trimmedCustomFont
    ? fonts.find((font) => font.family === trimmedCustomFont)
    : undefined;
  // A customFont naming a family that's no longer in `fonts` -- the
  // uploaded font was deleted after this element was configured to use it.
  // Rendered as a disabled, honestly-labeled option (never silently
  // dropped or substituted) so the select's `value` still matches a real
  // `<option>` (a controlled <select> whose value matches NO option falls
  // back to showing the first option instead, which would misrepresent
  // what's actually saved on the element) -- still selectable AWAY from via
  // any other (enabled) option in the list.
  const missingFontFamily = trimmedCustomFont && !customFontMatch ? trimmedCustomFont : undefined;
  // customFont set (matched or missing) always wins the select's displayed
  // value over fontFamily -- mirrors generateZpl.ts's own "customFont wins
  // at generation" precedence (reconciliation #11).
  const fontSelectValue = trimmedCustomFont ?? element.fontFamily ?? "0";

  // One option per FAMILY, first occurrence wins: the backend's uniqueness
  // constraint is family+weight+style, so a family can legitimately appear
  // several times in `fonts` (Roboto normal + Roboto bold). customFont
  // stores only the family -- two options sharing a value would be
  // duplicate <option value>s (the browser always resolves the FIRST, and
  // React warns) -- so weight/style variants deliberately collapse here.
  // The raster canvas picks the concrete face at draw time via the
  // element's own bold flag + the browser's font matching, never via this
  // list; the collapsed option carries the FIRST variant's coverage flag
  // (variants subset from the same upstream family in practice).
  const seenFamilies = new Set<string>();
  const fontsByFamily = fonts.filter((font) => {
    if (seenFamilies.has(font.family)) return false;
    seenFamilies.add(font.family);
    return true;
  });

  // Width/Height display the RENDERED footprint, not `width ?? 0`: for a
  // footprint-defaulted element (a fresh text element carries no explicit
  // width/height) the canvas draws -- and clamps against -- these default
  // dimensions, so showing 0 would misstate what's actually on the
  // artboard. The shown value is the rendered default until the operator
  // explicitly sets one (the first edit dispatches it onto the element).
  const footprint = elementFootprint(element);

  // Shared between text (its original position, unchanged) and barcode
  // (2026-07-20 barcode-alignment request) -- one JSX definition so the two
  // call sites can never drift apart, mirroring the codebase's existing
  // "one canonical computation" convention (e.g. rasterFieldOrigin,
  // valignOffsetDots in generateZpl.ts).
  function renderAlignmentControl() {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-card-title text-foreground">{t("badgePropsAlignment")}</span>
        <div
          role="group"
          aria-label={t("badgePropsAlignment")}
          className="inline-flex w-fit gap-1 rounded-md border border-border p-0.5"
        >
          {ALIGN_OPTIONS.map(({ value, icon: Icon, labelKey }) => {
            const pressed = (element!.align ?? "left") === value;
            return (
              <Button
                key={value}
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={pressed}
                aria-label={t(labelKey)}
                className={cn(pressed && "border-foreground bg-foreground text-background hover:bg-foreground/90")}
                onClick={() => patch({ align: value })}
              >
                <Icon aria-hidden className="size-4" />
              </Button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto rounded-lg border border-border p-4" data-testid="badge-pane-properties">
      <h3 className="text-body font-medium text-muted-foreground">{t("badgePaneProperties")}</h3>

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          id={IDS.x}
          label={t("badgePropsX")}
          value={element.x}
          onChange={(e) => handleNumberChange("x", e)}
        />
        <NumberField
          id={IDS.y}
          label={t("badgePropsY")}
          value={element.y}
          onChange={(e) => handleNumberChange("y", e)}
        />
        <NumberField
          id={IDS.width}
          label={t("badgePropsWidth")}
          value={footprint.width}
          onChange={(e) => handleNumberChange("width", e)}
        />
        <NumberField
          id={IDS.height}
          label={t("badgePropsHeight")}
          value={footprint.height}
          onChange={(e) => handleNumberChange("height", e)}
        />
      </div>

      {hasBindingSection && (
        <div className="flex flex-col gap-1">
          <Label htmlFor={IDS.binding}>{t("badgePropsBinding")}</Label>
          <Select value={element.source || BINDING_STATIC} onValueChange={handleBindingChange}>
            <SelectTrigger id={IDS.binding}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={BINDING_STATIC}>{t("badgeBindingStatic")}</SelectItem>
              {bindingOptions(fieldSchema).map((name) => (
                <SelectItem key={name} value={name}>
                  {displayBinding(name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isBarcodeType && renderAlignmentControl()}

      {isTextType && (
        <>
          <div className="flex flex-col gap-1">
            <Label htmlFor={IDS.text}>{t("badgePropsText")}</Label>
            <Input
              id={IDS.text}
              type="text"
              value={element.text ?? ""}
              disabled={!!element.source}
              onChange={(e) => patch({ text: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor={IDS.font}>{t("badgePropsFont")}</Label>
            <Select value={fontSelectValue} onValueChange={handleFontChange}>
              <SelectTrigger id={IDS.font}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* Built-in bitmap/scalable ZPL fonts -- Latin only (reconciliation #2). */}
                <SelectGroup>
                  <SelectLabel>{t("badgeFontsBuiltinNoCyr")}</SelectLabel>
                  {ZPL_FONTS.map(({ code, labelKey }) => (
                    <SelectItem key={code} value={code}>
                      {t(labelKey)}
                    </SelectItem>
                  ))}
                </SelectGroup>
                {/* A customFont naming a font that's been deleted since -- an
                    honest, disabled placeholder so the select's value still
                    matches a real item instead of silently falling back to
                    the first one in the list. */}
                {missingFontFamily && (
                  <SelectItem value={missingFontFamily} disabled>
                    {t("badgeFontMissing", { family: missingFontFamily })}
                  </SelectItem>
                )}
                {fontsByFamily.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>{t("badgeFontsEventGroup")}</SelectLabel>
                    {fontsByFamily.map((font) => (
                      <SelectItem key={font.id} value={font.family}>
                        {fontOptionLabel(font.family, fontCoverage[font.id], t)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>

          <NumberField
            id={IDS.fontSize}
            label={t("badgePropsFontSize")}
            value={element.fontSize ?? 12}
            step={1}
            min={1}
            onChange={(e) => {
              const value = e.target.valueAsNumber;
              if (Number.isNaN(value)) return;
              patch({ fontSize: value });
            }}
          />

          {renderAlignmentControl()}

          <div className="flex flex-col gap-1">
            <span className="text-card-title text-foreground">{t("badgePropsValign")}</span>
            <div
              role="group"
              aria-label={t("badgePropsValign")}
              className="inline-flex w-fit gap-1 rounded-md border border-border p-0.5"
            >
              {VALIGN_OPTIONS.map(({ value, icon: Icon, labelKey }) => {
                const pressed = (element.valign ?? "top") === value;
                return (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-pressed={pressed}
                    aria-label={t(labelKey)}
                    className={cn(pressed && "border-foreground bg-foreground text-background hover:bg-foreground/90")}
                    onClick={() => handleValignChange(value)}
                  >
                    <Icon aria-hidden className="size-4" />
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor={IDS.rotation}>{t("badgePropsRotation")}</Label>
            <Select
              value={String(element.rotation ?? 0)}
              onValueChange={(next) => patch({ rotation: Number(next) as 0 | 90 | 180 | 270 })}
            >
              <SelectTrigger id={IDS.rotation}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROTATIONS.map((deg) => (
                  <SelectItem key={deg} value={String(deg)}>
                    {deg}°
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <NumberField
            id={IDS.maxLines}
            label={t("badgePropsMaxLines")}
            value={element.maxLines ?? ""}
            step={1}
            min={1}
            onChange={(e) => {
              const value = e.target.valueAsNumber;
              if (Number.isNaN(value)) return;
              patch({ maxLines: value });
            }}
          />
        </>
      )}

      {isBarcodeType && (
        <div className="flex items-center gap-2">
          <Switch
            id={IDS.barcodeCaption}
            checked={element.showCaption !== false}
            onCheckedChange={(checked) => patch({ showCaption: checked })}
          />
          <Label htmlFor={IDS.barcodeCaption}>{t("badgePropsBarcodeCaption")}</Label>
        </div>
      )}

      {isBarcodeType && barcodeOverflow && (
        <p role="alert" className="text-caption text-warning">
          {t("badgeBarcodeOverflow")}
        </p>
      )}
    </div>
  );
}

function NumberField({
  id, label, value, step = 0.5, min, max, onChange,
}: {
  id: string;
  label: string;
  value: number | "";
  step?: number;
  min?: number;
  max?: number;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" step={step} min={min} max={max} value={value} onChange={onChange} />
    </div>
  );
}
