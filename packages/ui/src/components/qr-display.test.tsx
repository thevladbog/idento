import { act, render, screen } from "@testing-library/react";
import { QrDisplay } from "./qr-display";

describe("QrDisplay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function future(seconds: number): string {
    return new Date(Date.now() + seconds * 1000).toISOString();
  }

  it("renders the title, subtitle and a QR svg for the given value", async () => {
    render(
      <QrDisplay
        value="https://example.test/token/abc"
        title="Anna Smirnova"
        subtitle="Staff login · Registration desk"
        expiresAt={future(300)}
        expiredLabel="Code expired"
        regenerateLabel="Regenerate"
        closeLabel="Close"
        onClose={() => {}}
        onRegenerate={() => {}}
        hint="Have Anna scan this with the Idento station app."
      />,
    );
    expect(screen.getByText("Anna Smirnova")).toBeInTheDocument();
    expect(screen.getByText("Staff login · Registration desk")).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "https://example.test/token/abc" })).toBeInTheDocument();
    expect(screen.getByText(/Have Anna scan this/)).toBeInTheDocument();
  });

  it("counts down toward expiry and flips to the expired state with only a regenerate action", async () => {
    const onRegenerate = vi.fn();
    render(
      <QrDisplay
        value="tok"
        title="t"
        subtitle="s"
        expiresAt={future(2)}
        expiredLabel="Code expired"
        regenerateLabel="Regenerate"
        closeLabel="Close"
        onClose={() => {}}
        onRegenerate={onRegenerate}
      />,
    );
    expect(screen.getByText(/0:0[12]/)).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(screen.getByText("Code expired")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    fireEventClickRegenerate();
    expect(onRegenerate).toHaveBeenCalledTimes(1);

    function fireEventClickRegenerate() {
      screen.getByRole("button", { name: "Regenerate" }).click();
    }
  });

  it("renders no countdown chrome when expiresAt is null", () => {
    render(
      <QrDisplay
        value="tok"
        title="t"
        subtitle="s"
        expiresAt={null}
        expiredLabel="Code expired"
        regenerateLabel="Regenerate"
        closeLabel="Close"
        onClose={() => {}}
        onRegenerate={() => {}}
      />,
    );
    expect(screen.queryByText(/Expires in/)).not.toBeInTheDocument();
  });

  it("calls onClose from the close button", () => {
    const onClose = vi.fn();
    render(
      <QrDisplay
        value="tok"
        title="t"
        subtitle="s"
        expiresAt={null}
        expiredLabel="Code expired"
        regenerateLabel="Regenerate"
        closeLabel="Close"
        onClose={onClose}
        onRegenerate={() => {}}
      />,
    );
    screen.getByRole("button", { name: "Close" }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
