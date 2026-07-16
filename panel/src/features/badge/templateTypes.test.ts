import {
  parseTemplateDoc,
  serializeTemplateDoc,
  ZPL_FONTS,
  type BadgeTemplateDoc,
} from "./templateTypes";

describe("parseTemplateDoc", () => {
  it("returns the editor's new-doc default (90x55mm @ 300dpi, no elements) for a null template", () => {
    expect(parseTemplateDoc(null)).toEqual({
      width_mm: 90,
      height_mm: 55,
      dpi: 300,
      elements: [],
    });
  });

  it("returns the same new-doc default for a non-object raw value (defensive narrowing)", () => {
    expect(parseTemplateDoc(undefined)).toEqual({ width_mm: 90, height_mm: 55, dpi: 300, elements: [] });
    expect(parseTemplateDoc("not an object")).toEqual({ width_mm: 90, height_mm: 55, dpi: 300, elements: [] });
  });

  it("parses a full raw object into the typed doc, one field at a time", () => {
    const raw = {
      width_mm: 100,
      height_mm: 60,
      dpi: 203,
      elements: [
        {
          id: "e1",
          type: "text",
          x: 1,
          y: 2,
          width: 10,
          height: 5,
          fontSize: 12,
          text: "Hi",
          source: "first_name",
          align: "center",
          valign: "middle",
          rotation: 90,
          fontFamily: "A",
          maxLines: 2,
        },
      ],
    };

    const doc = parseTemplateDoc(raw);

    expect(doc).toEqual(raw);
  });

  it("tolerates junk element fields by skip-narrowing them from the typed view, without touching the raw object", () => {
    const raw = {
      width_mm: 90,
      height_mm: 55,
      dpi: 300,
      elements: [
        {
          id: "e1",
          type: "text",
          x: 1,
          y: 2,
          align: "diagonal", // not a valid align enum value
          rotation: 45, // not a valid rotation enum value
          mysteryField: "???", // not a BadgeElement field at all
        },
      ],
    };

    const doc = parseTemplateDoc(raw);

    expect(doc.elements).toHaveLength(1);
    const el = doc.elements[0] as unknown as Record<string, unknown>;
    expect(el.id).toBe("e1");
    expect(el.type).toBe("text");
    expect(el.x).toBe(1);
    expect(el.y).toBe(2);
    expect(el.align).toBeUndefined();
    expect(el.rotation).toBeUndefined();
    expect(el.mysteryField).toBeUndefined();

    // the raw object itself must be untouched
    const rawEl = raw.elements[0] as unknown as Record<string, unknown>;
    expect(rawEl.align).toBe("diagonal");
    expect(rawEl.rotation).toBe(45);
    expect(rawEl.mysteryField).toBe("???");
  });

  it("skips elements that don't structurally match (missing id/type/x/y) from the typed view", () => {
    const raw = {
      width_mm: 90,
      height_mm: 55,
      dpi: 300,
      elements: [
        { id: "ok", type: "text", x: 0, y: 0 },
        { type: "text", x: 0, y: 0 }, // missing id
        { id: "bad-type", type: "not-a-real-type", x: 0, y: 0 },
        { id: "bad-x", type: "text", x: "1", y: 0 },
      ],
    };

    const doc = parseTemplateDoc(raw);

    expect(doc.elements.map((el) => el.id)).toEqual(["ok"]);
  });
});

