// P4.1 Task 7 -- the check-in station's three scan-input modes, unified
// behind one hook so StationPage (Task 8) just switches `mode` per the
// event's CheckinSettings.scan_input (Task 5) without re-deriving any of
// this wiring itself.
//
// wedge: a USB/keyboard-wedge scanner "types" its code into whatever has
// focus on the page, then sends Enter -- so this mode is really just "own a
// hidden, always-focused text input and treat Enter as the scan boundary".
// scanner: a handheld scanner the AGENT (not the browser) talks to over
// serial/USB -- the panel has no direct hardware access, so it polls the
// agent's last-scan buffer instead (agentClient.consumeLastScan, which
// atomically reads AND clears in one request -- confirmed against
// agent/openapi.yaml's real POST /scan/consume contract -- not an invented
// endpoint).
// manual: no auto-input at all; ScanInput.tsx's always-present search box
// is the only path to a pick in this mode.
import * as React from "react";
import { agentClient } from "../../shared/agent/agentClient";

export type ScanInputMode = "wedge" | "scanner" | "manual";

export interface UseScanInputOptions {
  mode: ScanInputMode;
  onCode(code: string): void;
  // Gates BOTH the wedge input's focus/typing and the scanner poll --
  // callers (Task 8) pass false while a previous scan is still resolving
  // (useCheckinFlow's status !== "idle") so a scanner double-fire or a
  // stray wedge keystroke can't race an in-flight check-in.
  enabled: boolean;
}

export interface WedgeInputProps {
  ref: React.RefObject<HTMLInputElement | null>;
  value: string;
  disabled: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  // PR #77 bot-review round 2, Finding 5 -- see WEDGE_REFOCUS_DELAY_MS's own
  // comment below for what this does and why.
  onBlur: () => void;
}

export interface UseScanInputResult {
  // True only in scanner mode, only once agentClient.consumeLastScan() itself
  // has failed (agent unreachable/erroring) -- ScanInput.tsx uses this to
  // hint the operator toward the always-present manual search fallback
  // rather than silently doing nothing.
  degraded: boolean;
  // Spread onto a (visually-hidden but focusable, e.g. Tailwind `sr-only`
  // -- never `type="hidden"`, which never receives keystrokes) <input> in
  // wedge mode. Harmless to spread in the other modes too (a disabled,
  // unfocused, inert input), but ScanInput.tsx only renders it for "wedge".
  wedgeInputProps: WedgeInputProps;
}

// Matches the brief verbatim ("scanner: single 200ms interval polling
// agentClient.getLastScan()") -- now agentClient.consumeLastScan(), same
// 200ms interval, per the 2026-07-18 atomic-consume migration.
const SCANNER_POLL_INTERVAL_MS = 200;

// PR #77 bot-review round 2, Finding 5 -- the mount/`wedgeActive`-transition
// effect above only re-focuses the hidden wedge capture input on a
// TRANSITION into wedge mode -- once an operator clicks ANYTHING else on the
// page (the manual search box, a Details/Reprint/Undo rail button, a dialog
// control, ...) without `wedgeActive` ever changing, focus moves away and is
// NEVER returned. A keyboard-wedge scan typed after that lands nowhere (or
// in the wrong control) and `onCode` never fires -- a silently dropped scan,
// exactly the "no-scan-lost" violation this station exists to prevent.
//
// The fix: a `blur` handler on the capture input itself (spread via
// `wedgeInputProps.onBlur`) that returns focus to it a SHORT BEAT after it
// loses focus, while wedge mode is still active -- UNLESS the element that
// just gained focus is something the operator is plainly, deliberately
// using right now. Two judgment calls here, documented since this is a UX
// heuristic, not a pure correctness fix:
//
// 1. WHAT counts as "deliberately in use" (isDeliberateFocusTarget below):
//    a text-entry control (the manual search box, a printer <select>, any
//    future contentEditable) the operator might be about to type into, OR
//    anything inside an open dialog/menu/listbox (a Reprint/Undo confirm
//    dialog's Cancel/Confirm buttons, the Details dropdown) -- read from
//    ScanInput.tsx and RecentScansRail.tsx, these are the other focusable
//    surfaces that actually exist on this page. Refocusing THROUGH one of
//    these would fight the operator mid-interaction (e.g. yanking focus out
//    of the manual search box the instant they click into it to type).
// 2. WHY a delay, not a synchronous re-focus: a dialog/menu that's ABOUT to
//    open (Radix moves focus into it via its own effect, shortly after the
//    triggering click -- e.g. clicking the Reprint rail button blurs THIS
//    input before the Dialog has even mounted) needs time to actually
//    receive that focus first. A synchronous steal here would race Radix's
//    own initial-focus management and could yank focus back out of a dialog
//    the instant it opens. The delay is imperceptible to a human operator
//    but generous enough for that race to settle.
const WEDGE_REFOCUS_DELAY_MS = 50;

function isDeliberateFocusTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return el.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]') !== null;
}

