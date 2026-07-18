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
import { Button, Input } from "@idento/ui";
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
  // P4.1 Task 10 -- degraded mode's "read-only manual search" requirement:
  // StationPage passes `true` while useConnectionState reports the station
  // offline. Deliberately separate from `enabled` (which only ever reflects
  // "a previous scan is still resolving", unrelated to connectivity): the
  // wedge/scanner affordances stay driven by `enabled` alone even while
  // offline (a physical scan must still be CAPTURED — never silently
  // dropped — so StationPage can show an explicit offline verdict instead;
  // see StationPage.tsx's own comment), but the manual search's pick
  // affordance is a CONSCIOUS operator action, not a passive capture, so
  // it's simply removed outright: search results still render (whatever the
  // already-cached query returns), just without a clickable check-in CTA.
  readOnly?: boolean;
  // Final cross-task review finding -- the check-in settings' own
  // `manual_search_enabled` (settingsTypes.ts, Task 5) previously had no
  // consumer at all: the launch ceremony (Task 11) let the operator toggle
  // "Allow manual search" and persisted it, but nothing at the station ever
  // read it back, so the manual search box stayed fully functional
  // regardless of the setting. StationPage.tsx now threads
  // `settings.manual_search_enabled` in here. Defaults to `true` (matching
  // DEFAULT_CHECKIN_SETTINGS.manual_search_enabled) so any other caller/test
  // that doesn't know about this setting keeps the box's prior always-on
  // behavior. Deliberately independent of `mode`/`readOnly`: this setting
  // only controls the manual TEXT SEARCH fallback below, never the
  // wedge/scanner scan-input mechanism itself (that stays driven by `mode`/
  // `enabled` alone, unaffected by this prop).
  manualSearchEnabled?: boolean;
  onCode(code: string): void;
  onPickAttendee(attendee: Attendee): void;
}

export function ScanInput({
  eventId,
  mode,
  enabled,
  readOnly = false,
  manualSearchEnabled = true,
  onCode,
  onPickAttendee,
}: ScanInputProps) {
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
  // anything. `&& manualSearchEnabled` -- final cross-task review finding:
  // the search box itself is unmounted below when this setting is off, but
  // this also belt-and-suspenders-guards the request itself against firing
  // for anything that could still reach `debouncedSearch` (e.g. this prop
  // flipping false mid-typing) while the setting is disabled. `&& !readOnly`
  // -- PR #77 bot-review round, Finding K: while degraded/offline, this is a
  // READ-ONLY CACHED roster (this file's own header comment) -- a NEW search
  // term must never issue an uncached network request that's just going to
  // fail against an unreachable backend. Already-cached data for a term
  // typed BEFORE going read-only stays visible regardless (react-query keeps
  // serving `.data` for a disabled query from its cache), so this only stops
  // FRESH fetches, never hides what's already loaded.
  const searchQuery = useAttendeesPage(eventId, {
    page: 1,
    perPage: SEARCH_RESULTS_LIMIT,
    search: debouncedSearch,
    enabled: hasQuery && manualSearchEnabled && !readOnly,
  });

  const results = hasQuery ? (searchQuery.data?.attendees ?? []) : [];
  // PR #77 bot-review round, Finding K: gated on an actually-SUCCESSFUL
  // query, not just "loading is false and results are empty" -- the old
  // condition couldn't distinguish a genuine empty result from a query that
  // FAILED (or, per the `enabled` change above, never even attempted) to
  // fetch, presenting either as a false "no matching attendees."
  const showNoMatches = hasQuery && searchQuery.isSuccess && results.length === 0;

  function pick(attendee: Attendee) {
    // PR #77 bot-review round, Finding M -- defense in depth alongside the
    // result button's own `disabled` attribute below: while a previous
    // scan/pick is still resolving (`enabled` false, which already disables
    // the wedge/scanner input), a manual-search pick must be an equally
    // inert no-op, not a second, competing check-in racing the first one's
    // verdict/print state.
    if (!enabled) return;
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
          {degraded
            ? // PR #77 bot-review round, Finding Q -- the "use manual search
              // below" copy is actively wrong/misleading when
              // manualSearchEnabled is false: ScanInput renders no manual
              // search box in ANY mode in that configuration (the block
              // below), so pointing the operator at a control that isn't
              // there helps no one.
              t(manualSearchEnabled ? "checkinScanScannerDegradedHint" : "checkinScanScannerDegradedHintNoManualSearch")
            : t("checkinScanScannerHint")}
        </p>
      ) : null}

      {mode === "manual" ? <p className="text-body text-muted-foreground">{t("checkinScanManualHint")}</p> : null}

      {/* Final cross-task review finding -- gated on
          `manual_search_enabled` (threaded from StationPage.tsx as
          `manualSearchEnabled`), same one-conditional-block-per-affordance
          pattern as the wedge/scanner/manual hints above: when the operator
          has turned "Allow manual search" off (LaunchCeremony.tsx), this
          entire text-search fallback -- box, results, hints -- is removed
          outright rather than merely disabled, so the setting actually has
          an effect instead of staying inert. Deliberately independent of
          `mode`: the wedge/scanner scan-input mechanism above is untouched
          by this setting either way. */}
      {manualSearchEnabled ? (
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
              {results.map((attendee) => {
                const content = (
                  <>
                    <span className="text-body text-foreground">
                      {attendee.first_name} {attendee.last_name}
                    </span>
                    <span className="text-caption text-muted-foreground">
                      {attendee.email} · {attendee.code}
                    </span>
                  </>
                );
                // No check-in CTA at all while offline (this task's brief:
                // "look someone up, no check-in button") -- a plain,
                // non-interactive row, not a disabled button (a disabled
                // button would still imply "there's an action here, just
                // temporarily blocked", which isn't the story: this station
                // genuinely can't check anyone in from a stale, cached
                // roster while offline).
                return readOnly ? (
                  <li key={attendee.id} data-testid="checkin-search-result-readonly">
                    <div className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left">{content}</div>
                  </li>
                ) : (
                  <li key={attendee.id}>
                    {/* PR #77 bot-review round 3, Finding 2 -- the shared
                        @idento/ui Button (unlike the Select primitive a
                        DIFFERENT, already-deferred finding flagged, Button
                        genuinely exists) replaces the previous hand-rolled
                        <button>. No pattern for a full-width, chrome-
                        stripped, multi-line list row composed from Button
                        exists elsewhere in this codebase to mirror (checked
                        AttendeesPage.tsx/AttendeeTable.tsx's own row --
                        actually a raw `<li role="button">`, not a Button --
                        and RecentScansRail.tsx's row actions, which are
                        ordinary single-line `size="sm"` buttons INSIDE a
                        row, not shaped like this one) -- `variant="ghost"`
                        (no background/border chrome, `hover:bg-muted`
                        already built in) plus a className override defeats
                        `buttonVariants`' `inline-flex items-center
                        justify-center` centering and `h-9 px-4 py-2` sizing
                        to reproduce this row's exact prior visual shape
                        (full-width, left-aligned, multi-line, disabled
                        opacity/cursor). `disabled`/`onClick` behavior is
                        unchanged -- a pure component swap. */}
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={!enabled}
                      onClick={() => pick(attendee)}
                      className="h-auto w-full flex-col items-start justify-start gap-0.5 rounded-none px-3 py-2 text-left font-normal disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      {content}
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {results.length > 0 && readOnly ? (
            <p className="text-caption text-muted-foreground">{t("checkinManualSearchReadOnlyHint")}</p>
          ) : null}

          {showNoMatches ? (
            <p className="text-caption text-muted-foreground">{t("checkinManualSearchNoMatches")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
