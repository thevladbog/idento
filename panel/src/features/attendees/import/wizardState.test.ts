import { createInitialWizardState } from "./wizardState";

describe("createInitialWizardState", () => {
  it("starts at step 1 with no file, utf-8 default, not overridden, and empty rows/headers/mapping", () => {
    expect(createInitialWizardState()).toEqual({
      step: 1,
      encoding: "utf-8",
      encodingOverridden: false,
      rows: [],
      headers: [],
      mapping: {},
    });
  });

  it("returns a fresh object each call (no shared mutable state across wizard instances)", () => {
    const a = createInitialWizardState();
    const b = createInitialWizardState();
    expect(a).not.toBe(b);
    expect(a.rows).not.toBe(b.rows);
    expect(a.mapping).not.toBe(b.mapping);
  });
});
