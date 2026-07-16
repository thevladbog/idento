import { render, screen, waitFor } from "@testing-library/react";
import { QrSvg } from "./QrSvg";

// No mock of the `qrcode` package anywhere in this file — the whole point of
// local rendering is that it's real, pure-JS generation, so the test exists
// to prove that actually works (svg output, not a stub).
describe("QrSvg", () => {
  it("renders a real QR code <svg> for the given token, with the accessible label on the container", async () => {
    render(<QrSvg value="QR_abc123_def456" label="QR login code" />);

    const container = await screen.findByRole("img", { name: "QR login code" });
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    // Sanity: the injected markup is a real SVG with QR path data, not an
    // empty shell.
    expect(container.querySelector("svg path")).not.toBeNull();
  });

  it("hides the injected markup from assistive tech (the container itself carries the accessible name)", async () => {
    render(<QrSvg value="QR_abc123_def456" label="QR login code" />);

    const container = await screen.findByRole("img", { name: "QR login code" });
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("re-generates a different SVG when the value prop changes", async () => {
    const { rerender } = render(<QrSvg value="QR_first_value" label="QR login code" />);
    const container = await screen.findByRole("img", { name: "QR login code" });
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    const firstMarkup = container.querySelector("svg")?.outerHTML;

    rerender(<QrSvg value="QR_a_totally_different_value" label="QR login code" />);
    await waitFor(() => expect(container.querySelector("svg")?.outerHTML).not.toBe(firstMarkup));
  });

  it("forwards className to the container", async () => {
    render(<QrSvg value="QR_abc" label="QR login code" className="size-16 rounded" />);
    const container = await screen.findByRole("img", { name: "QR login code" });
    expect(container.className).toContain("size-16");
    expect(container.className).toContain("rounded");
  });
});
