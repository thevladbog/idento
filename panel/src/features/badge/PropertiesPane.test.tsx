import { fireEvent, render, screen } from "@testing-library/react";
import { PropertiesPane, type PropertiesPaneProps } from "./PropertiesPane";
import type { BadgeConfig, BadgeElement } from "./templateTypes";
import type { components } from "../../shared/api/schema";
import "../../shared/i18n";

type FontListItem = components["schemas"]["FontListItem"];

const CONFIG: BadgeConfig = { width_mm: 90, height_mm: 55, dpi: 300 };

// Same fixture shape FontsCard.test.tsx / fontCoverage.test.ts use for
// FontListItem -- only the fields this pane actually reads (id, family) vary
// meaningfully across the two fixtures below.
function fontListItem(id: string, family: string): FontListItem {
  return {
    id,
    name: family,
    family,
    weight: "normal",
    style: "normal",
    format: "truetype",
    size: 1024,
    created_at: "2026-01-01T00:00:00Z",
  };
}

function renderPane(overrides: Partial<PropertiesPaneProps> = {}) {
  const onUpdate = vi.fn();
  const props: PropertiesPaneProps = {
    element: null,
    fieldSchema: [],
    config: CONFIG,
    fonts: [],
    fontCoverage: {},
    onUpdate,
    ...overrides,
  };
  const utils = render(<PropertiesPane {...props} />);
  return { onUpdate, ...utils };
}

