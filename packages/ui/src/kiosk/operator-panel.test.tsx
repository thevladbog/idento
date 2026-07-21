import { render, screen } from "@testing-library/react";
import { OperatorPanel } from "./operator-panel";

describe("OperatorPanel", () => {
  it("renders event, statuses with details, counter and log (1c)", () => {
    render(
      <OperatorPanel
        eventName="Технопром-2026"
        locationLabel="Главный вход · День 2"
        modeLabel="Регистрация · автопечать"
        nodes={[
          { id: "server", label: "Сервер", level: "ok", detail: "12 мс" },
          { id: "printer", label: "Принтер", level: "warn", detail: "нет ленты" },
        ]}
        counterValue={412}
        counterLabel="отмечено сегодня"
        log={[{ time: "14:32", name: "Мария Свиридова", outcome: "allowed" }]}
      />,
    );
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(screen.getByText("12 мс")).toBeInTheDocument();
    expect(screen.getByText(/нет ленты/)).toBeInTheDocument(); // warn row grows into amber card
    expect(screen.getByText("412")).toBeInTheDocument();
    expect(screen.getByText("Мария Свиридова")).toBeInTheDocument();
  });
});