export function useScanInput({ mode, onCode, enabled }: UseScanInputOptions): UseScanInputResult {
  const [degraded, setDegraded] = React.useState(false);
  const [wedgeValue, setWedgeValue] = React.useState("");
  const wedgeRef = React.useRef<HTMLInputElement>(null);

  // Read fresh on every call without re-subscribing the effects below to
  // `onCode` identity churn (callers routinely pass an inline closure that
  // changes every render) -- same "ref mirrors the latest callback" idiom
  // used throughout this codebase's other polling/interval hooks.
  const onCodeRef = React.useRef(onCode);
  React.useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  const wedgeActive = mode === "wedge" && enabled;
  // PR #77 bot-review round 2, Finding 5 -- mirrors onCodeRef's own
  // rationale: `handleWedgeBlur`'s delayed callback runs LATER, after
  // `wedgeActive` may have already changed (a scan resolving, or `mode`
  // switching away from wedge entirely) -- a ref (not a closure over the
  // render that scheduled the timeout) is what lets it re-check the CURRENT
  // value rather than an unmount-stale one.
  const wedgeActiveRef = React.useRef(wedgeActive);
  wedgeActiveRef.current = wedgeActive;

  // Autofocus on mount/whenever the wedge input becomes active -- a
  // keyboard-wedge scanner only "types" into whatever element currently has
  // focus, so this input must be focused before the operator can scan at
  // all (and again if `enabled` flips back to true after a scan resolves).
  React.useEffect(() => {
    if (!wedgeActive) return;
    wedgeRef.current?.focus();
  }, [wedgeActive]);

  // PR #77 bot-review round 2, Finding 5 -- returns focus to the wedge input
  // a short beat after it loses focus for ANY reason, not just the
  // `wedgeActive`-transition case the effect above already covers. See
  // WEDGE_REFOCUS_DELAY_MS's own comment for the full rationale (what counts
  // as a "deliberate" focus target to leave alone, and why this is delayed
  // rather than synchronous).
  const refocusTimerRef = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(refocusTimerRef.current), []);

  function handleWedgeBlur() {
    if (!wedgeActiveRef.current) return;
    window.clearTimeout(refocusTimerRef.current);
    refocusTimerRef.current = window.setTimeout(() => {
      if (!wedgeActiveRef.current) return;
      if (isDeliberateFocusTarget(document.activeElement)) return;
      wedgeRef.current?.focus();
    }, WEDGE_REFOCUS_DELAY_MS);
  }

  function handleWedgeChange(event: React.ChangeEvent<HTMLInputElement>) {
    setWedgeValue(event.target.value);
  }

  function handleWedgeKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const code = wedgeValue.trim();
    setWedgeValue("");
    // Refocus synchronously (not via the mount effect above, which won't
    // re-run since `wedgeActive` doesn't change across a scan) so the very
    // next physical scan lands in this input again without the operator
    // touching anything.
    wedgeRef.current?.focus();
    if (code) onCodeRef.current(code);
  }

  // Scanner-mode polling. Each tick calls agentClient.consumeLastScan(),
  // which atomically reads AND clears the agent's buffer in one request
  // (agent/openapi.yaml's POST /scan/consume) -- so every non-empty
  // response is guaranteed to be a scan this hook has never seen before.
  // This replaces the earlier GET /scan/last + POST /scan/clear pair, which
  // had a real race (a second physical scan arriving between this hook's
  // read and its later clear call was silently erased by that clear -- the
  // CodeRabbit finding fixed agent-side by
  // docs/superpowers/plans/2026-07-18-agent-atomic-scan-consume.md) and
  // needed a {code, time} dedup ref plus a separate retry-the-clear-on-
  // failure ref to work around it. Neither is needed anymore: there is no
  // separate clear step to retry, and a repeated poll can never re-observe
  // an already-handled scan (the buffer is already empty after this hook
  // consumed it).
  React.useEffect(() => {
    if (mode !== "scanner" || !enabled) {
      setDegraded(false);
      return;
    }

    let cancelled = false;
    // PR #77 bot-review round 3, Finding 4 -- an in-flight guard, scoped to
    // this one effect run (mirrors `cancelled` above: a plain closure
    // variable, not a ref, since neither needs to survive a `mode`/`enabled`
    // change -- the effect's own cleanup tears the whole interval down and a
    // fresh run gets a fresh `false`). Without this, the 200ms `setInterval`
    // below started a brand-new `poll()` on EVERY tick regardless of whether
    // the PREVIOUS consumeLastScan() round trip had actually finished -- a
    // local agent that accepts a request but stalls (a real possibility on
    // a loaded/slow local network) could let in-flight requests accumulate
    // indefinitely with no visible indication anything was wrong. A tick
    // that lands while a poll is still outstanding simply no-ops now; the
    // NEXT tick after the outstanding one finally resolves/rejects picks
    // polling back up normally.
    let pollInFlight = false;

    async function poll() {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const scan = await agentClient.consumeLastScan();
        if (cancelled) return;
        setDegraded(false);
        if (scan.code) onCodeRef.current(scan.code);
      } catch {
        if (!cancelled) setDegraded(true);
      } finally {
        pollInFlight = false;
      }
    }

    void poll();
    const timer = window.setInterval(() => void poll(), SCANNER_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [mode, enabled]);

  return {
    degraded,
    wedgeInputProps: {
      ref: wedgeRef,
      value: wedgeValue,
      disabled: !wedgeActive,
      onChange: handleWedgeChange,
      onKeyDown: handleWedgeKeyDown,
      onBlur: handleWedgeBlur,
    },
  };
}
