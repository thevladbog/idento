import { editorReducer, initialEditorState, type EditorState } from "./editorState";
import type { BadgeElement, BadgeTemplateDoc } from "./templateTypes";

const baseDoc: BadgeTemplateDoc = {
  width_mm: 90,
  height_mm: 55,
  dpi: 300,
  elements: [
    { id: "e1", type: "text", x: 1, y: 2, text: "Hi" },
    { id: "e2", type: "box", x: 5, y: 5, width: 10, height: 10 },
  ],
};

function stateWith(overrides: Partial<EditorState> = {}): EditorState {
  return { doc: baseDoc, version: 1, selectedId: null, dirty: false, savedAt: null, ...overrides };
}

describe("initialEditorState", () => {
  it("builds a fresh state with no selection, not dirty, never saved", () => {
    const doc: BadgeTemplateDoc = { width_mm: 90, height_mm: 55, dpi: 300, elements: [] };

    const state = initialEditorState(doc, 3);

    expect(state).toEqual({ doc, version: 3, selectedId: null, dirty: false, savedAt: null });
  });
});

describe("editorReducer", () => {
  describe("load", () => {
    it("replaces the doc/version and clears dirty + selection, regardless of prior state", () => {
      const prior = stateWith({ selectedId: "e1", dirty: true, savedAt: "2026-01-01T00:00:00Z", version: 1 });
      const newDoc: BadgeTemplateDoc = { width_mm: 100, height_mm: 60, dpi: 203, elements: [] };

      const next = editorReducer(prior, { type: "load", doc: newDoc, version: 7 });

      expect(next).toEqual({ doc: newDoc, version: 7, selectedId: null, dirty: false, savedAt: null });
    });
  });

  describe("select", () => {
    it("sets selectedId without touching dirty or the doc", () => {
      const prior = stateWith();

      const next = editorReducer(prior, { type: "select", id: "e2" });

      expect(next.selectedId).toBe("e2");
      expect(next.dirty).toBe(false);
      expect(next.doc).toBe(prior.doc);
    });

    it("clears selection with a null id", () => {
      const prior = stateWith({ selectedId: "e1" });

      const next = editorReducer(prior, { type: "select", id: null });

      expect(next.selectedId).toBeNull();
    });
  });

  describe("add", () => {
    it("appends the element, selects it, and sets dirty", () => {
      const prior = stateWith();
      const newElement: BadgeElement = { id: "e3", type: "line", x: 0, y: 0 };

      const next = editorReducer(prior, { type: "add", element: newElement });

      expect(next.doc.elements).toEqual([...baseDoc.elements, newElement]);
      expect(next.selectedId).toBe("e3");
      expect(next.dirty).toBe(true);
      // original doc must not be mutated
      expect(prior.doc.elements).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("patches only the matching element's fields, leaving other elements (and their references) untouched", () => {
      const prior = stateWith();

      const next = editorReducer(prior, { type: "update", id: "e1", patch: { text: "Bye", x: 9 } });

      expect(next.doc.elements[0]).toEqual({ id: "e1", type: "text", x: 9, y: 2, text: "Bye" });
      expect(next.doc.elements[1]).toBe(prior.doc.elements[1]); // untouched element: same reference
      expect(next.dirty).toBe(true);
    });

    it("is a strict no-op for a missing id: same state reference, dirty NOT set", () => {
      const prior = stateWith({ dirty: false });

      const next = editorReducer(prior, { type: "update", id: "does-not-exist", patch: { x: 1 } });

      expect(next).toBe(prior);
      expect(next.dirty).toBe(false);
    });
  });

  describe("remove", () => {
    it("removes the matching element and clears selection when it was selected", () => {
      const prior = stateWith({ selectedId: "e1" });

      const next = editorReducer(prior, { type: "remove", id: "e1" });

      expect(next.doc.elements.map((el) => el.id)).toEqual(["e2"]);
      expect(next.selectedId).toBeNull();
      expect(next.dirty).toBe(true);
    });

    it("leaves selection untouched when removing a different (unselected) element", () => {
      const prior = stateWith({ selectedId: "e2" });

      const next = editorReducer(prior, { type: "remove", id: "e1" });

      expect(next.selectedId).toBe("e2");
    });

    it("is a no-op for a missing id: same state reference, dirty NOT set", () => {
      const prior = stateWith({ dirty: false });

      const next = editorReducer(prior, { type: "remove", id: "does-not-exist" });

      expect(next).toBe(prior);
      expect(next.dirty).toBe(false);
    });
  });

  describe("move", () => {
    it("updates only x/y on the target element, storing values verbatim (no clamping)", () => {
      const prior = stateWith();

      const next = editorReducer(prior, { type: "move", id: "e1", x: -5, y: 999 });

      expect(next.doc.elements[0]).toEqual({ id: "e1", type: "text", x: -5, y: 999, text: "Hi" });
      expect(next.dirty).toBe(true);
      expect(next.doc.elements[1]).toBe(prior.doc.elements[1]);
    });

    it("is a no-op for a missing id: same state reference, dirty NOT set", () => {
      const prior = stateWith({ dirty: false });

      const next = editorReducer(prior, { type: "move", id: "does-not-exist", x: 1, y: 1 });

      expect(next).toBe(prior);
      expect(next.dirty).toBe(false);
    });
  });

  describe("resize", () => {
    it("updates only width/height on the target element, storing values verbatim (no clamping)", () => {
      const prior = stateWith();

      const next = editorReducer(prior, { type: "resize", id: "e2", width: 0, height: 500 });

      expect(next.doc.elements[1]).toEqual({ id: "e2", type: "box", x: 5, y: 5, width: 0, height: 500 });
      expect(next.dirty).toBe(true);
      expect(next.doc.elements[0]).toBe(prior.doc.elements[0]);
    });

    it("is a no-op for a missing id: same state reference, dirty NOT set", () => {
      const prior = stateWith({ dirty: false });

      const next = editorReducer(prior, { type: "resize", id: "does-not-exist", width: 1, height: 1 });

      expect(next).toBe(prior);
      expect(next.dirty).toBe(false);
    });
  });

  describe("updateConfig", () => {
    it("merges the patch onto the doc's config fields and sets dirty, leaving unaffected elements' references untouched", () => {
      const prior = stateWith({ dirty: false });

      // Growing the label can never push an in-bounds element out of
      // bounds, so both elements clamp to their existing x/y/width/height
      // -- the reducer must recognize that as a true no-op per element and
      // keep the SAME element references (mirrors "update"/"remove"'s own
      // reference-preservation for an unaffected element).
      const next = editorReducer(prior, { type: "updateConfig", patch: { width_mm: 100, height_mm: 60 } });

      expect(next.doc.width_mm).toBe(100);
      expect(next.doc.height_mm).toBe(60);
      expect(next.doc.dpi).toBe(300); // untouched: not part of this patch
      expect(next.doc.elements[0]).toBe(prior.doc.elements[0]);
      expect(next.doc.elements[1]).toBe(prior.doc.elements[1]);
      expect(next.dirty).toBe(true);
    });

    it("clamps an explicit-size element's position AND size when shrinking the label below it", () => {
      const prior = stateWith();

      // e2 (box, x=5,y=5,width=10,height=10) no longer fits an 8x8mm label
      // at all: position clamps to the origin (maxX/maxY floor at 0 per
      // clampPosition's own "footprint bigger than dimension" handling),
      // then size clamps to whatever room is left from that clamped
      // position to the new edge (clampSize's own minMm=1 floor never
      // applies here since 8mm of room remains).
      const next = editorReducer(prior, { type: "updateConfig", patch: { width_mm: 8, height_mm: 8 } });

      expect(next.doc.elements[1]).toEqual({ id: "e2", type: "box", x: 0, y: 0, width: 8, height: 8 });
    });

    it("clamps a footprint-only element's POSITION but never invents an explicit width/height for it", () => {
      const prior = stateWith();

      // e1 (text, x=1,y=2, no explicit width/height) renders/clamps
      // against its 40x8mm DEFAULT_SIZE_MM footprint everywhere else in
      // this editor; shrinking to 8x8mm pushes even that fallback
      // footprint out of bounds, so its position clamps to the origin --
      // but it must NOT come back out with an explicit width/height key
      // that it never had before (canvasMath's elementFootprint is a
      // clamp-bounds helper, never a value to write back).
      const next = editorReducer(prior, { type: "updateConfig", patch: { width_mm: 8, height_mm: 8 } });

      expect(next.doc.elements[0]).toEqual({ id: "e1", type: "text", x: 0, y: 0, text: "Hi" });
      expect(next.doc.elements[0]).not.toHaveProperty("width");
      expect(next.doc.elements[0]).not.toHaveProperty("height");
    });

    it("a dpi-only change never touches any element's geometry (dpi is not a clamp bound)", () => {
      const prior = stateWith();

      const next = editorReducer(prior, { type: "updateConfig", patch: { dpi: 600 } });

      expect(next.doc.dpi).toBe(600);
      expect(next.doc.width_mm).toBe(90);
      expect(next.doc.height_mm).toBe(55);
      expect(next.doc.elements[0]).toBe(prior.doc.elements[0]);
      expect(next.doc.elements[1]).toBe(prior.doc.elements[1]);
      expect(next.dirty).toBe(true);
    });
  });

  describe("saved", () => {
    it("clears dirty and bumps version + savedAt without touching doc or selection", () => {
      const prior = stateWith({ dirty: true, selectedId: "e2", version: 3 });

      const next = editorReducer(prior, { type: "saved", version: 4, savedAt: "2026-07-16T12:00:00Z" });

      expect(next.dirty).toBe(false);
      expect(next.version).toBe(4);
      expect(next.savedAt).toBe("2026-07-16T12:00:00Z");
      expect(next.doc).toBe(prior.doc);
      expect(next.selectedId).toBe("e2");
    });
  });
});
