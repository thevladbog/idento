// P4.1 Task 8's searchParams module had no dedicated test file -- coverage
// was only indirect, via StationPage.test.tsx's routing block. PR #77
// bot-review round, Finding G, adds UUID-format validation to
// `validateCheckinStationSearch`; this file gives that parser (and the
// `checkinStationBeforeLoad` guard built on it) direct unit coverage.
import { describe, expect, it } from "vitest";
import { checkinStationBeforeLoad, validateCheckinStationSearch } from "./searchParams";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("validateCheckinStationSearch", () => {
  it("keeps a well-formed UUID station id verbatim", () => {
    expect(validateCheckinStationSearch({ station: VALID_UUID })).toEqual({ station: VALID_UUID });
  });

  it("accepts an uppercase-hex UUID (case-insensitive)", () => {
    expect(validateCheckinStationSearch({ station: VALID_UUID.toUpperCase() })).toEqual({
      station: VALID_UUID.toUpperCase(),
    });
  });

  it("resolves a missing station value to undefined", () => {
    expect(validateCheckinStationSearch({})).toEqual({ station: undefined });
  });

  it("resolves an empty string to undefined", () => {
    expect(validateCheckinStationSearch({ station: "" })).toEqual({ station: undefined });
  });

  it("resolves a non-string value to undefined", () => {
    expect(validateCheckinStationSearch({ station: 42 })).toEqual({ station: undefined });
  });

  // PR #77 bot-review round, Finding G -- a malformed (non-UUID) station
  // value previously passed through verbatim, letting StationPage mount and
  // send it in heartbeat/check-in requests, causing repeated 400s instead of
  // the intended redirect-to-launch-ceremony behavior. A malformed value now
  // collapses to `undefined`, same as missing.
  it("resolves a non-UUID string to undefined", () => {
    expect(validateCheckinStationSearch({ station: "not-a-uuid" })).toEqual({ station: undefined });
    expect(validateCheckinStationSearch({ station: "st-1" })).toEqual({ station: undefined });
    expect(validateCheckinStationSearch({ station: "11111111-1111-1111-1111" })).toEqual({ station: undefined });
    expect(validateCheckinStationSearch({ station: `${VALID_UUID}-extra` })).toEqual({ station: undefined });
  });

  // Deliberately NOT rejected here -- StationPage.tsx's own file-header
  // comment documents "an unregistered-but-well-formed id is treated as a
  // station this page simply can't NAME yet ... not as a reason to bounce
  // the operator back to the ceremony mid-shift" as a deliberate design
  // decision. This module has no knowledge of the registered station list at
  // all (format is the only thing it checks), so this test re-confirms the
  // format check alone doesn't -- and structurally can't -- reject an
  // unregistered-but-valid id.
  it("keeps a well-formed but hypothetically-unregistered UUID (format-only validation, no existence/ownership check)", () => {
    const unregistered = "99999999-9999-4999-8999-999999999999";
    expect(validateCheckinStationSearch({ station: unregistered })).toEqual({ station: unregistered });
  });
});

describe("checkinStationBeforeLoad", () => {
  it("redirects to the launch ceremony when station is undefined (missing or malformed both collapse identically upstream)", () => {
    expect(() =>
      checkinStationBeforeLoad({ params: { eventId: "evt-1" }, search: { station: undefined } }),
    ).toThrow();
  });

  it("does not redirect when station is a well-formed UUID", () => {
    expect(() =>
      checkinStationBeforeLoad({ params: { eventId: "evt-1" }, search: { station: VALID_UUID } }),
    ).not.toThrow();
  });
});
