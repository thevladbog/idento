import { act, fireEvent, render, screen } from "@testing-library/react";
import { DesktopOnlyGate } from "./desktop-only-gate";

describe("DesktopOnlyGate", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(navigator, { clipboard: { writeText } });
    writeText.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderGate() {
    render(
      <DesktopOnlyGate
        flavor="agent-bound"
        title="Equipment"
        reason="Printers and scanners talk to the Idento agent on your desk computer."
        href="https://panel.test/equipment"
        copyLabel="Copy link for desktop"
        copiedLabel="Link copied"
        back={<a href="/">Back to Home</a>}
      />,
    );
  }

  it("renders title, reason and the back slot", () => {
    renderGate();
    expect(screen.getByRole("heading", { name: "Equipment" })).toBeInTheDocument();
    expect(screen.getByText(/Idento agent on your desk computer/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Home" })).toBeInTheDocument();
  });

  it("copies the deep link and swaps to the copied label for 2 s", () => {
    renderGate();
    fireEvent.click(screen.getByRole("button", { name: "Copy link for desktop" }));
    expect(writeText).toHaveBeenCalledWith("https://panel.test/equipment");
    expect(screen.getByRole("button", { name: /Link copied/ })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("button", { name: "Copy link for desktop" })).toBeInTheDocument();
  });
});
