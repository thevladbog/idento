import { render, screen } from "@testing-library/react";
import { Input } from "./input";
import { Label } from "./label";

describe("Input", () => {
  it("is reachable by its label", () => {
    render(
      <>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" />
      </>,
    );
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("forwards native props", () => {
    render(<Input placeholder="you@example.com" />);
    expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
  });
});
