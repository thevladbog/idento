// Hand-written badge-template format types — the single source of truth for
// the whole badge editor (P3.1). This mirrors the JSON shape
// backend/internal/zpl/zpl.go:14-37 (Config + BadgeElement structs) decodes
// and zpl.ParseBadgeTemplate validates against; it deliberately does NOT
// include zpl.go's `Bold bool` field — reconciliation #1 found the ZPL
// generator never reads it (a dead field), so the panel editor doesn't
// expose or round-trip it either.

export interface BadgeConfig {
  width_mm: number;
  height_mm: number;
  dpi: number;
}

export type BadgeElementType = "text" | "qrcode" | "barcode" | "line" | "box";

export interface BadgeElement {
  id: string;
  type: BadgeElementType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  fontSize?: number;
  text?: string;
  source?: string;
  align?: "left" | "center" | "right";
  valign?: string;
  rotation?: 0 | 90 | 180 | 270;
  fontFamily?: string;
  maxLines?: number;
}

export interface BadgeTemplateDoc extends BadgeConfig {
  elements: BadgeElement[];
}

const VALID_ELEMENT_TYPES: ReadonlySet<string> = new Set<BadgeElementType>([
  "text",
  "qrcode",
  "barcode",
  "line",
  "box",
]);

const VALID_ALIGNS: ReadonlySet<string> = new Set(["left", "center", "right"]);
const VALID_ROTATIONS: ReadonlySet<number> = new Set([0, 90, 180, 270]);