describe("PropertiesPane", () => {
  describe("empty state", () => {
    it("shows a muted hint and no form controls when nothing is selected", () => {
      renderPane({ element: null });

      expect(screen.getByText("Select an element to edit its properties.")).toBeInTheDocument();
      expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });
  });

  describe("common section (position/size, all types)", () => {
    it("shows X/Y/Width/Height with the element's current values", () => {
      renderPane({
        element: { id: "e1", type: "box", x: 5, y: 10, width: 20, height: 12 },
      });

      expect(screen.getByLabelText("X (mm)")).toHaveValue(5);
      expect(screen.getByLabelText("Y (mm)")).toHaveValue(10);
      expect(screen.getByLabelText("Width (mm)")).toHaveValue(20);
      expect(screen.getByLabelText("Height (mm)")).toHaveValue(12);
    });

    it("clamps an X change that would push the element past the artboard edge before dispatching", () => {
      // 90mm-wide board, 20mm-wide element -> max-fitting x is 70 (same
      // worked example as BadgeCanvas.test.tsx's own drag-clamp coverage).
      const { onUpdate } = renderPane({
        element: { id: "e1", type: "box", x: 5, y: 5, width: 20, height: 10 },
      });

      fireEvent.change(screen.getByLabelText("X (mm)"), { target: { value: "999" } });

      expect(onUpdate).toHaveBeenCalledWith("e1", { x: 70 });
    });

    it("clamps a Width change that would push the element's far edge past the artboard", () => {
      // x=5 on a 90mm board -> max width is 85.
      const { onUpdate } = renderPane({
        element: { id: "e1", type: "box", x: 5, y: 5, width: 20, height: 10 },
      });

      fireEvent.change(screen.getByLabelText("Width (mm)"), { target: { value: "999" } });

      expect(onUpdate).toHaveBeenCalledWith("e1", { width: 85 });
    });

    it("ignores a non-numeric X input (cleared field) without dispatching", () => {
      const { onUpdate } = renderPane({
        element: { id: "e1", type: "box", x: 5, y: 5, width: 20, height: 10 },
      });

      fireEvent.change(screen.getByLabelText("X (mm)"), { target: { value: "" } });

      expect(onUpdate).not.toHaveBeenCalled();
    });

    it("clamps X for a width/height-less text element with the SAME rendered footprint the canvas uses", () => {
      // A fresh text element carries no explicit width/height
      // (ElementsPane's ELEMENT_DEFAULTS.text sets neither), but the canvas
      // renders it 40x8mm (canvasMath's DEFAULT_SIZE_MM.text) and clamps
      // drag/nudge against that footprint: max-fitting x on a 90mm board is
      // 50. A typed X must clamp to the SAME 50 -- not 90, which a raw
      // `width ?? 0` clamp would allow, parking the element entirely off
      // the artboard (regression coverage: one footprint rule across ALL
      // THREE input paths -- drag, nudge, and typed properties).
      const { onUpdate } = renderPane({
        element: { id: "t1", type: "text", x: 5, y: 5, text: "Hi" },
      });

      fireEvent.change(screen.getByLabelText("X (mm)"), { target: { value: "999" } });

      expect(onUpdate).toHaveBeenCalledWith("t1", { x: 50 });
    });

    it("shows the rendered default footprint (not 0) as Width/Height for a footprint-defaulted element", () => {
      renderPane({
        element: { id: "t1", type: "text", x: 5, y: 5, text: "Hi" },
      });

      // 40x8mm: the same default the canvas renders/clamps this element
      // with -- showing 0 would misstate what's actually on the artboard.
      expect(screen.getByLabelText("Width (mm)")).toHaveValue(40);
      expect(screen.getByLabelText("Height (mm)")).toHaveValue(8);
    });
  });

  describe("text element", () => {
    const textElement: BadgeElement = {
      id: "e1",
      type: "text",
      x: 5,
      y: 10,
      width: 40,
      height: 8,
      text: "Hello",
      source: "first_name",
      align: "center",
      rotation: 90,
      fontFamily: "A",
      fontSize: 14,
      maxLines: 2,
    };

    it("shows all text controls with the element's current values", () => {
      renderPane({ element: textElement });

      expect(screen.getByLabelText("Binding")).toHaveValue("first_name");
      expect(screen.getByLabelText("Text")).toHaveValue("Hello");
      expect(screen.getByLabelText("Font")).toHaveValue("A");
      expect(screen.getByLabelText("Font size (pt)")).toHaveValue(14);
      expect(screen.getByLabelText("Rotation")).toHaveValue("90");
      expect(screen.getByLabelText("Max lines")).toHaveValue(2);

      expect(screen.getByRole("button", { name: "Align center" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Align left" })).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("button", { name: "Align right" })).toHaveAttribute("aria-pressed", "false");
    });

    it("disables the static-text input while a binding is active", () => {
      renderPane({ element: textElement });

      expect(screen.getByLabelText("Text")).toBeDisabled();
    });

    it("lists 'Static text' plus the standard + custom bindings, shown as {name}", () => {
      renderPane({ element: textElement, fieldSchema: ["dietary"] });

      const select = screen.getByLabelText("Binding");
      const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
      expect(options).toEqual([
        "Static text",
        "{first_name}",
        "{last_name}",
        "{email}",
        "{company}",
        "{position}",
        "{code}",
        "{dietary}",
      ]);
    });

    describe("binding switch", () => {
      it("switching to a real binding option patches {source} with that name", () => {
        const { onUpdate } = renderPane({ element: textElement });

        fireEvent.change(screen.getByLabelText("Binding"), { target: { value: "last_name" } });

        expect(onUpdate).toHaveBeenCalledWith("e1", { source: "last_name" });
      });

      it("switching to 'Static text' clears source (and the text input becomes enabled on the next render)", () => {
        const { onUpdate, rerender } = renderPane({ element: textElement });

        fireEvent.change(screen.getByLabelText("Binding"), { target: { value: "" } });

        expect(onUpdate).toHaveBeenCalledWith("e1", { source: undefined });

        // Re-render as the reducer would after applying that patch -- the
        // static-text input should now be enabled.
        rerender(
          <PropertiesPane
            element={{ ...textElement, source: undefined }}
            fieldSchema={[]}
            config={CONFIG}
            fonts={[]}
            fontCoverage={{}}
            onUpdate={onUpdate}
          />,
        );
        expect(screen.getByLabelText("Text")).not.toBeDisabled();
      });
    });

    describe("font select", () => {
      it("patches fontFamily with the CODE, not the visible label", () => {
        const { onUpdate } = renderPane({ element: textElement });

        fireEvent.change(screen.getByLabelText("Font"), { target: { value: "0" } });

        expect(onUpdate).toHaveBeenCalledWith("e1", { fontFamily: "0" });
      });

      it("renders the documented font labels", () => {
        renderPane({ element: textElement });

        const select = screen.getByLabelText("Font");
        const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
        expect(options).toEqual([
          "Scalable (0)",
          "A · 12 pt",
          "B · 14 pt",
          "C · 18 pt",
          "D · 24 pt",
          "E · 28 pt",
        ]);
      });

      // P3.2 Task 4: event fonts in an "Event fonts" optgroup, coverage
      // flags carried in the option TEXT (native <option> can't hold a
      // component) -- ✓/no-Cyr per font, and no flag at all while coverage
      // is still undefined (never a guessed flag).
      describe("event fonts", () => {
        const FONTS = [
          { id: "font-cyr", family: "CyrFont" },
          { id: "font-latin", family: "LatinFont" },
          { id: "font-loading", family: "LoadingFont" },
        ].map((f) => fontListItem(f.id, f.family));

        it("lists the built-in group plus an Event fonts group with coverage-flagged labels", () => {
          renderPane({
            element: textElement,
            fonts: FONTS,
            fontCoverage: { "font-cyr": true, "font-latin": false },
          });

          const select = screen.getByLabelText("Font");
          const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
          expect(options).toEqual([
            "Scalable (0)",
            "A · 12 pt",
            "B · 14 pt",
            "C · 18 pt",
            "D · 24 pt",
            "E · 28 pt",
            "CyrFont (✓ Cyr)",
            "LatinFont (no Cyr)",
            "LoadingFont", // coverage undefined (still loading/unparseable) -- no flag text at all
          ]);

          const optgroups = Array.from(select.querySelectorAll("optgroup")).map((g) => g.getAttribute("label"));
          expect(optgroups).toEqual(["Built-in ZPL — Latin only", "Event fonts"]);
        });

        it("selecting an event font patches {customFont: family}, leaving fontFamily untouched", () => {
          const { onUpdate } = renderPane({ element: textElement, fonts: FONTS, fontCoverage: {} });

          fireEvent.change(screen.getByLabelText("Font"), { target: { value: "CyrFont" } });

          expect(onUpdate).toHaveBeenCalledWith("e1", { customFont: "CyrFont" });
        });

        it("selecting a native code clears customFont and sets fontFamily to that code", () => {
          const { onUpdate } = renderPane({
            element: { ...textElement, customFont: "CyrFont" },
            fonts: FONTS,
            fontCoverage: {},
          });

          fireEvent.change(screen.getByLabelText("Font"), { target: { value: "A" } });

          expect(onUpdate).toHaveBeenCalledWith("e1", { customFont: undefined, fontFamily: "A" });
        });

        it("selects the event-font option (over fontFamily) when customFont is set", () => {
          renderPane({
            element: { ...textElement, fontFamily: "A", customFont: "LatinFont" },
            fonts: FONTS,
            fontCoverage: {},
          });

          expect(screen.getByLabelText("Font")).toHaveValue("LatinFont");
        });

        // Trim-aware precedence, matching generation exactly: generateZpl.ts
        // only honors customFont when `customFont && customFont.trim()` is
        // truthy (its raster gate at :152 and native-font command at :199),
        // and web's own editor legitimately persists `customFont: ""`
        // (BadgeTemplateEditorV2.tsx:801-804 writes the free-text field
        // verbatim). A bare `??` here treated "" as SET, silently showing
        // "Scalable (0)" while the printer used fontFamily "B" -- the select
        // must show what actually prints.
        it("shows the fontFamily code (not the first option) when customFont is an empty string", () => {
          renderPane({
            element: { ...textElement, fontFamily: "B", customFont: "" },
            fonts: FONTS,
            fontCoverage: {},
          });

          expect(screen.getByLabelText("Font")).toHaveValue("B");
        });

        it("treats a whitespace-only customFont as unset too (no missing-font option, fontFamily wins)", () => {
          renderPane({
            element: { ...textElement, fontFamily: "C", customFont: "   " },
            fonts: FONTS,
            fontCoverage: {},
          });

          const select = screen.getByLabelText("Font");
          expect(select).toHaveValue("C");
          // No phantom "missing font" placeholder for a blank value.
          expect(
            Array.from(select.querySelectorAll("option")).some((o) => o.textContent?.includes("font removed")),
          ).toBe(false);
        });

        it("renders a disabled 'missing font' option when customFont names a font no longer in the list", () => {
          renderPane({
            element: { ...textElement, customFont: "DeletedFont" },
            fonts: FONTS,
            fontCoverage: {},
          });

          const select = screen.getByLabelText("Font");
          expect(select).toHaveValue("DeletedFont");
          const missingOption = Array.from(select.querySelectorAll("option")).find(
            (o) => (o as HTMLOptionElement).value === "DeletedFont",
          ) as HTMLOptionElement;
          expect(missingOption).toBeDefined();
          expect(missingOption.disabled).toBe(true);
          expect(missingOption.textContent).toBe("DeletedFont (font removed)");
        });

        // The backend's uniqueness constraint is family+weight+style, so one
        // family can appear several times in the fonts list (e.g. Roboto
        // normal + Roboto bold). customFont stores only the FAMILY, so two
        // options with the same value would be duplicate <option value>s --
        // the optgroup dedupes by family, first occurrence wins.
        it("dedupes same-family weight/style variants into ONE option (first occurrence's coverage flag)", () => {
          renderPane({
            element: textElement,
            fonts: [
              fontListItem("font-reg", "Roboto"),
              { ...fontListItem("font-bold", "Roboto"), weight: "bold" },
            ],
            fontCoverage: { "font-reg": true, "font-bold": false },
          });

          const select = screen.getByLabelText("Font");
          const eventGroup = select.querySelector('optgroup[label="Event fonts"]');
          const options = Array.from(eventGroup?.querySelectorAll("option") ?? []).map((o) => o.textContent);
          expect(options).toEqual(["Roboto (✓ Cyr)"]);
        });

        it("renders no Event fonts group at all when the event has no uploaded fonts", () => {
          renderPane({ element: textElement, fonts: [], fontCoverage: {} });

          const select = screen.getByLabelText("Font");
          const optgroups = Array.from(select.querySelectorAll("optgroup")).map((g) => g.getAttribute("label"));
          expect(optgroups).toEqual(["Built-in ZPL — Latin only"]);
        });
      });
    });

    describe("alignment buttons", () => {
      it("clicking a segment patches align and only that segment is aria-pressed", () => {
        const { onUpdate } = renderPane({ element: textElement });

        fireEvent.click(screen.getByRole("button", { name: "Align right" }));

        expect(onUpdate).toHaveBeenCalledWith("e1", { align: "right" });
      });

      it("defaults to Align left pressed when the element has no explicit align", () => {
        renderPane({ element: { ...textElement, align: undefined } });

        expect(screen.getByRole("button", { name: "Align left" })).toHaveAttribute("aria-pressed", "true");
      });
    });

    describe("rotation select", () => {
      it("patches rotation as a number", () => {
        const { onUpdate } = renderPane({ element: textElement });

        fireEvent.change(screen.getByLabelText("Rotation"), { target: { value: "180" } });

        expect(onUpdate).toHaveBeenCalledWith("e1", { rotation: 180 });
      });
    });

    // 2026-07-20 live-run request: generateZpl.ts's native text path already
    // honors element.valign+height (generateTextZPL, ~line 177) but this
    // control was never exposed. The raster branch DROPS valign entirely
    // (goldenMatrix.test.ts pins that), so the control is disabled -- with an
    // honest hint, never silently applied and then ignored -- whenever THIS
    // element is deterministically known to raster: a set customFont (forces
    // raster regardless of text/data), or unbound (no source) text whose
    // literal content needsImageRendering (Cyrillic/CJK/Arabic). A BOUND
    // element's actual per-attendee text isn't known at edit time, so it's
    // never disabled on that basis alone -- only customFont can gate a bound
    // element.
    describe("vertical align buttons", () => {
      it("clicking a segment patches valign and only that segment is aria-pressed", () => {
        const { onUpdate } = renderPane({ element: textElement });

        fireEvent.click(screen.getByRole("button", { name: "Align bottom" }));

        expect(onUpdate).toHaveBeenCalledWith("e1", { valign: "bottom" });
      });

      // Bot review (PR #87, finding #3): generateZpl.ts's native valign block
      // only fires when `element.height` is truthy (generateTextZPL:178) --
      // a fresh text element carries no explicit height at all (only the
      // Properties pane's DISPLAYED footprint fallback, elementFootprint,
      // shows 8mm without ever writing it onto the element). Clicking a
      // valign segment on such an element used to be a silent no-op: the
      // patch set {valign} but the generator's height check still failed.
      // Setting valign now also persists the SAME footprint height the pane
      // already displays -- one dispatch, mirroring the two-field-patch
      // precedent handleFontChange already uses for clearing customFont
      // alongside setting fontFamily.
      it("also patches the displayed footprint height when the element has no explicit height (so valign isn't a silent no-op)", () => {
        const { onUpdate } = renderPane({
          element: { id: "t1", type: "text", x: 5, y: 5, text: "Hi" }, // no width/height
        });

        fireEvent.click(screen.getByRole("button", { name: "Align middle" }));

        // 8mm: canvasMath's DEFAULT_SIZE_MM.text -- the SAME value the
        // Height field already displays for this element.
        expect(onUpdate).toHaveBeenCalledWith("t1", { valign: "middle", height: 8 });
      });

      it("does NOT patch height when the element already has an explicit height", () => {
        const { onUpdate } = renderPane({ element: textElement }); // width:40, height:8 explicit

        fireEvent.click(screen.getByRole("button", { name: "Align bottom" }));

        expect(onUpdate).toHaveBeenCalledWith("e1", { valign: "bottom" });
        expect(onUpdate).not.toHaveBeenCalledWith("e1", expect.objectContaining({ height: expect.anything() }));
      });

      it("defaults to Align top pressed when the element has no explicit valign", () => {
        renderPane({ element: { ...textElement, valign: undefined } });

        expect(screen.getByRole("button", { name: "Align top" })).toHaveAttribute("aria-pressed", "true");
      });

      it("shows the element's current valign as pressed", () => {
        renderPane({ element: { ...textElement, valign: "middle" } });

        expect(screen.getByRole("button", { name: "Align middle" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "Align top" })).toHaveAttribute("aria-pressed", "false");
      });

      it("is enabled for a plain native-path text element (no customFont, Latin static text)", () => {
        renderPane({ element: { ...textElement, source: undefined, text: "Hello", customFont: undefined } });

        expect(screen.getByRole("button", { name: "Align top" })).toBeEnabled();
        expect(screen.queryByText(/dropped|ignored|raster/i)).not.toBeInTheDocument();
      });

      it("disables the group and shows a hint when customFont is set (forces the raster path regardless of text)", () => {
        renderPane({ element: { ...textElement, customFont: "Roboto" } });

        expect(screen.getByRole("button", { name: "Align top" })).toBeDisabled();
        expect(screen.getByText("This element prints as an image; vertical align is ignored.")).toBeInTheDocument();
      });

      it("disables the group when unbound static text is Cyrillic (deterministically rasters, same rule as generation)", () => {
        renderPane({
          element: { ...textElement, source: undefined, text: "Привет", customFont: undefined },
        });

        expect(screen.getByRole("button", { name: "Align top" })).toBeDisabled();
      });

      it("leaves the group enabled for BOUND text even though the bound value might turn out Cyrillic (unknowable at edit time)", () => {
        renderPane({
          element: { ...textElement, source: "first_name", text: "fallback", customFont: undefined },
        });

        expect(screen.getByRole("button", { name: "Align top" })).toBeEnabled();
      });
    });

    describe("font size / max lines", () => {
      it("patches fontSize on change", () => {
        const { onUpdate } = renderPane({ element: textElement });

        fireEvent.change(screen.getByLabelText("Font size (pt)"), { target: { value: "18" } });

        expect(onUpdate).toHaveBeenCalledWith("e1", { fontSize: 18 });
      });

      it("patches maxLines on change", () => {
        const { onUpdate } = renderPane({ element: textElement });

        fireEvent.change(screen.getByLabelText("Max lines"), { target: { value: "3" } });

        expect(onUpdate).toHaveBeenCalledWith("e1", { maxLines: 3 });
      });
    });
  });

  describe("qrcode element", () => {
    it("shows only the common section + binding select (no font/text/rotation/maxLines/alignment)", () => {
      renderPane({
        element: {
          id: "e1", type: "qrcode", x: 5, y: 5, width: 15, height: 15, source: "code",
        },
      });

      expect(screen.getByLabelText("X (mm)")).toBeInTheDocument();
      expect(screen.getByLabelText("Width (mm)")).toBeInTheDocument();
      expect(screen.getByLabelText("Binding")).toHaveValue("code");

      expect(screen.queryByLabelText("Text")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Font")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Font size (pt)")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Rotation")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Max lines")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Align/ })).not.toBeInTheDocument();
    });

    it("dispatches a binding patch same as text elements", () => {
      const { onUpdate } = renderPane({
        element: {
          id: "e1", type: "qrcode", x: 5, y: 5, width: 15, height: 15, source: "code",
        },
      });

      fireEvent.change(screen.getByLabelText("Binding"), { target: { value: "email" } });

      expect(onUpdate).toHaveBeenCalledWith("e1", { source: "email" });
    });
  });

  describe("barcode element", () => {
    it("shows the common section + binding select + caption toggle", () => {
      renderPane({
        element: {
          id: "e1", type: "barcode", x: 5, y: 5, width: 30, height: 10, source: "code",
        },
      });

      expect(screen.getByLabelText("Binding")).toHaveValue("code");
      expect(screen.queryByLabelText("Font")).not.toBeInTheDocument();
    });

    // 2026-07-20 live-run request: generateBarcodeZPL's ^BC interpretation
    // line (Y/N) is now driven by element.showCaption (generateZpl.ts) --
    // absent/true prints the caption (back-compat with every template saved
    // before this field existed), only an explicit false hides it.
    describe("caption toggle", () => {
      it("is checked when showCaption is absent (back-compat default)", () => {
        renderPane({
          element: { id: "e1", type: "barcode", x: 5, y: 5, width: 30, height: 10, source: "code" },
        });

        expect(screen.getByLabelText("Print human-readable caption")).toBeChecked();
      });

      it("is checked when showCaption is explicitly true", () => {
        renderPane({
          element: {
            id: "e1", type: "barcode", x: 5, y: 5, width: 30, height: 10, source: "code", showCaption: true,
          },
        });

        expect(screen.getByLabelText("Print human-readable caption")).toBeChecked();
      });

      it("is unchecked when showCaption is false", () => {
        renderPane({
          element: {
            id: "e1", type: "barcode", x: 5, y: 5, width: 30, height: 10, source: "code", showCaption: false,
          },
        });

        expect(screen.getByLabelText("Print human-readable caption")).not.toBeChecked();
      });

      it("unchecking dispatches {showCaption: false}", () => {
        const { onUpdate } = renderPane({
          element: { id: "e1", type: "barcode", x: 5, y: 5, width: 30, height: 10, source: "code" },
        });

        fireEvent.click(screen.getByLabelText("Print human-readable caption"));

        expect(onUpdate).toHaveBeenCalledWith("e1", { showCaption: false });
      });

      it("re-checking dispatches {showCaption: true}", () => {
        const { onUpdate } = renderPane({
          element: {
            id: "e1", type: "barcode", x: 5, y: 5, width: 30, height: 10, source: "code", showCaption: false,
          },
        });

        fireEvent.click(screen.getByLabelText("Print human-readable caption"));

        expect(onUpdate).toHaveBeenCalledWith("e1", { showCaption: true });
      });

      it("is absent for qrcode/text/line/box elements", () => {
        renderPane({ element: { id: "e1", type: "qrcode", x: 5, y: 5, source: "code" } });
        expect(screen.queryByLabelText("Print human-readable caption")).not.toBeInTheDocument();
      });
    });
  });

  describe("line/box elements", () => {
    it("shows only the common size/position fields -- no binding section at all", () => {
      renderPane({
        element: {
          id: "e1", type: "box", x: 5, y: 5, width: 20, height: 10,
        },
      });

      expect(screen.getByLabelText("Width (mm)")).toBeInTheDocument();
      expect(screen.queryByLabelText("Binding")).not.toBeInTheDocument();
    });

    it("same for a line element", () => {
      renderPane({
        element: {
          id: "e1", type: "line", x: 5, y: 5, width: 30, height: 0.5,
        },
      });

      expect(screen.getByLabelText("Height (mm)")).toBeInTheDocument();
      expect(screen.queryByLabelText("Binding")).not.toBeInTheDocument();
    });
  });
});
