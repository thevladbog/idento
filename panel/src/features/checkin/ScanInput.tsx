// P4.1 Task 7 -- the check-in station's scan surface: the mode-appropriate
// affordance (wedge's hidden input / scanner's status hint / manual's plain
// hint) PLUS the always-present manual search box, per the brief ("the
// always-present manual search box (name/email/code via ?search=,
// debounced, pick -> submitAttendee)"). This component owns no check-in
// state itself -- `onCode`/`onPickAttendee` are the caller's (Task 8's
// StationPage) wiring into useCheckinFlow's submitCode/submitAttendee, kept
// generic here so this file has no dependency on that hook.
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@idento/ui";
import type { components } from "../../shared/api/schema";
import { useAttendeesPage } from "../attendees/hooks";
import { useScanInput, type ScanInputMode } from "./useScanInput";

type Attendee = components["schemas"]["Attendee"];

const SEARCH_DEBOUNCE_MS = 250;
// A short-list fallback lookup, not the full attendees table (Task 8's
// StationPage is a near-fullscreen verdict-first layout, not a data grid) --
// enough rows to find the one attendee the operator is after without the
// dropdown becoming its own scroll surface.
const SEARCH_RESULTS_LIMIT = 8;

export interface ScanInputProps {
  eventId: string;
  mode: ScanInputMode;
  // Mirrors useScanInput's own `enabled` -- StationPage passes false while a
  // previous scan is still resolving so a fresh scan/pick can't race it.
  enabled: boolean;
  onCode(code: string): void;
  onPickAttendee(attendee: Attendee): void;
}

export function ScanInput({ eventId, mode, enabled, onCode, onPickAttendee }: ScanInputProps) {
  const { t } = useTranslation();
  const { degraded, wedgeInputProps } = useScanInput({ mode, onCode, enabled });

  // Local keystroke state gives the search box instant feedback; the actual
  // query (and therefore the request) only updates SEARCH_DEBOUNCE_MS after
  // the user stops typing -- same pattern as AttendeesPage.tsx's own search
  // debounce.
  const [searchInput, setSearchInput] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");

  React.useEffect(() => {
    const trimmed = searchInput.trim();
    const timeoutId = window.setTimeout(() => setDebouncedSearch(trimmed), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  const hasQuery = debouncedSearch.length > 0;

  // `enabled: hasQuery` (Task 7's addition to useAttendeesPage) skips the
  // request entirely while the search box is empty — mounting the station
  // shouldn't dump the roster's first page before the operator has typed
  // anything.
  const searchQuery = useAttendeesPage(eventId, {
    page: 1,
    perPage: SEARCH_RESULTS_LIMIT,
    search: debouncedSearch,
    enabled: hasQuery,
  });

  const results = hasQuery ? (searchQuery.data?.attendees ?? []) : [];
  const showNoMatches = hasQuery && !searchQuery.isLoading && !searchQuery.isFetching && results.length === 0;

  function pick(attendee: Attendee) {
    setSearchInput("");
    setDebouncedSearch("");
    onPickAttendee(attendee);
  }

  return (
    <div className="flex flex-col gap-4">
      {mode === "wedge" ? (
        <>
          <p className="text-body text-muted-foreground">{t("checkinScanWedgeHint")}</p>
          {/* sr-only (not type="hidden", which never receives keystrokes):
              a keyboard-wedge scanner "types" into whatever element has
              focus, so this input must stay in the accessibility tree and
              focusable, just visually hidden. */}
          <input {...wedgeInputProps} aria-label={t("checkinScanWedgeInputLabel")} className="sr-only" />
        </>
      ) : null}

      {mode === "scanner" ? (
        <p className="text-body text-muted-foreground">
          {degraded ? t("checkinScanScannerDegradedHint") : t("checkinScanScannerHint")}
        </p>
      ) : null}

      {mode === "manual" ? <p className="text-body text-muted-foreground">{t("checkinScanManualHint")}</p> : null}

      <div className="flex flex-col gap-2">
        <Input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={t("checkinManualSearchPlaceholder")}
          aria-label={t("checkinManualSearchPlaceholder")}
        />

        {results.length > 0 ? (
          <ul className="flex flex-col gap-1 rounded-md border border-border">
            {results.map((attendee) => (
              <li key={attendee.id}>
                <button
                  type="button"
                  onClick={() => pick(attendee)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted"
                >
                  <span className="text-body text-foreground">
                    {attendee.first_name} {attendee.last_name}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {attendee.email} · {attendee.code}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {showNoMatches ? <p className="text-caption text-muted-foreground">{t("checkinManualSearchNoMatches")}</p> : null}
      </div>
    </div>
  );
}
