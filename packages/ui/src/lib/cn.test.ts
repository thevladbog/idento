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

  it("keeps custom type-ramp utilities distinct from text-color classes", () => {
    expect(cn("text-body", "text-primary-foreground")).toBe("text-body text-primary-foreground");
    expect(cn("text-card-title", "text-muted-foreground")).toBe("text-card-title text-muted-foreground");
  });

  it("still resolves conflicts within the type-ramp group itself", () => {
    expect(cn("text-body", "text-caption")).toBe("text-caption");
  });
});
