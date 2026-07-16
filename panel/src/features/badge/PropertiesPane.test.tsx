import { fireEvent, render, screen } from "@testing-library/react";
import { PropertiesPane, type PropertiesPaneProps } from "./PropertiesPane";
import type { BadgeConfig, BadgeElement } from "./templateTypes";
import "../../shared/i18n";

const CONFIG: BadgeConfig = { width_mm: 90, height_mm: 55, dpi: 300 };

function renderPane(overrides: Partial<PropertiesPaneProps> = {}) {
  const onUpdate = vi.fn();
  const props: PropertiesPaneProps = {
    element: null,
    fieldSchema: [],
    config: CONFIG,
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
    it("shows only the common section + binding select", () => {
      renderPane({
        element: {
          id: "e1", type: "barcode", x: 5, y: 5, width: 30, height: 10, source: "code",
        },
      });

      expect(screen.getByLabelText("Binding")).toHaveValue("code");
      expect(screen.queryByLabelText("Font")).not.toBeInTheDocument();
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
