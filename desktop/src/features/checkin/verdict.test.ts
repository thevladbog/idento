import { describe, expect, it } from "vitest";
import { outcomeToVerdict } from "./verdict";

describe("outcomeToVerdict", () => {
  it.each([
    ["checked_in", "allowed"],
    ["already_checked_in", "already_checked_in"],
    ["blocked", "no_access"],
    ["not_found", "not_registered"],
  ] as const)("maps %s to %s", (outcome, verdict) => {
    expect(outcomeToVerdict(outcome)).toBe(verdict);
  });
});