// The editor's default document for a brand-new template — shown on the
// empty-state editor as the "90 × 55 mm · 300 dpi · Zebra ZD421" caption
// (board 4a). This is a UI-only default and is DELIBERATELY different from
// zpl.go's own nil-Config fallback of 50×30mm @ 203dpi (zpl.go:14-37 —
// GenerateZPL substitutes that fallback when Config is the zero value, so
// the ZPL generator never divides by a zero DPI on a template saved before
// P3.1 introduced explicit config). Once any template is saved through this
// editor its width_mm/height_mm/dpi are always explicit in the doc, so the
// backend's 50×30@203 fallback can never apply to an editor-created
// template — only to older documents that predate it.
const NEW_DOC_DEFAULT: BadgeTemplateDoc = {
  width_mm: 90,
  height_mm: 55,
  dpi: 300,
  elements: [],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Best-effort, defensive narrowing of one raw element into a typed
// BadgeElement. Returns null when the element doesn't structurally match at
// all (missing/wrong-typed id, type, x, or y) — such elements are skipped
// from the typed `elements` array entirely (they can't be rendered/edited
// meaningfully), but note this NEVER touches the raw object itself: the
// caller (parseTemplateDoc) only ever reads from `raw`, and
// serializeTemplateDoc always merges back onto the original raw element by
// id, so even a skipped-narrow's untouched raw properties come back on
// save. Optional fields that are present but don't match their expected
// type/enum (e.g. align: "diagonal", rotation: 45) are simply left out of
// the typed view (skip-narrow) rather than rejecting the whole element.
function narrowElement(raw: unknown): BadgeElement | null {
  if (!isPlainObject(raw)) return null;
  const { id, type, x, y } = raw;
  if (typeof id !== "string") return null;
  if (typeof type !== "string" || !VALID_ELEMENT_TYPES.has(type)) return null;
  if (typeof x !== "number" || typeof y !== "number") return null;

  const element: BadgeElement = { id, type: type as BadgeElementType, x, y };
  if (typeof raw.width === "number") element.width = raw.width;
  if (typeof raw.height === "number") element.height = raw.height;
  if (typeof raw.fontSize === "number") element.fontSize = raw.fontSize;
  if (typeof raw.text === "string") element.text = raw.text;
  if (typeof raw.source === "string") element.source = raw.source;
  if (typeof raw.align === "string" && VALID_ALIGNS.has(raw.align)) {
    element.align = raw.align as "left" | "center" | "right";
  }
  if (typeof raw.valign === "string") element.valign = raw.valign;
  if (typeof raw.rotation === "number" && VALID_ROTATIONS.has(raw.rotation)) {
    element.rotation = raw.rotation as 0 | 90 | 180 | 270;
  }
  if (typeof raw.fontFamily === "string") element.fontFamily = raw.fontFamily;
  if (typeof raw.maxLines === "number") element.maxLines = raw.maxLines;
  return element;
}

// Defensively narrows the server's `template: object | null` (GET/PUT
// /api/events/{id}/badge-template's BadgeTemplateResponse.template) into a
// typed BadgeTemplateDoc. A null (or otherwise non-object) template — the
// event has never had one saved — yields the EDITOR's new-doc default
// above, never null: the caller always gets a renderable doc.
//
// This is READ-ONLY narrowing for the editor's own rendering/editing
// convenience. It never mutates or drops data from the server's response:
// callers must keep the original `raw` argument around (e.g. in query
// state) and pass it as serializeTemplateDoc's `originalRaw` so unknown
// top-level keys and per-element extras (like the web editor's
// `customFont`) survive a load -> edit -> save round trip untouched — see
// serializeTemplateDoc below (reconciliation #4).
export function parseTemplateDoc(raw: unknown): BadgeTemplateDoc {
  if (!isPlainObject(raw)) {
    return { ...NEW_DOC_DEFAULT, elements: [] };
  }

  const width_mm = typeof raw.width_mm === "number" ? raw.width_mm : NEW_DOC_DEFAULT.width_mm;
  const height_mm = typeof raw.height_mm === "number" ? raw.height_mm : NEW_DOC_DEFAULT.height_mm;
  const dpi = typeof raw.dpi === "number" ? raw.dpi : NEW_DOC_DEFAULT.dpi;
  const rawElements = Array.isArray(raw.elements) ? raw.elements : [];
  const elements = rawElements
    .map(narrowElement)
    .filter((element): element is BadgeElement => element !== null);

  return { width_mm, height_mm, dpi, elements };
}

// Merges an edited typed doc back onto `originalRaw` (the same raw value
// parseTemplateDoc produced `doc`'s ancestor from), so a panel save never
// strips fields the shipped web/ editor writes that this typed view doesn't
// know about:
//  - Top-level extras: originalRaw's own keys are spread first, then
//    overwritten by the four known BadgeConfig/elements keys from `doc` —
//    any other key on originalRaw (e.g. a future top-level flag) survives.
//  - Per-element extras (e.g. `customFont`): each edited element is matched
//    to the original raw element with the same `id`, and the ORIGINAL
//    element's keys are spread first, then overwritten by the edited
//    element's typed fields. A newly-added element (no id match in
//    originalRaw, e.g. the editor just created it) has nothing to merge and
//    serializes as just its own fields.
//
// Returns a plain object (not BadgeTemplateDoc) since the merged result may
// carry unknown keys beyond the typed shape — this is exactly what gets
// PUT as BadgeTemplatePutRequest.template.
export function serializeTemplateDoc(doc: BadgeTemplateDoc, originalRaw: unknown): Record<string, unknown> {
  const base = isPlainObject(originalRaw) ? originalRaw : {};
  const originalElements = Array.isArray(base.elements) ? base.elements : [];
  // First-occurrence-wins pairing for duplicate ids: the backend's
  // zpl.ParseBadgeTemplate does NOT enforce id uniqueness, and legacy web
  // templates can carry two elements sharing an id. A plain Map.set here
  // would let the LAST duplicate win as merge partner for EVERY doc element
  // with that id (silently cross-inheriting its extras onto the first).
  // Instead, the FIRST raw occurrence keeps the id (deterministic, and the
  // most likely intended pairing since parseTemplateDoc preserves element
  // order), and each entry is consumed on use below so a second doc element
  // with the same id gets NO merge partner rather than the wrong one —
  // degrading to its own typed fields, never crashing, never mixing extras
  // between same-id elements.
  const originalById = new Map<string, Record<string, unknown>>();
  for (const element of originalElements) {
    if (isPlainObject(element) && typeof element.id === "string" && !originalById.has(element.id)) {
      originalById.set(element.id, element);
    }
  }

  const elements = doc.elements.map((element) => {
    const originalElement = originalById.get(element.id);
    if (originalElement === undefined) return { ...element };
    originalById.delete(element.id); // consume: each original merges at most once
    return { ...originalElement, ...element };
  });

  return {
    ...base,
    width_mm: doc.width_mm,
    height_mm: doc.height_mm,
    dpi: doc.dpi,
    elements,
  };
}

// ZPL bitmap font choices for the properties inspector's font picker
// (reconciliation #6) — mirrors zpl.go's getZPLFont: "0" is the scalable
// fallback used whenever fontSize doesn't exactly match one of the fixed
// bitmap sizes below; A/B/C/D/E are those bitmap fonts at their fixed point
// sizes (12/14/18/24/28pt respectively). labelKey values are i18n keys —
// the actual copy is added by the task that renders this list (properties
// inspector), not here.
export const ZPL_FONTS = [
  { code: "0", labelKey: "badgeFontScalable" },
  { code: "A", labelKey: "badgeFontA12pt" },
  { code: "B", labelKey: "badgeFontB14pt" },
  { code: "C", labelKey: "badgeFontC18pt" },
  { code: "D", labelKey: "badgeFontD24pt" },
  { code: "E", labelKey: "badgeFontE28pt" },
] as const;
