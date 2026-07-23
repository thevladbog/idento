import { act, render, screen } from "@testing-library/react";
import { QrDisplay } from "./qr-display";

describe("QrDisplay", () => {
  // @testing-library/dom's `waitFor`/`findBy*` only recognize *Jest's* fake
  // timers (it feature-detects a global `jest` with a mocked `setTimeout`), so
  // under Vitest's `vi.useFakeTimers()` its internal polling interval is
  // scheduled on the faked clock and never fires — any test that awaits
  // `findBy*`/`waitFor` while fake timers are active hangs until the real
  // per-test timeout. Shimming a minimal `jest.advanceTimersByTime` (aliased to
  // Vitest's own) makes testing-library detect fake timers and drive its
  // polling through them instead of a dead real-time wait. See
  // https://github.com/testing-library/dom-testing-library/issues/939.
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as any).jest = {
      advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).jest;
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
