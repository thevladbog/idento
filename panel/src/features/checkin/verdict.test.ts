import { VERDICTS, verdictClasses } from "@idento/ui";
import { outcomeToVerdict } from "./verdict";

// P4.1 Task 6 -- the check-in station's four outcomes map onto the existing
// @idento/ui verdict vocabulary (plan global constraint: "Verdict rendering
// reuses @idento/ui verdictClasses" -- never invent new colors). This is the
// ONE place that mapping is defined; Task 8's VerdictCard consumes it rather
// than re-deriving its own copy.
describe("outcomeToVerdict", () => {
  it("maps checked_in to the allowed (green) verdict", () => {
    expect(outcomeToVerdict("checked_in")).toBe("allowed");
  });

  it("maps already_checked_in to the already_checked_in (blue/repeat) verdict", () => {
    expect(outcomeToVerdict("already_checked_in")).toBe("already_checked_in");
  });

  it("maps blocked to the no_access (red) verdict", () => {
    expect(outcomeToVerdict("blocked")).toBe("no_access");
  });

  it("maps not_found (client-side outcome -- an unresolved scanned code never reaches the server) to the not_registered (muted) verdict", () => {
    expect(outcomeToVerdict("not_found")).toBe("not_registered");
  });

  it("every mapped verdict is a real @idento/ui VERDICTS member with token-backed classes (no invented colors)", () => {
    const outcomes = ["checked_in", "already_checked_in", "blocked", "not_found"] as const;
    for (const outcome of outcomes) {
      const verdict = outcomeToVerdict(outcome);
      expect(VERDICTS).toContain(verdict);
      expect(verdictClasses[verdict].text).toMatch(/^text-verdict-/);
    }
  });
});
