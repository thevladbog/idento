import * as React from "react";
import { useAttendeesPage } from "../attendees/hooks";
import type { components } from "../../shared/api/schema";

type Attendee = components["schemas"]["Attendee"];

// Board 4a/4b's sample persona (P3.1 Task 12, spec §6) -- the ONE sanctioned
// "fabricated" preview datum, always shown next to a `badgePreviewSample`
// label wherever it renders (PreviewPicker) so it's never mistaken for a
// real attendee's data. Values match board 4b's own canvas-footer sample
// ("Sample: Анна Петрова") -- see .superpowers/sdd/p3-board-4a-4d-extract.md
// line 165 -- and the P3.1 task-12 brief verbatim.
export const SAMPLE_PERSONA: Record<string, string> = {
  first_name: "Анна",
  last_name: "Петрова",
  email: "anna@example.com",
  company: "ООО «Вектор»",
  position: "Producer",
  code: "PD-0107",
};

// custom_fields values are `unknown` (arbitrary JSON) per the Attendee
// schema -- the canvas only ever renders strings (canvasMath's
// resolveElementText). This mirrors how the value would print without
// inventing formatting the backend itself doesn't apply (badge_zpl.go's map
// is untyped `interface{}`; ZPL substitution just stringifies whatever's
// there via Go's fmt machinery -- `String(value)` is the JS equivalent for
// the number/boolean cases, `""` for null/undefined so a not-yet-filled
// custom field renders as empty rather than the string "null"/"undefined").
function stringifyCustomFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return String(value);
}

// Mirrors backend/internal/handler/badge_zpl.go:23-42's attendeeToData
// EXACTLY:
//
//   data := map[string]interface{}{
//     "id": a.ID.String(), "first_name": a.FirstName, "last_name": a.LastName,
//     "email": a.Email, "company": a.Company, "position": a.Position, "code": a.Code,
//   }
//   if a.CustomFields != nil {
//     for k, v := range a.CustomFields {
//       if _, ok := data[k]; ok { continue } // avoid overwriting standard attendee keys
//       data[k] = v
//     }
//   }
//
// i.e. the seven standard attendee fields are seeded FIRST, then each
// custom_fields entry is added -- but a custom field sharing a standard
// key's name is SKIPPED, never overwriting the standard value. `id` is
// included (matching the Go map) even though bindings.ts's bindingOptions
// deliberately never offers it as a bindable UI source -- an element could
// still carry a hand-authored/legacy `source: "id"`, and this map must
// resolve it exactly like the backend would.
export function attendeeToPreviewData(attendee: Attendee): Record<string, string> {
  const data: Record<string, string> = {
    id: attendee.id,
    first_name: attendee.first_name,
    last_name: attendee.last_name,
    email: attendee.email,
    company: attendee.company,
    position: attendee.position,
    code: attendee.code,
  };
  if (attendee.custom_fields) {
    for (const [key, value] of Object.entries(attendee.custom_fields)) {
      if (key in data) continue;
      data[key] = stringifyCustomFieldValue(value);
    }
  }
  return data;
}

const PER_PAGE = 50;
// Same debounce delay/pattern as AttendeesPage.tsx's own search box (local
// input state gives instant keystroke feedback; the query param only
// updates SEARCH_DEBOUNCE_MS after typing stops) -- reused here so the
// picker's search box feels identical to the attendees list's.
const SEARCH_DEBOUNCE_MS = 250;

export type PreviewMode = "attendee" | "sample";

export interface UsePreviewAttendeeResult {
  data: Record<string, string>;
  mode: PreviewMode;
  attendee?: Attendee;
  setAttendee: (attendee: Attendee) => void;
  search: string;
  setSearch: (value: string) => void;
  options: Attendee[];
  // Distinguishes the two sample-mode causes for PreviewPicker's honesty
  // note (spec §6 "error != silently-sample") -- `mode` alone can't tell a
  // genuinely empty event apart from a failed list fetch; both fall back to
  // the same SAMPLE_PERSONA data, but only the fetch-error case shows the
  // extra `badgePreviewListError` note.
  listError: boolean;
}

// P3.1 Task 12: resolves the badge canvas's live preview data.
//
// Two separate `useAttendeesPage` calls, not one:
//  - `baseQuery` (page 1, NO search) is the stable basis for "does this
//    event have any attendees at all" and "what's the default first
//    attendee" -- its query key never changes as the user types into the
//    picker's search box, so typing a search that happens to match nothing
//    can never flip the canvas over to the sample persona (a real preview
//    already resolved stays resolved) and can never transiently flash
//    sample data while a fresh search-key fetch is in flight.
//  - `searchQuery` (page 1, debounced `search`) exists purely to drive the
//    picker dropdown's own option list.
// When `debouncedSearch` is empty (the common case: no search typed yet)
// both calls share the exact same params and therefore the exact same
// TanStack Query cache key -- react-query dedupes them to a single network
// request, so this costs nothing extra outside of an active search.
export function usePreviewAttendee(eventId: string): UsePreviewAttendeeResult {
  const [search, setSearchState] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [selectedAttendee, setSelectedAttendee] = React.useState<Attendee | null>(null);

  // Reset per-event picks whenever the previewed event changes -- same
  // "reset the per-event UI state the reducer doesn't own" convention
  // BadgeEditorPage.tsx's own eventId-keyed effect uses for its save-model
  // flags (conflict/saveErrorVisible/etc). The base/search queries below
  // re-fetch on their own (eventId is part of their query key); only this
  // hook's own local state needs an explicit reset.
  React.useEffect(() => {
    setSearchState("");
    setDebouncedSearch("");
    setSelectedAttendee(null);
  }, [eventId]);

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  const baseQuery = useAttendeesPage(eventId, { page: 1, perPage: PER_PAGE });
  const searchQuery = useAttendeesPage(eventId, { page: 1, perPage: PER_PAGE, search: debouncedSearch });

  const options = searchQuery.data?.attendees ?? [];
  const baseAttendees = baseQuery.data?.attendees ?? [];
  const listError = baseQuery.isError;
  const zeroAttendees = baseQuery.isSuccess && baseQuery.data.total === 0;
  const candidate = selectedAttendee ?? baseAttendees[0];

  // Attendee mode requires: no list error, a genuinely non-empty event, the
  // base fetch having actually resolved (never fabricate during the initial
  // loading window -- fall back to the labeled sample instead), AND a real
  // candidate attendee to show. Anything else is sample mode.
  const resolvedAttendee = !listError && !zeroAttendees && baseQuery.isSuccess && candidate ? candidate : undefined;
  const mode: PreviewMode = resolvedAttendee ? "attendee" : "sample";
  const data = resolvedAttendee ? attendeeToPreviewData(resolvedAttendee) : SAMPLE_PERSONA;

  function setSearch(value: string) {
    setSearchState(value);
  }

  function setAttendee(attendee: Attendee) {
    setSelectedAttendee(attendee);
    // Picking an attendee closes the loop on the current search -- the next
    // time the dropdown opens it shows the full list again, not still
    // filtered down to whatever the operator typed to find this one.
    setSearchState("");
  }

  return {
    data,
    mode,
    attendee: resolvedAttendee,
    setAttendee,
    search,
    setSearch,
    options,
    listError,
  };
}
