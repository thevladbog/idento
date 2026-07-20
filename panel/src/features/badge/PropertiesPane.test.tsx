import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  const onUpdateConfig = vi.fn();
  const props: PropertiesPaneProps = {
    element: null,
    fieldSchema: [],
    config: CONFIG,
    fonts: [],
    fontCoverage: {},
    previewData: {},
    onUpdate,
    onUpdateConfig,
    ...overrides,
  };
  const utils = render(<PropertiesPane {...props} />);
  return { onUpdate, onUpdateConfig, ...utils };
}

// Task 3 (form primitives migration): every control that used to be a
// native <select>/<option>/<optgroup> is now the styled Radix-backed
// Select/SelectTrigger/SelectContent/SelectItem/SelectGroup/SelectLabel set
// -- SelectValue's rendered text (via getByRole("combobox")) stands in for
// the old `.value`/`toHaveValue()` reads (a Radix trigger is a <button>,
// not a form control with a `.value`), and the listbox only exists in the
// DOM once opened (Radix portals SelectContent), so listing/selecting an
// option now goes through userEvent.click(combobox) ->
// findByRole("option", {name}) rather than fireEvent.change.
describe("PropertiesPane", () => {
  describe("empty state (document settings)", () => {
    it("shows the document-settings section with the config's current values, plus the element-selection hint", () => {
      renderPane({ element: null });

      expect(screen.getByText("Document settings")).toBeInTheDocument();
      expect(screen.getByLabelText("Width (mm)")).toHaveValue(90);
      expect(screen.getByLabelText("Height (mm)")).toHaveValue(55);
      expect(screen.getByRole("combobox", { name: "DPI" })).toHaveTextContent("300");
      expect(
        screen.getByText("Select an element to edit its properties, or set the label's overall size below."),
      ).toBeInTheDocument();
    });

    it("lists 203/300/600 as the DPI options", async () => {
      const user = userEvent.setup();
      renderPane({ element: null });

      await user.click(screen.getByRole("combobox", { name: "DPI" }));
      const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
      expect(options).toEqual(["203", "300", "600"]);
    });

    it("patches width_mm on change", () => {
      const { onUpdateConfig } = renderPane({ element: null });

      fireEvent.change(screen.getByLabelText("Width (mm)"), { target: { value: "100" } });

      expect(onUpdateConfig).toHaveBeenCalledWith({ width_mm: 100 });
    });

    it("patches height_mm on change", () => {
      const { onUpdateConfig } = renderPane({ element: null });

      fireEvent.change(screen.getByLabelText("Height (mm)"), { target: { value: "60" } });

      expect(onUpdateConfig).toHaveBeenCalledWith({ height_mm: 60 });
    });

    it("patches dpi as a number on change", async () => {
      const user = userEvent.setup();
      const { onUpdateConfig } = renderPane({ element: null });

      await user.click(screen.getByRole("combobox", { name: "DPI" }));
      await user.click(await screen.findByRole("option", { name: "203" }));

      expect(onUpdateConfig).toHaveBeenCalledWith({ dpi: 203 });
    });

    it("clamps a width_mm value below the sane minimum before dispatching", () => {
      const { onUpdateConfig } = renderPane({ element: null });

      fireEvent.change(screen.getByLabelText("Width (mm)"), { target: { value: "1" } });

      expect(onUpdateConfig).toHaveBeenCalledWith({ width_mm: 10 });
    });

    it("clamps a height_mm value above the sane maximum before dispatching", () => {
      const { onUpdateConfig } = renderPane({ element: null });

      fireEvent.change(screen.getByLabelText("Height (mm)"), { target: { value: "999" } });

      expect(onUpdateConfig).toHaveBeenCalledWith({ height_mm: 200 });
    });

    it("ignores a non-numeric width input (cleared field) without dispatching", () => {
      const { onUpdateConfig } = renderPane({ element: null });

      fireEvent.change(screen.getByLabelText("Width (mm)"), { target: { value: "" } });

      expect(onUpdateConfig).not.toHaveBeenCalled();
    });

    // Task 6 (form primitives): Width/Height (mm) are now the @idento/ui
    // NumberInput WITH min/max passed straight through -- unlike the
    // element x/y/width/height fields above, the + stepper's OWN internal
    // clamp() (not just handleConfigMmChange's) must stop at DOC_MM_MAX
    // when already there.
    it("clicking Width's + stepper at the sane maximum stays clamped via NumberInput's own min/max", async () => {
      const user = userEvent.setup();
      const { onUpdateConfig } = renderPane({ element: null, config: { width_mm: 200, height_mm: 55, dpi: 300 } });

      const widthInput = screen.getByLabelText("Width (mm)");
      await user.click(
        within(widthInput.parentElement as HTMLElement).getByRole("button", { name: "Increase Width (mm)" }),
      );

      expect(widthInput).toHaveValue(200);
      expect(onUpdateConfig).toHaveBeenCalledWith({ width_mm: 200 });
    });

    // Review fix: a template saved before this picker existed (or edited
    // via a raw API call, same as the incident that prompted this feature)
    // can carry a dpi outside the three listed options. A controlled
    // <select> whose value matches no <option> falls back to silently
    // DISPLAYING the first option instead -- same "honest disabled
    // placeholder" fix as the font select's own missingFontFamily case.
    it("shows a disabled placeholder option (not a silent fallback to 203) for a dpi outside 203/300/600", async () => {
      const user = userEvent.setup();
      renderPane({ element: null, config: { width_mm: 90, height_mm: 55, dpi: 250 } });

      const combobox = screen.getByRole("combobox", { name: "DPI" });
      // The trigger displays the SELECTED item's label, even though it's
      // disabled -- same as a native <select> showing a disabled <option>'s
      // text when its value matches the controlled value.
      expect(combobox).toHaveTextContent("250 (custom)");

      await user.click(combobox);
      const options = await screen.findAllByRole("option");
      expect(options.map((o) => o.textContent)).toEqual(["203", "300", "600", "250 (custom)"]);
      const placeholder = options.find((o) => o.textContent === "250 (custom)")!;
      expect(placeholder).toHaveAttribute("aria-disabled", "true");
    });

    it("renders no placeholder option for a listed dpi", async () => {
      const user = userEvent.setup();
      renderPane({ element: null, config: { width_mm: 90, height_mm: 55, dpi: 300 } });

      await user.click(screen.getByRole("combobox", { name: "DPI" }));
      const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
      expect(options).toEqual(["203", "300", "600"]);
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

    // Task 6 (form primitives): X/Y/Width/Height are now the @idento/ui
    // NumberInput -- its own + stepper must dispatch through the SAME
    // handleNumberChange onUpdate path a typed change already exercises
    // above (no min/max passed to these fields, so NumberInput's own
    // internal clamp() no-ops; footprint clamping stays handleNumberChange's
    // job either way). NumberField's own default step (0.5, unchanged by
    // this migration -- none of these call sites pass an explicit `step`)
    // means one click moves x by 0.5, not 1.
    it("clicking X's + stepper increments by the field's 0.5 step and dispatches through handleNumberChange", async () => {
      const user = userEvent.setup();
      const { onUpdate } = renderPane({
        element: { id: "e1", type: "box", x: 5, y: 5, width: 20, height: 10 },
      });

      const xInput = screen.getByLabelText("X (mm)");
      await user.click(within(xInput.parentElement as HTMLElement).getByRole("button", { name: "Increase X (mm)" }));

      expect(onUpdate).toHaveBeenCalledWith("e1", { x: 5.5 });
    });

    it("clicking X's + stepper past the artboard edge clamps via the same footprint guard as typed input", async () => {
      // Already at the max-fitting x (90mm board, 20mm-wide element -> 70) --
      // stepping past it (70.5) must clamp straight back to 70.
      const user = userEvent.setup();
      const { onUpdate } = renderPane({
        element: { id: "e1", type: "box", x: 70, y: 5, width: 20, height: 10 },
      });

      const xInput = screen.getByLabelText("X (mm)");
      await user.click(within(xInput.parentElement as HTMLElement).getByRole("button", { name: "Increase X (mm)" }));

      expect(onUpdate).toHaveBeenCalledWith("e1", { x: 70 });
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

      expect(screen.getByRole("combobox", { name: "Binding" })).toHaveTextContent("{first_name}");
      expect(screen.getByLabelText("Text")).toHaveValue("Hello");
      expect(screen.getByRole("combobox", { name: "Font" })).toHaveTextContent("A · 12 pt");
      expect(screen.getByLabelText("Font size (pt)")).toHaveValue(14);
      expect(screen.getByRole("combobox", { name: "Rotation" })).toHaveTextContent("90°");
      expect(screen.getByLabelText("Max lines")).toHaveValue(2);

      expect(screen.getByRole("button", { name: "Align center" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Align left" })).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("button", { name: "Align right" })).toHaveAttribute("aria-pressed", "false");
    });

    it("disables the static-text input while a binding is active", () => {
      renderPane({ element: textElement });

      expect(screen.getByLabelText("Text")).toBeDisabled();
    });

    it("lists 'Static text' plus the standard + custom bindings, shown as {name}", async () => {
      const user = userEvent.setup();
      renderPane({ element: textElement, fieldSchema: ["dietary"] });

      await user.click(screen.getByRole("combobox", { name: "Binding" }));
      const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
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
      it("switching to a real binding option patches {source} with that name", async () => {
        const user = userEvent.setup();
        const { onUpdate } = renderPane({ element: textElement });

        await user.click(screen.getByRole("combobox", { name: "Binding" }));
        await user.click(await screen.findByRole("option", { name: "{last_name}" }));

        expect(onUpdate).toHaveBeenCalledWith("e1", { source: "last_name" });
      });

      it("switching to 'Static text' clears source (and the text input becomes enabled on the next render)", async () => {
        const user = userEvent.setup();
        const { onUpdate, rerender } = renderPane({ element: textElement });

        await user.click(screen.getByRole("combobox", { name: "Binding" }));
        await user.click(await screen.findByRole("option", { name: "Static text" }));

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
            previewData={{}}
            onUpdate={onUpdate}
            onUpdateConfig={vi.fn()}
          />,
        );
        expect(screen.getByLabelText("Text")).not.toBeDisabled();
      });
    });

    // Bot review (PR #92, finding #1): the binding select used to map
    // "Static text" to a bare sentinel string, and a custom field literally
    // named that raw sentinel value shared its SelectItem's value --
    // selecting the field silently mapped to `undefined` (the static-text
    // branch) instead of binding to the field. The fix encodes real field
    // names with a prefix the static sentinel can never start with, so the
    // two are disjoint no matter what fieldSchema contains -- these cases
    // reproduce the collision fieldSchema=["__static"] used to trigger.
    describe("field named the raw static-text sentinel", () => {
      it("still lists Static text as its own option alongside the {__static} field", async () => {
        const user = userEvent.setup();
        renderPane({ element: textElement, fieldSchema: ["__static"] });

        await user.click(screen.getByRole("combobox", { name: "Binding" }));
        const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
        expect(options).toEqual([
          "Static text",
          "{first_name}",
          "{last_name}",
          "{email}",
          "{company}",
          "{position}",
          "{code}",
          "{__static}",
        ]);
      });

      it("selecting the {__static} field patches source with the field's own name, not undefined", async () => {
        const user = userEvent.setup();
        const { onUpdate } = renderPane({ element: textElement, fieldSchema: ["__static"] });

        await user.click(screen.getByRole("combobox", { name: "Binding" }));
        await user.click(await screen.findByRole("option", { name: "{__static}" }));

        expect(onUpdate).toHaveBeenCalledWith("e1", { source: "__static" });
      });

      it("shows the {__static} field as selected (not Static text) when the element is already bound to it", () => {
        renderPane({ element: { ...textElement, source: "__static" }, fieldSchema: ["__static"] });

        expect(screen.getByRole("combobox", { name: "Binding" })).toHaveTextContent("{__static}");
      });
    });

    describe("font select", () => {
      it("patches fontFamily with the CODE, not the visible label", async () => {
        const user = userEvent.setup();
        const { onUpdate } = renderPane({ element: textElement });

        await user.click(screen.getByRole("combobox", { name: "Font" }));
        await user.click(await screen.findByRole("option", { name: "Scalable (0)" }));

        expect(onUpdate).toHaveBeenCalledWith("e1", { fontFamily: "0" });
      });

      it("renders the documented font labels", async () => {
        const user = userEvent.setup();
        renderPane({ element: textElement });

        await user.click(screen.getByRole("combobox", { name: "Font" }));
        const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
        expect(options).toEqual([
          "Scalable (0)",
          "A · 12 pt",
          "B · 14 pt",
          "C · 18 pt",
          "D · 24 pt",
          "E · 28 pt",
        ]);
      });

      // P3.2 Task 4: event fonts in an "Event fonts" optgroup (now a
      // SelectGroup + SelectLabel), coverage flags carried in the item TEXT
      // (a SelectItem's children are plain text here, not a component) --
      // ✓/no-Cyr per font, and no flag at all while coverage is still
      // undefined (never a guessed flag).
      describe("event fonts", () => {
        const FONTS = [
          { id: "font-cyr", family: "CyrFont" },
          { id: "font-latin", family: "LatinFont" },
          { id: "font-loading", family: "LoadingFont" },
        ].map((f) => fontListItem(f.id, f.family));

        it("lists the built-in group plus an Event fonts group with coverage-flagged labels", async () => {
          const user = userEvent.setup();
          renderPane({
            element: textElement,
            fonts: FONTS,
            fontCoverage: { "font-cyr": true, "font-latin": false },
          });

          await user.click(screen.getByRole("combobox", { name: "Font" }));
          const listbox = await screen.findByRole("listbox");

          const builtinGroup = within(listbox).getByRole("group", { name: "Built-in ZPL — Latin only" });
          expect(within(builtinGroup).getAllByRole("option").map((o) => o.textContent)).toEqual([
            "Scalable (0)",
            "A · 12 pt",
            "B · 14 pt",
            "C · 18 pt",
            "D · 24 pt",
            "E · 28 pt",
          ]);

          const eventGroup = within(listbox).getByRole("group", { name: "Event fonts" });
          expect(within(eventGroup).getAllByRole("option").map((o) => o.textContent)).toEqual([
            "CyrFont (✓ Cyr)",
            "LatinFont (no Cyr)",
            "LoadingFont", // coverage undefined (still loading/unparseable) -- no flag text at all
          ]);
        });

        it("selecting an event font patches {customFont: family}, leaving fontFamily untouched", async () => {
          const user = userEvent.setup();
          const { onUpdate } = renderPane({ element: textElement, fonts: FONTS, fontCoverage: {} });

          await user.click(screen.getByRole("combobox", { name: "Font" }));
          await user.click(await screen.findByRole("option", { name: "CyrFont" }));

          expect(onUpdate).toHaveBeenCalledWith("e1", { customFont: "CyrFont" });
        });

        it("selecting a native code clears customFont and sets fontFamily to that code", async () => {
          const user = userEvent.setup();
          const { onUpdate } = renderPane({
            element: { ...textElement, customFont: "CyrFont" },
            fonts: FONTS,
            fontCoverage: {},
          });

          await user.click(screen.getByRole("combobox", { name: "Font" }));
          await user.click(await screen.findByRole("option", { name: "A · 12 pt" }));

          expect(onUpdate).toHaveBeenCalledWith("e1", { customFont: undefined, fontFamily: "A" });
        });

        it("selects the event-font option (over fontFamily) when customFont is set", () => {
          renderPane({
            element: { ...textElement, fontFamily: "A", customFont: "LatinFont" },
            fonts: FONTS,
            fontCoverage: {},
          });

          // fontCoverage is {} here (coverage undefined for this font) -- no
          // flag text, same honesty rule as fontOptionLabel's own comment.
          expect(screen.getByRole("combobox", { name: "Font" })).toHaveTextContent("LatinFont");
        });

        // Trim-aware precedence, matching generation exactly: generateZpl.ts
        // only honors customFont when `customFont && customFont.trim()` is
        // truthy (its raster gate at :152 and native-font command at :199),
        // and web's own editor legitimately persists `customFont: ""`
        // (BadgeTemplateEditorV2.tsx:801-804 writes its free-text field
        // verbatim). A bare `??` here treated "" as SET, silently showing
        // "Scalable (0)" while the printer used fontFamily "B" -- the select
        // must show what actually prints.
        it("shows the fontFamily code (not the first option) when customFont is an empty string", () => {
          renderPane({
            element: { ...textElement, fontFamily: "B", customFont: "" },
            fonts: FONTS,
            fontCoverage: {},
          });

          expect(screen.getByRole("combobox", { name: "Font" })).toHaveTextContent("B · 14 pt");
        });

        it("treats a whitespace-only customFont as unset too (no missing-font option, fontFamily wins)", async () => {
          const user = userEvent.setup();
          renderPane({
            element: { ...textElement, fontFamily: "C", customFont: "   " },
            fonts: FONTS,
            fontCoverage: {},
          });

          const combobox = screen.getByRole("combobox", { name: "Font" });
          expect(combobox).toHaveTextContent("C · 18 pt");

          await user.click(combobox);
          // No phantom "missing font" placeholder for a blank value.
          const options = await screen.findAllByRole("option");
          expect(options.some((o) => o.textContent?.includes("font removed"))).toBe(false);
        });

        it("renders a disabled 'missing font' option when customFont names a font no longer in the list", async () => {
          const user = userEvent.setup();
          renderPane({
            element: { ...textElement, customFont: "DeletedFont" },
            fonts: FONTS,
            fontCoverage: {},
          });

          const combobox = screen.getByRole("combobox", { name: "Font" });
          expect(combobox).toHaveTextContent("DeletedFont (font removed)");

          await user.click(combobox);
          const missingOption = await screen.findByRole("option", { name: "DeletedFont (font removed)" });
          expect(missingOption).toHaveAttribute("aria-disabled", "true");
        });

        // The backend's uniqueness constraint is family+weight+style, so one
        // family can appear several times in `fonts` (e.g. Roboto normal +
        // Roboto bold). customFont stores only the FAMILY, so two options
        // with the same value would be duplicate SelectItem values -- the
        // group dedupes by family, first occurrence wins.
        it("dedupes same-family weight/style variants into ONE option (first occurrence's coverage flag)", async () => {
          const user = userEvent.setup();
          renderPane({
            element: textElement,
            fonts: [
              fontListItem("font-reg", "Roboto"),
              { ...fontListItem("font-bold", "Roboto"), weight: "bold" },
            ],
            fontCoverage: { "font-reg": true, "font-bold": false },
          });

          await user.click(screen.getByRole("combobox", { name: "Font" }));
          const listbox = await screen.findByRole("listbox");
          const eventGroup = within(listbox).getByRole("group", { name: "Event fonts" });
          const options = within(eventGroup).getAllByRole("option").map((o) => o.textContent);
          expect(options).toEqual(["Roboto (✓ Cyr)"]);
        });

        it("renders no Event fonts group at all when the event has no uploaded fonts", async () => {
          const user = userEvent.setup();
          renderPane({ element: textElement, fonts: [], fontCoverage: {} });

          await user.click(screen.getByRole("combobox", { name: "Font" }));
          const listbox = await screen.findByRole("listbox");
          expect(within(listbox).getAllByRole("group")).toHaveLength(1);
          expect(within(listbox).queryByRole("group", { name: "Event fonts" })).not.toBeInTheDocument();
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
      it("patches rotation as a number", async () => {
        const user = userEvent.setup();
        const { onUpdate } = renderPane({ element: textElement });

        await user.click(screen.getByRole("combobox", { name: "Rotation" }));
        await user.click(await screen.findByRole("option", { name: "180°" }));

        expect(onUpdate).toHaveBeenCalledWith("e1", { rotation: 180 });
      });
    });

    // 2026-07-20 live-run request: generateZpl.ts's native text path already
    // honored element.valign+height (generateTextZPL, ~line 177) but this
    // control was never exposed. The raster branch used to DROP valign
    // entirely; PR #88 (2026-07-20, landed after this control shipped)
    // lifted that limitation too -- rasterFieldOrigin now applies the same
    // valign slack to raster-rendered text, gated the same way (needs
    // `height`). So the control is enabled UNCONDITIONALLY regardless of
    // whether the element is known to route through the raster path -- the
    // only thing that still matters is `height` being explicit, which
    // handleValignChange's own auto-persist (see its test above) already
    // guarantees on first click.
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
      });

      // PR #88 lifted the raster branch's valign limitation (rasterFieldOrigin
      // now applies the same slack to raster-rendered text, gated on `height`
      // exactly like the native branch) -- these elements used to get a
      // disabled control + hint here; now the control works identically
      // regardless of which path the element ends up routing through.
      it("stays enabled when customFont is set (raster path now honors valign too, via rasterFieldOrigin)", () => {
        renderPane({ element: { ...textElement, customFont: "Roboto" } });

        expect(screen.getByRole("button", { name: "Align top" })).toBeEnabled();
      });

      it("stays enabled for unbound Cyrillic static text (also raster-routed, also now honored)", () => {
        renderPane({
          element: { ...textElement, source: undefined, text: "Привет", customFont: undefined },
        });

        expect(screen.getByRole("button", { name: "Align top" })).toBeEnabled();
      });

      it("stays enabled for bound text regardless of what the per-attendee value turns out to be", () => {
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
      expect(screen.getByRole("combobox", { name: "Binding" })).toHaveTextContent("{code}");

      expect(screen.queryByLabelText("Text")).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Font" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Font size (pt)")).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Rotation" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Max lines")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Align/ })).not.toBeInTheDocument();
    });

    it("dispatches a binding patch same as text elements", async () => {
      const user = userEvent.setup();
      const { onUpdate } = renderPane({
        element: {
          id: "e1", type: "qrcode", x: 5, y: 5, width: 15, height: 15, source: "code",
        },
      });

      await user.click(screen.getByRole("combobox", { name: "Binding" }));
      await user.click(await screen.findByRole("option", { name: "{email}" }));

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

      expect(screen.getByRole("combobox", { name: "Binding" })).toHaveTextContent("{code}");
      expect(screen.queryByRole("combobox", { name: "Font" })).not.toBeInTheDocument();
    });

    // 2026-07-20 barcode-alignment request: the SAME alignment control text
    // elements already have (ALIGN_OPTIONS, renderAlignmentControl in
    // PropertiesPane.tsx) now also renders for barcode elements -- reusing
    // generateZpl.ts's `align` field and this pane's existing i18n keys, no
    // new ones.
    describe("alignment buttons", () => {
      it("shows the alignment buttons for a barcode element", () => {
        renderPane({
          element: {
            id: "e1", type: "barcode", x: 5, y: 5, width: 30, height: 10, source: "code",
          },
        });

        expect(screen.getByRole("button", { name: "Align left" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Align center" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Align right" })).toBeInTheDocument();
      });

      it("clicking a segment patches align and only that segment is aria-pressed", () => {
        const { onUpdate } = renderPane({
          element: {
            id: "e1", type: "barcode", x: 5, y: 5, width: 30, height: 10, source: "code",
          },
        });

        fireEvent.click(screen.getByRole("button", { name: "Align center" }));

        expect(onUpdate).toHaveBeenCalledWith("e1", { align: "center" });
      });

      it("defaults to Align left pressed when the element has no explicit align", () => {
        renderPane({
          element: {
            id: "e1", type: "barcode", x: 5, y: 5, width: 30, height: 10, source: "code",
          },
        });

        expect(screen.getByRole("button", { name: "Align left" })).toHaveAttribute("aria-pressed", "true");
      });

      it("shows the element's current align as pressed", () => {
        renderPane({
          element: {
            id: "e1", type: "barcode", x: 5, y: 5, width: 30, height: 10, source: "code", align: "right",
          },
        });

        expect(screen.getByRole("button", { name: "Align right" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "Align left" })).toHaveAttribute("aria-pressed", "false");
      });
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

    // Task 3 (fit-to-width): the advisory guiding an operator away from a
    // barcode whose resolved preview code can't fit readably at this zone
    // width -- non-blocking, guides to the QR element instead.
    describe("overflow advisory", () => {
      it("shows the overflow advisory for a barcode whose preview code can't fit readably", () => {
        renderPane({
          element: {
            id: "b", type: "barcode", source: "code", x: 0.5, y: 37, width: 40, height: 17.5, align: "center",
          },
          config: { width_mm: 100, height_mm: 60, dpi: 203 },
          previewData: { code: "550e8400-e29b-41d4-a716-446655440000" }, // a UUID
        });

        expect(screen.getByText(/QR/i)).toBeInTheDocument();
      });

      it("hides the advisory when the barcode fits", () => {
        renderPane({
          element: {
            id: "b", type: "barcode", source: "code", x: 0.5, y: 37, width: 99.5, height: 17.5, align: "center",
          },
          config: { width_mm: 100, height_mm: 60, dpi: 203 },
          previewData: { code: "QA-EN-0001" },
        });

        expect(screen.queryByText(/QR/i)).not.toBeInTheDocument();
      });

      it("never shows the advisory for a non-barcode element", () => {
        renderPane({
          element: { id: "t", type: "text", source: "first_name", x: 0, y: 0, width: 99, height: 14 },
          config: { width_mm: 100, height_mm: 60, dpi: 203 },
          previewData: { first_name: "550e8400-e29b-41d4-a716-446655440000" },
        });

        expect(screen.queryByText(/QR/i)).not.toBeInTheDocument();
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
      expect(screen.queryByRole("combobox", { name: "Binding" })).not.toBeInTheDocument();
    });

    it("same for a line element", () => {
      renderPane({
        element: {
          id: "e1", type: "line", x: 5, y: 5, width: 30, height: 0.5,
        },
      });

      expect(screen.getByLabelText("Height (mm)")).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Binding" })).not.toBeInTheDocument();
    });
  });
});
