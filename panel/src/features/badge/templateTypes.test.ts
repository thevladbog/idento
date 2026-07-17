import { editorReducer, initialEditorState } from "./editorState";
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

  // P3.2 Task 4: customFont is now a typed field (reconciliation #11 of the
  // P3.2 plan) — narrowElement reads it exactly like fontFamily/maxLines/etc.
  it("narrows a raw element's customFont into the typed doc", () => {
    const raw = {
      width_mm: 90,
      height_mm: 55,
      dpi: 300,
      elements: [{ id: "e1", type: "text", x: 1, y: 2, customFont: "TT0003M_" }],
    };

    const doc = parseTemplateDoc(raw);

    expect(doc.elements[0].customFont).toBe("TT0003M_");
  });

  it("leaves customFont absent (no key at all, not merely undefined) when the raw element doesn't carry one", () => {
    const raw = {
      width_mm: 90,
      height_mm: 55,
      dpi: 300,
      elements: [{ id: "e1", type: "text", x: 1, y: 2 }],
    };

    const doc = parseTemplateDoc(raw);

    expect("customFont" in doc.elements[0]).toBe(false);
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

  // Codex round Fix 6: duplicate element ids are legal in legacy docs
  // (backend's zpl.ParseBadgeTemplate does not enforce id uniqueness), but
  // left un-normalized they make the reducer's own id-keyed operations
  // ambiguous or wrong — editorState.ts's "remove" filters OUT every element
  // matching the target id (deleting BOTH copies at once instead of one),
  // and "select"/"update"/"move"/"resize" (which all resolve by
  // `id === action.id`) can't distinguish which copy is meant either. The
  // FIRST occurrence keeps its original id (deterministic — and the pairing
  // serializeTemplateDoc's own first-occurrence-wins merge already assumes,
  // see below); every SUBSEQUENT element sharing that id gets a freshly
  // generated id instead, so every id in a parsed doc's `elements` is unique
  // from this point on.
  it("normalizes duplicate element ids: the first occurrence keeps its id, subsequent duplicates get a fresh generated id", () => {
    const raw = {
      width_mm: 90,
      height_mm: 55,
      dpi: 300,
      elements: [
        { id: "e1", type: "text", x: 1, y: 2 },
        { id: "e1", type: "box", x: 3, y: 4 },
        { id: "e1", type: "line", x: 5, y: 6 }, // a THIRD duplicate, same id
      ],
    };

    const doc = parseTemplateDoc(raw);

    expect(doc.elements).toHaveLength(3);
    expect(doc.elements[0].id).toBe("e1");
    expect(doc.elements[1].id).not.toBe("e1");
    expect(doc.elements[2].id).not.toBe("e1");
    // every id (including the two renumbered ones) is unique
    expect(new Set(doc.elements.map((el) => el.id)).size).toBe(3);
  });

  it("lets 'remove' delete exactly the targeted duplicate, not every element that used to share its id", () => {
    const raw = {
      width_mm: 90,
      height_mm: 55,
      dpi: 300,
      elements: [
        { id: "e1", type: "text", x: 1, y: 2 },
        { id: "e1", type: "box", x: 3, y: 4 },
      ],
    };
    const doc = parseTemplateDoc(raw);
    const firstId = doc.elements[0].id;

    // Pre-fix, editorState.ts's "remove" filters OUT every element matching
    // the id — with both elements still sharing "e1", this would have
    // deleted BOTH. Post-normalization the ids are unique, so exactly one
    // element (the targeted one) is removed.
    const state = editorReducer(initialEditorState(doc, 1), { type: "remove", id: firstId });

    expect(state.doc.elements).toHaveLength(1);
    expect(state.doc.elements[0].id).not.toBe(firstId);
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

  // P3.2 Task 4 / reconciliation #11: customFont is now a TYPED field (see
  // templateTypes.ts's own BadgeElement/serializeTemplateDoc comments) — this
  // test still passes UNMODIFIED because neither element's customFont is
  // itself edited here (only e1's x changes), so the typed value narrowed at
  // parse time is identical to the original raw value: an UNTOUCHED
  // customFont still round-trips exactly like it did as a passthrough extra.
  // The NEW behavior (an EDITED customFont propagating, overwriting the
  // original) is covered by the two tests directly below this one.
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

  // Reconciliation #11's actual behavior change, pinned: before this task,
  // BadgeElement didn't declare `customFont` at all, so a typed patch could
  // never target it — only the ORIGINAL raw value ever survived a save,
  // even if some other, out-of-band process had changed it. Now that it's a
  // typed field, an editor patch that sets it flows through the SAME
  // `{...originalElement, ...element}` merge every other typed field
  // (x, fontSize, fontFamily, ...) already uses, so the edit wins.
  it("propagates an EDITED customFont on serialize -- typed fields overwrite the original (reconciliation #11)", () => {
    const raw = {
      width_mm: 90,
      height_mm: 55,
      dpi: 300,
      elements: [{ id: "e1", type: "text", x: 1, y: 2, customFont: "OldFont" }],
    };

    const doc = parseTemplateDoc(raw);
    const edited: BadgeTemplateDoc = {
      ...doc,
      elements: doc.elements.map((el) => (el.id === "e1" ? { ...el, customFont: "NewFont" } : el)),
    };
    const serialized = serializeTemplateDoc(edited, raw);
    const elements = serialized.elements as Array<Record<string, unknown>>;

    expect(elements.find((el) => el.id === "e1")?.customFont).toBe("NewFont");
    // the raw object itself is untouched (serializeTemplateDoc never mutates its `originalRaw` argument)
    expect((raw.elements[0] as Record<string, unknown>).customFont).toBe("OldFont");
  });

  // PropertiesPane's native-code selection dispatches `{customFont:
  // undefined, fontFamily: code}` (Task 4) -- this proves that patch
  // actually clears customFont on serialize rather than the merge falling
  // back to the original raw value (which an `undefined`-valued key could,
  // in principle, be mistaken for "absent" and skipped).
  it("clears customFont on serialize when a patch explicitly sets it to undefined (native-code selection semantics)", () => {
    const raw = {
      width_mm: 90,
      height_mm: 55,
      dpi: 300,
      elements: [{ id: "e1", type: "text", x: 1, y: 2, fontFamily: "0", customFont: "OldFont" }],
    };

    const doc = parseTemplateDoc(raw);
    const edited: BadgeTemplateDoc = {
      ...doc,
      elements: doc.elements.map((el) => (el.id === "e1" ? { ...el, customFont: undefined, fontFamily: "A" } : el)),
    };
    const serialized = serializeTemplateDoc(edited, raw);
    const elements = serialized.elements as Array<Record<string, unknown>>;
    const e1 = elements.find((el) => el.id === "e1");

    expect(e1?.customFont).toBeUndefined();
    expect(e1?.fontFamily).toBe("A");
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

  it("pairs duplicate element ids first-occurrence-wins: the first element keeps its own extras, the renumbered second keeps its own typed fields", () => {
    // Backend's zpl.ParseBadgeTemplate does NOT enforce id uniqueness, and
    // legacy web templates can carry duplicate ids. Codex round Fix 6:
    // parseTemplateDoc now normalizes these at PARSE time (first occurrence
    // keeps "e1"; the second gets a fresh generated id — see the
    // "parseTemplateDoc" describe block above) — this test proves that
    // renumbering doesn't change serializeTemplateDoc's own merge OUTCOME
    // for a genuinely-unknown extra, while pinning the ONE thing that DOES
    // now differ because of P3.2 Task 4 / reconciliation #11: `customFont`
    // is a TYPED field, so it no longer depends on `originalById`'s
    // first-occurrence-wins merge pairing at all — `parseTemplateDoc`
    // narrows it straight off EACH raw element (including the second
    // duplicate) at parse time, independent of which one later "wins" the
    // id-merge lookup below. Before this task, the second (unlinked)
    // duplicate's customFont was silently DROPPED on save (no merge
    // partner, no typed field to carry it) — that data-loss caveat is gone
    // now that customFont travels with the element itself, not with its
    // raw merge partner.
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
    expect(doc.elements[0].id).toBe("e1");
    const renumberedId = doc.elements[1].id;
    expect(renumberedId).not.toBe("e1");

    const serialized = serializeTemplateDoc(doc, raw);
    const elements = serialized.elements as Array<Record<string, unknown>>;

    expect(elements).toHaveLength(2);
    // first occurrence keeps ITS OWN extras — never the later duplicate's
    expect(elements[0]).toEqual({ id: "e1", type: "text", x: 1, y: 2, customFont: "A" });
    // renumbered second keeps ITS OWN typed customFont ("B") — carried by
    // the typed field itself, no merge partner required anymore.
    expect(elements[1]).toEqual({ id: renumberedId, type: "box", x: 3, y: 4, customFont: "B" });
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
