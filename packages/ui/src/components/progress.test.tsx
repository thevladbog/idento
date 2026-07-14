import { render, screen } from "@testing-library/react";
import { Progress } from "./progress";

describe("Progress", () => {
  it("renders a progressbar with the correct aria value attributes", () => {
    render(<Progress value={25} max={50} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "50");
  });

  it("sizes the fill to value/max as a percentage", () => {
    render(<Progress value={25} max={50} />);
    const bar = screen.getByRole("progressbar");
    const fill = bar.firstChild as HTMLElement;
    expect(fill).toHaveStyle({ width: "50%" });
  });

  it("clamps the fill at 100% when value exceeds max", () => {
    render(<Progress value={80} max={50} />);
    const bar = screen.getByRole("progressbar");
    const fill = bar.firstChild as HTMLElement;
    expect(fill).toHaveStyle({ width: "100%" });
  });

  it("renders a 0% fill when max is 0 (avoids dividing by zero)", () => {
    render(<Progress value={0} max={0} />);
    const bar = screen.getByRole("progressbar");
    const fill = bar.firstChild as HTMLElement;
    expect(fill).toHaveStyle({ width: "0%" });
    expect(bar).toHaveAttribute("aria-valuemax", "0");
  });

  it("applies token-only fill/track colors and merges a custom className onto the track", () => {
    const { container } = render(<Progress value={10} max={20} className="w-56" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveClass("bg-muted", "w-56");
    const fill = container.querySelector("[role='progressbar'] > div");
    expect(fill).toHaveClass("bg-success");
  });
});
