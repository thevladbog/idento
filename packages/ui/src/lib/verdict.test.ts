import { VERDICTS, verdictClasses } from "./verdict";

describe("verdict vocabulary", () => {
  it("matches the shared VerdictBand semantics", () => {
    expect(VERDICTS).toEqual(["allowed", "no_access", "not_registered", "already_checked_in"]);
  });

  it("maps every verdict to token-backed classes", () => {
    for (const v of VERDICTS) {
      expect(verdictClasses[v].text).toMatch(/^text-verdict-/);
      expect(verdictClasses[v].bg).toMatch(/^bg-verdict-/);
      expect(verdictClasses[v].solidBg).toMatch(/^bg-verdict-/);
    }
  });

  it("repeat scan uses the info/blue family", () => {
    expect(verdictClasses.already_checked_in.text).toBe("text-verdict-repeat");
  });
});