describe("serializeTemplateDoc — verbatim-preservation round-trip", () => {
  it("preserves an unknown top-level key across load -> edit -> serialize", () => {
    const raw = {
      width_mm: 90,
      height_mm: 55,
      dpi: 300,
      elements: [],
      internalNote: "do not delete", // unknown top-level key
    };

    const doc = parseTemplateDoc(raw);
    const edited: BadgeTemplateDoc = { ...doc, width_mm: 100 };
    const serialized = serializeTemplateDoc(edited, raw);

    expect(serialized.internalNote).toBe("do not delete");
    expect(serialized.width_mm).toBe(100);
    expect(serialized.height_mm).toBe(55);
    expect(serialized.dpi).toBe(300);
  });

  it("preserves a per-element customFont key across load -> edit -> serialize, matched by element id", () => {
    const raw = {
      width_mm: 90,
      height_mm: 55,
      dpi: 300,
      elements: [
        { id: "e1", type: "text", x: 1, y: 2, fontFamily: "0", customFont: "TT0003M_" },
        { id: "e2", type: "qrcode", x: 5, y: 5, customFont: "ARIAL.TTF" },
      ],
    };

    const doc = parseTemplateDoc(raw);
    // simulate the editor moving e1 and leaving e2 untouched
    const edited: BadgeTemplateDoc = {
      ...doc,
      elements: doc.elements.map((el) => (el.id === "e1" ? { ...el, x: 9 } : el)),
    };
    const serialized = serializeTemplateDoc(edited, raw);
    const elements = serialized.elements as Array<Record<string, unknown>>;

    const e1 = elements.find((el) => el.id === "e1");
    const e2 = elements.find((el) => el.id === "e2");
    expect(e1?.customFont).toBe("TT0003M_");
    expect(e1?.x).toBe(9); // the edit took effect
    expect(e2?.customFont).toBe("ARIAL.TTF");
    expect(e2?.x).toBe(5); // untouched element unchanged
  });

  it("does not mutate the original raw object passed in", () => {
    const raw = {
      width_mm: 90,
      height_mm: 55,
      dpi: 300,
      elements: [{ id: "e1", type: "text", x: 1, y: 2, customFont: "X" }],
    };
    const rawSnapshot = JSON.parse(JSON.stringify(raw));

    const doc = parseTemplateDoc(raw);
    serializeTemplateDoc({ ...doc, width_mm: 999 }, raw);

    expect(raw).toEqual(rawSnapshot);
  });

  it("serializes a newly-added element (no id match in originalRaw) using just its own typed fields", () => {
    const raw = { width_mm: 90, height_mm: 55, dpi: 300, elements: [] };
    const doc = parseTemplateDoc(raw);
    const edited: BadgeTemplateDoc = {
      ...doc,
      elements: [{ id: "new1", type: "box", x: 0, y: 0 }],
    };

    const serialized = serializeTemplateDoc(edited, raw);

    expect(serialized.elements).toEqual([{ id: "new1", type: "box", x: 0, y: 0 }]);
  });

  it("falls back to an empty base object when originalRaw is not an object (e.g. serializing a brand-new doc with no prior raw)", () => {
    const doc: BadgeTemplateDoc = { width_mm: 90, height_mm: 55, dpi: 300, elements: [] };
    const serialized = serializeTemplateDoc(doc, null);

    expect(serialized).toEqual({ width_mm: 90, height_mm: 55, dpi: 300, elements: [] });
  });

  it("pairs duplicate element ids first-occurrence-wins: the first element keeps its own extras, the second gets no merge partner", () => {
    // Backend's zpl.ParseBadgeTemplate does NOT enforce id uniqueness, and
    // legacy web templates can carry duplicate ids. Merge pairing must be
    // deterministic: the FIRST raw element with a given id is the merge
    // partner for the FIRST doc element with that id (and is consumed);
    // later doc elements with the same id get no partner, so nothing is
    // cross-inherited between same-id elements.
    const raw = {
      width_mm: 90,
      height_mm: 55,
      dpi: 300,
      elements: [
        { id: "e1", type: "text", x: 1, y: 2, customFont: "A" },
        { id: "e1", type: "box", x: 3, y: 4, customFont: "B" },
      ],
    };

    const doc = parseTemplateDoc(raw);
    expect(doc.elements).toHaveLength(2);

    const serialized = serializeTemplateDoc(doc, raw);
    const elements = serialized.elements as Array<Record<string, unknown>>;

    expect(elements).toHaveLength(2);
    // first occurrence keeps ITS OWN extras — never the later duplicate's
    expect(elements[0]).toEqual({ id: "e1", type: "text", x: 1, y: 2, customFont: "A" });
    // second duplicate has no merge partner: own typed fields only, no
    // cross-inherited customFont from either raw element
    expect(elements[1]).toEqual({ id: "e1", type: "box", x: 3, y: 4 });
  });

  it("documents that a raw element with no string id is dropped by parse and does not reappear after serialize", () => {
    // Legacy-path caveat, pinned deliberately: the typed view (and therefore
    // any panel save built from it) only carries elements that structurally
    // narrowed — an id-less element from a legacy/hand-crafted document is
    // dropped by parseTemplateDoc and serializeTemplateDoc has no id to
    // match it back by, so its extras (customFont here) are lost on save.
    // Tasks 5+ inherit this knowingly: verbatim preservation is guaranteed
    // per element only when the element has a string id.
    const raw = {
      width_mm: 90,
      height_mm: 55,
      dpi: 300,
      elements: [
        { id: "ok", type: "text", x: 0, y: 0 },
        { type: "text", x: 1, y: 1, customFont: "legacy" }, // no id
      ],
    };

    const doc = parseTemplateDoc(raw);
    expect(doc.elements.map((el) => el.id)).toEqual(["ok"]);

    const serialized = serializeTemplateDoc(doc, raw);

    expect(serialized.elements).toEqual([{ id: "ok", type: "text", x: 0, y: 0 }]);
  });
});

describe("ZPL_FONTS", () => {
  it("lists the six ZPL font codes (scalable + five bitmap sizes) with label keys", () => {
    expect(ZPL_FONTS).toEqual([
      { code: "0", labelKey: "badgeFontScalable" },
      { code: "A", labelKey: "badgeFontA12pt" },
      { code: "B", labelKey: "badgeFontB14pt" },
      { code: "C", labelKey: "badgeFontC18pt" },
      { code: "D", labelKey: "badgeFontD24pt" },
      { code: "E", labelKey: "badgeFontE28pt" },
    ]);
  });
});
