import { afterEach, describe, expect, it } from "vitest";
import { getManifestUrlOverride, setManifestUrlOverride } from "./updateConfig";

afterEach(() => {
  localStorage.clear();
});

describe("getManifestUrlOverride / setManifestUrlOverride", () => {
  it("defaults to an empty string", () => {
    expect(getManifestUrlOverride()).toBe("");
  });

  it("round-trips a trimmed value", () => {
    setManifestUrlOverride("  https://mirror.example.internal/latest.json  ");
    expect(getManifestUrlOverride()).toBe("https://mirror.example.internal/latest.json");
  });
});
