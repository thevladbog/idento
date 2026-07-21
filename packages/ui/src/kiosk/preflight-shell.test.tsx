import { render, screen } from "@testing-library/react";
import { PreflightShell } from "./preflight-shell";

const steps = [
  { label: "Подключение" },
  { label: "Вход" },
  { label: "Оборудование" },
  { label: "Событие" },
  { label: "Режим" },
];

describe("PreflightShell", () => {
  it("renders the rail with done/active/pending states and the step card", () => {
    render(
      <PreflightShell steps={steps} activeIndex={2}>
        <div>Тело шага</div>
      </PreflightShell>,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveAttribute("data-state", "done");
    expect(items[2]).toHaveAttribute("data-state", "active");
    expect(items[4]).toHaveAttribute("data-state", "pending");
    expect(items[2]).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Тело шага")).toBeInTheDocument();
  });
});
