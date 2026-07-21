import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VerdictScreen } from "./verdict-screen";

describe("VerdictScreen", () => {
  it("allowed: brand field, name, meta, auto-return progress", () => {
    render(
      <VerdictScreen verdict="allowed" title="ОТМЕЧЕНА" name="Александра Константинопольская" cornerNote="14:32 · впервые" meta={[{ label: "Категория", value: "VIP · все зоны" }]} autoReturn={{ label: "Возврат к сканированию · 5 с", progress: 0.58 }} />,
    );
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("data-verdict", "allowed");
    expect(region).toHaveClass("bg-kiosk-brand");
    expect(screen.getByText("Александра Константинопольская")).toBeInTheDocument();
    expect(screen.getByText("VIP · все зоны")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "58");
  });

  it("already_checked_in: amber field, highlight callout, actions work, no auto-return", async () => {
    const pass = vi.fn();
    render(
      <VerdictScreen verdict="already_checked_in" title="УЖЕ ОТМЕЧЕН" name="Пётр Верещагин" highlight="Ранее: сегодня 12:04 · Вход Б · станция 3" actions={[{ label: "Всё равно пропустить", onClick: pass, kind: "solid" }, { label: "Следующий", onClick: () => {}, kind: "outline" }]} />,
    );
    expect(screen.getByRole("status")).toHaveClass("bg-kiosk-warn");
    expect(screen.getByText(/Ранее: сегодня 12:04/)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Всё равно пропустить" }));
    expect(pass).toHaveBeenCalledOnce();
  });

  it("not_registered: neutral dark (не красный), message instead of name", () => {
    render(<VerdictScreen verdict="not_registered" title="КОД НЕ НАЙДЕН" message="Этого кода нет в списке события" meta={[{ label: "Код", value: "EVT-2026-88410-X" }]} />);
    const region = screen.getByRole("status");
    expect(region).toHaveClass("bg-kiosk-neutral");
    expect(screen.getByText("Этого кода нет в списке события")).toBeInTheDocument();
  });

  it("no_access: red field", () => {
    render(<VerdictScreen verdict="no_access" title="ПРОПУСК АННУЛИРОВАН" name="Игорь Малахов" meta={[{ label: "Причина", value: "Возврат билета · 08.07.2026" }]} />);
    expect(screen.getByRole("status")).toHaveClass("bg-kiosk-danger");
  });

  it("privacy: centered self-service variant with message and auto-return", () => {
    render(<VerdictScreen verdict="allowed" title="Добро пожаловать" privacy name="Добро пожаловать, Александра!" message="Ваш бейдж печатается — заберите его в лотке ниже" autoReturn={{ label: "экран сменится автоматически", progress: 0.35 }} />);
    expect(screen.getByRole("status")).toHaveAttribute("data-privacy", "true");
    expect(screen.getByText(/бейдж печатается/)).toBeInTheDocument();
  });
});
