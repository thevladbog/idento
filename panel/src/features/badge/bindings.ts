// Badge element binding vocabulary (P3.1 Task 7) — the single source of
// truth for which attendee-data source names the badge editor can bind an
// element to, and how a bound source renders as UI copy.

// Mirrors backend/internal/handler/badge_zpl.go:23-42's attendeeToData,
// the flat map ZPL generation substitutes template bindings against:
//   data := map[string]interface{}{
//     "id": ..., "first_name": ..., "last_name": ..., "email": ...,
//     "company": ..., "position": ..., "code": ...,
//   }
// DELIBERATELY excludes "id" — there is no "print the attendee's internal
// UUID on a badge" use case, so the editor never offers it as a bindable
// field even though attendeeToData's map carries it for other consumers.
export const STANDARD_BINDINGS = [
  "first_name",
  "last_name",
  "email",
  "company",
  "position",
  "code",
] as const;

export type StandardBinding = (typeof STANDARD_BINDINGS)[number];

// Every bindable source name for one event: the standard attendee fields
// above, plus that event's custom field_schema entries appended in order,
// deduped against the standard list AND against repeats within
// field_schema itself. A custom field sharing a standard name folds into
// the standard entry — same precedence attendeeToData's own
// `if (_, ok := data[k]; ok) { continue }` guard applies when merging
// a.CustomFields on top of the standard keys.
export function bindingOptions(fieldSchema: string[]): string[] {
  const seen = new Set<string>(STANDARD_BINDINGS);
  const options: string[] = [...STANDARD_BINDINGS];
  for (const field of fieldSchema) {
    if (seen.has(field)) continue;
    seen.add(field);
    options.push(field);
  }
  return options;
}

// The UI convention for how a bound source renders as badge template text
// — e.g. displayBinding("first_name") === "{first_name}". This is the same
// `{source}` placeholder syntax BadgeElement.text carries for non-static
// content elsewhere in the editor (see templateTypes.ts).
export function displayBinding(source: string): string {
  return `{${source}}`;
}
