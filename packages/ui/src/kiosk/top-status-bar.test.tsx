import { render, screen } from "@testing-library/react";
import { TopStatusBar } from "./top-status-bar";

const nodes = [
  { id: "server", label: "Сервер", level: "ok" as const },
  { id: "printer", label: "Zebra ZD421", level: "ok" as const },
];

describe("TopStatusBar", () => {
  it("renders event, location, mode pill, chips, counter and clock", () => {
    render(
      <TopStatusBar eventName="Технопром-2026" locationLabel="Главный вход · День 2" modeLabel="Регистрация · автопечать" nodes={nodes} counterLabel="Отмечено" counterValue={412} clock="14:32" />,
    );
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByText("Технопром-2026")).toBeInTheDocument();
    expect(screen.getByText("Регистрация · автопечать")).toBeInTheDocument();
    expect(screen.getByText("Zebra ZD421")).toBeInTheDocument();
    expect(screen.getByText("412")).toBeInTheDocument();
    expect(screen.getByText("14:32")).toBeInTheDocument();
  });
});
