import { bindingOptions, displayBinding, STANDARD_BINDINGS } from "./bindings";

describe("STANDARD_BINDINGS", () => {
  it("matches attendeeToData's flat map keys minus id (backend/internal/handler/badge_zpl.go:23-42)", () => {
    expect(STANDARD_BINDINGS).toEqual(["first_name", "last_name", "email", "company", "position", "code"]);
  });
});

describe("bindingOptions", () => {
  it("returns just the standard bindings when the event has no custom field_schema", () => {
    expect(bindingOptions([])).toEqual(["first_name", "last_name", "email", "company", "position", "code"]);
  });

  it("appends the event's custom fields after the standard bindings, in field_schema order", () => {
    expect(bindingOptions(["dietary", "shirt_size"])).toEqual([
      "first_name", "last_name", "email", "company", "position", "code", "dietary", "shirt_size",
    ]);
  });

  it("dedupes a custom field that collides with a standard binding name, keeping only the standard entry", () => {
    // Mirrors attendeeToData's own `if (_, ok := data[k]; ok) { continue }`
    // precedence: a custom field named like a standard attendee key never
    // produces a duplicate binding option.
    expect(bindingOptions(["company", "dietary"])).toEqual([
      "first_name", "last_name", "email", "company", "position", "code", "dietary",
    ]);
  });

  it("dedupes repeated custom field names", () => {
    expect(bindingOptions(["dietary", "dietary"])).toEqual([
      "first_name", "last_name", "email", "company", "position", "code", "dietary",
    ]);
  });
});

describe("displayBinding", () => {
  it("wraps a standard source name in curly braces", () => {
    expect(displayBinding("first_name")).toBe("{first_name}");
  });

  it("wraps a custom source name in curly braces", () => {
    expect(displayBinding("dietary")).toBe("{dietary}");
  });
});
