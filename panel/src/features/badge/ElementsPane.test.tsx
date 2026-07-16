import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ElementsPane, type ElementsPaneProps } from "./ElementsPane";
import type { BadgeTemplateDoc } from "./templateTypes";
import "../../shared/i18n";

function docWith(elements: BadgeTemplateDoc["elements"]): BadgeTemplateDoc {
  return { width_mm: 90, height_mm: 55, dpi: 300, elements };
}

function renderPane(overrides: Partial<ElementsPaneProps> = {}) {
  const onSelect = vi.fn();
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  const props = {
    doc: docWith([]),
    selectedId: null,
    onSelect,
    onAdd,
    onRemove,
    fieldSchema: [] as string[],
    ...overrides,
  };
  render(<ElementsPane {...props} />);
  return { onSelect, onAdd, onRemove };
}

describe("ElementsPane", () => {
  it("renders one row per element", () => {
    renderPane({
      doc: docWith([
        { id: "e1", type: "text", x: 5, y: 5, text: "Hi", source: "first_name" },
        { id: "e2", type: "box", x: 5, y: 5, width: 10, height: 10 },
      ]),
    });

    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  describe("row display content", () => {
    it("shows a mono {source} chip for a bound element", () => {
      renderPane({
        doc: docWith([{ id: "e1", type: "text", x: 5, y: 5, text: "", source: "first_name" }]),
      });

      expect(screen.getByText("{first_name}")).toBeInTheDocument();
    });

    it("shows the truncated static text for a text element with no source", () => {
      renderPane({
        doc: docWith([{ id: "e1", type: "text", x: 5, y: 5, text: "Welcome!" }]),
      });

      expect(screen.getByText("Welcome!")).toBeInTheDocument();
    });

    it("shows the element's type label for other (unbound, non-text) elements", () => {
      renderPane({
        doc: docWith([
          { id: "e1", type: "line", x: 5, y: 5, width: 30, height: 0.5 },
          { id: "e2", type: "box", x: 5, y: 5, width: 20, height: 10 },
        ]),
      });

      expect(screen.getByText("Line")).toBeInTheDocument();
      expect(screen.getByText("Box")).toBeInTheDocument();
    });

    it("prefers the bound chip over static text when an element has both text and source", () => {
      renderPane({
        doc: docWith([{ id: "e1", type: "text", x: 5, y: 5, text: "fallback", source: "code" }]),
      });

      expect(screen.getByText("{code}")).toBeInTheDocument();
      expect(screen.queryByText("fallback")).not.toBeInTheDocument();
    });

    it("doesn't flag a chip bound to a standard or current custom field as unknown", () => {
      renderPane({
        doc: docWith([{ id: "e1", type: "text", x: 5, y: 5, text: "", source: "dietary" }]),
        fieldSchema: ["dietary"],
      });

      expect(screen.getByText("{dietary}")).not.toHaveAttribute("title");
    });

    it("flags a chip bound to a source outside the event's standard + custom fields", () => {
      renderPane({
        doc: docWith([{ id: "e1", type: "text", x: 5, y: 5, text: "", source: "old_removed_field" }]),
        fieldSchema: ["dietary"],
      });

      expect(screen.getByText("{old_removed_field}")).toHaveAttribute("title");
    });
  });

  it("clicking a row calls onSelect with that element's id", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPane({
      doc: docWith([
        { id: "e1", type: "text", x: 5, y: 5, text: "Hi" },
        { id: "e2", type: "box", x: 5, y: 5, width: 10, height: 10 },
      ]),
    });

    await user.click(screen.getByText("Hi"));
    expect(onSelect).toHaveBeenCalledWith("e1");

    await user.click(screen.getByText("Box"));
    expect(onSelect).toHaveBeenCalledWith("e2");
  });

  it("the selected row's highlight follows selectedId (aria-current, not color alone)", () => {
    renderPane({
      doc: docWith([
        { id: "e1", type: "text", x: 5, y: 5, text: "Hi" },
        { id: "e2", type: "box", x: 5, y: 5, width: 10, height: 10 },
      ]),
      selectedId: "e2",
    });

    const rowHi = screen.getByText("Hi").closest("button");
    const rowBox = screen.getByText("Box").closest("button");
    expect(rowHi).not.toHaveAttribute("aria-current");
    expect(rowBox).toHaveAttribute("aria-current", "true");
  });

  it("clicking a row's remove button calls onRemove with that element's id (not onSelect)", async () => {
    const user = userEvent.setup();
    const { onRemove, onSelect } = renderPane({
      doc: docWith([{ id: "e1", type: "text", x: 5, y: 5, text: "Hi" }]),
    });

    await user.click(screen.getByRole("button", { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledWith("e1");
    expect(onSelect).not.toHaveBeenCalled();
  });

  describe("+ Add menu", () => {
    it("lists Text / QR code / Barcode / Line / Box", async () => {
      const user = userEvent.setup();
      renderPane();

      await user.click(screen.getByRole("button", { name: "+ Add" }));

      expect(screen.getByRole("menuitem", { name: "Text" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "QR code" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Barcode" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Line" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Box" })).toBeInTheDocument();
    });

    it("creates a text element with the exact default fields", async () => {
      const user = userEvent.setup();
      const { onAdd } = renderPane();

      await user.click(screen.getByRole("button", { name: "+ Add" }));
      await user.click(screen.getByRole("menuitem", { name: "Text" }));

      expect(onAdd).toHaveBeenCalledTimes(1);
      const { id, ...rest } = onAdd.mock.calls[0][0];
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
      expect(rest).toEqual({
        type: "text", x: 5, y: 5, fontSize: 12, fontFamily: "0", text: "", source: "first_name",
      });
    });

    it("creates a qrcode element with the exact default fields", async () => {
      const user = userEvent.setup();
      const { onAdd } = renderPane();

      await user.click(screen.getByRole("button", { name: "+ Add" }));
      await user.click(screen.getByRole("menuitem", { name: "QR code" }));

      const { id: _id, ...rest } = onAdd.mock.calls[0][0];
      expect(rest).toEqual({
        type: "qrcode", x: 5, y: 5, width: 15, height: 15, source: "code",
      });
    });

    it("creates a barcode element with the exact default fields", async () => {
      const user = userEvent.setup();
      const { onAdd } = renderPane();

      await user.click(screen.getByRole("button", { name: "+ Add" }));
      await user.click(screen.getByRole("menuitem", { name: "Barcode" }));

      const { id: _id, ...rest } = onAdd.mock.calls[0][0];
      expect(rest).toEqual({
        type: "barcode", x: 5, y: 5, width: 30, height: 10, source: "code",
      });
    });

    it("creates a line element with the exact default fields", async () => {
      const user = userEvent.setup();
      const { onAdd } = renderPane();

      await user.click(screen.getByRole("button", { name: "+ Add" }));
      await user.click(screen.getByRole("menuitem", { name: "Line" }));

      const { id: _id, ...rest } = onAdd.mock.calls[0][0];
      expect(rest).toEqual({ type: "line", x: 5, y: 5, width: 30, height: 0.5 });
    });

    it("creates a box element with the exact default fields", async () => {
      const user = userEvent.setup();
      const { onAdd } = renderPane();

      await user.click(screen.getByRole("button", { name: "+ Add" }));
      await user.click(screen.getByRole("menuitem", { name: "Box" }));

      const { id: _id, ...rest } = onAdd.mock.calls[0][0];
      expect(rest).toEqual({ type: "box", x: 5, y: 5, width: 20, height: 10 });
    });
  });

  describe("empty doc", () => {
    it("shows its own empty hint (not the canvas's) and keeps the + Add menu available", async () => {
      const user = userEvent.setup();
      const { onAdd } = renderPane({ doc: docWith([]) });

      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      expect(screen.getByText(/no elements/i)).toBeInTheDocument();

      const addButton = screen.getByRole("button", { name: "+ Add" });
      await user.click(addButton);
      await user.click(screen.getByRole("menuitem", { name: "Text" }));
      expect(onAdd).toHaveBeenCalledTimes(1);
    });
  });
});
