import { render, screen } from "@testing-library/react";
import { RecentLog } from "./recent-log";

const entries = [
  { time: "14:32", name: "Александра Константинопольская", outcome: "allowed" as const },
  { time: "14:31", name: "Пётр Верещагин", outcome: "already_checked_in" as const },
];

describe("RecentLog", () => {
  it("bar layout: title, rows with time+name+outcome icon, trailing note", () => {
    render(<RecentLog title="ПОСЛЕДНИЕ" entries={entries} trailing="2 бейджа ждут печати" />);
    expect(screen.getByText("ПОСЛЕДНИЕ")).toBeInTheDocument();
    expect(screen.getByText("Пётр Верещагин")).toBeInTheDocument();
    expect(screen.getByText("2 бейджа ждут печати")).toBeInTheDocument();
    expect(screen.getByText("14:32").parentElement!.querySelector("svg")).toBeTruthy();
  });
  it("panel layout: column without title", () => {
    render(<RecentLog entries={entries} layout="panel" />);
    expect(screen.queryByText("ПОСЛЕДНИЕ")).not.toBeInTheDocument();
    expect(screen.getByText("Пётр Верещагин")).toBeInTheDocument();
  });
});
