import { cn } from "./cn";

describe("cn", () => {
  it("merges class strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    const disabled = false;
    expect(cn("a", disabled && "b", undefined, "c")).toBe("a c");
  });

  it("resolves tailwind conflicts (last wins)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("bg-success", "bg-destructive")).toBe("bg-destructive");
  });
});
