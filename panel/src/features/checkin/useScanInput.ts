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
// agent's last-scan buffer instead (agentClient.getLastScan/clearLastScan,
// confirmed against agent/openapi.yaml's real /scan/last + /scan/clear
// contract -- not an invented endpoint).
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
}

export interface UseScanInputResult {
  // True only in scanner mode, only once agentClient.getLastScan() itself
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
// agentClient.getLastScan()").
const SCANNER_POLL_INTERVAL_MS = 200;

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

  // Autofocus on mount/whenever the wedge input becomes active -- a
  // keyboard-wedge scanner only "types" into whatever element currently has
  // focus, so this input must be focused before the operator can scan at
  // all (and again if `enabled` flips back to true after a scan resolves).
  React.useEffect(() => {
    if (!wedgeActive) return;
    wedgeRef.current?.focus();
  }, [wedgeActive]);

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

  // Scanner-mode polling. A ref (not state) tracks the last {code, time}
  // pair this hook has already acted on -- the dedup key the brief
  // specifies ("dedup by {code, time} last-handled ... never double-
  // consume"), since the agent's buffer can legitimately keep returning the
  // SAME pair across several poll ticks (e.g. between this hook's own
  // clearLastScan() request landing and the agent actually processing it,
  // or simply because nothing new has been scanned since).
  const lastHandledRef = React.useRef<{ code: string; time: string } | null>(null);

  React.useEffect(() => {
    if (mode !== "scanner" || !enabled) {
      setDegraded(false);
      return;
    }

    let cancelled = false;

    async function poll() {
      try {
        const scan = await agentClient.getLastScan();
        if (cancelled) return;
        setDegraded(false);

        if (!scan.code) return; // steady state: nothing new since the last clear.

        const last = lastHandledRef.current;
        if (last && last.code === scan.code && last.time === scan.time) return; // already consumed.

        lastHandledRef.current = { code: scan.code, time: scan.time };
        onCodeRef.current(scan.code);
        await agentClient.clearLastScan();
      } catch {
        if (!cancelled) setDegraded(true);
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
    },
  };
}
