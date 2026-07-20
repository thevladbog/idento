import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BlockingBanner } from "./blocking-banner";

describe("BlockingBanner", () => {
  it("renders alert with title, subtitle, hint and working retry", async () => {
    const onRetry = vi.fn();
    render(<BlockingBanner title="Нет связи с сервером" subtitle="Отметки не записываются" retryHint="авто-повтор через 12 с" retryLabel="Повторить сейчас" onRetry={onRetry} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("bg-kiosk-danger");
    expect(screen.getByText("Отметки не записываются")).toBeInTheDocument();
    expect(screen.getByText("авто-повтор через 12 с")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Повторить сейчас" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
