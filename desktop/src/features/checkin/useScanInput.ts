// Three scan-input modes unified behind one hook:
// wedge: a USB/keyboard-wedge scanner "types" into whatever has focus, then
//   sends Enter -- own a hidden always-focused text input, Enter is the scan
//   boundary.
// scanner: a handheld scanner the AGENT talks to over serial/USB -- poll its
//   atomic scan-consume buffer.
// manual: no auto-input at all; the caller's own search box is the only path.
import { useEffect, useRef, useState } from "react";
import { consumeLastScan } from "../../lib/agent";

export type ScanInputMode = "wedge" | "scanner" | "manual";

export interface UseScanInputOptions {
  mode: ScanInputMode;
  onCode(code: string): void;
  // Gates both wedge capture and scanner polling -- callers pass false
  // while a previous scan is still resolving so a double-fire can't race an
  // in-flight check-in.
  enabled: boolean;
}

export interface WedgeInputProps {
  ref: React.RefObject<HTMLInputElement | null>;
  value: string;
  disabled: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
}

export interface UseScanInputResult {
  // True only in scanner mode, only once consumeLastScan() itself has
  // failed -- hints the caller toward a manual-search fallback.
  degraded: boolean;
  wedgeInputProps: WedgeInputProps;
}

const SCANNER_POLL_INTERVAL_MS = 200;
const WEDGE_REFOCUS_DELAY_MS = 50;

function isDeliberateFocusTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return el.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]') !== null;
}

export function useScanInput({ mode, onCode, enabled }: UseScanInputOptions): UseScanInputResult {
  const [degraded, setDegraded] = useState(false);
  const [wedgeValue, setWedgeValue] = useState("");
  const wedgeRef = useRef<HTMLInputElement>(null);

  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  const wedgeActive = mode === "wedge" && enabled;
  const wedgeActiveRef = useRef(wedgeActive);
  wedgeActiveRef.current = wedgeActive;

  useEffect(() => {
    if (!wedgeActive) return;
    wedgeRef.current?.focus();
  }, [wedgeActive]);

  const refocusTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(refocusTimerRef.current), []);

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
    wedgeRef.current?.focus();
    if (code) onCodeRef.current(code);
  }

  useEffect(() => {
    if (mode !== "scanner" || !enabled) {
      setDegraded(false);
      return;
    }

    let cancelled = false;
    let pollInFlight = false;

    async function poll() {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const scan = await consumeLastScan();
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
