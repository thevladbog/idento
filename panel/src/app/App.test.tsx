import { render, screen } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  it("renders the panel shell placeholder", () => {
    render(<App />);
    expect(screen.getByText("Idento Panel")).toBeInTheDocument();
  });
});
