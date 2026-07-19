import * as React from "react";

// P4.3 Task 9 -- browser-side keystroke capture for the scanner wizard's
// (board 5c) "Listening… scan any barcode now" panel. Window-level (not
// bound to any one focused element) so it works while the dialog is open
// regardless of what currently has focus inside it, and scoped entirely to
// this hook's own `active` flag -- the wizard flips that off once it's done
// listening (dialog closed, or the operator switched to the COM path),
// which detaches the listener outright rather than leaving it running idle.
//
// This is a DIFFERENT capture technique from checkin/useScanInput.ts's own
// "wedge" mode, deliberately -- read that file first (task-9-brief.md's own
// instruction). useScanInput owns a hidden, always-focused <input> and
// treats a plain Enter keydown as the scan boundary; a check-in station
// already KNOWS (from the event's CheckinSettings.scan_input) that it's
// looking at a wedge scanner, so it never needs to tell one apart from a
// human typing. It has NO per-key timing constant to reuse here -- confirmed
// by reading it; WEDGE_REFOCUS_DELAY_MS in that file is an unrelated
// focus-return delay, not a keystroke-gap measurement.
//
// This hook is for the opposite situation: a setup wizard that does NOT yet
// know whether it's looking at a real keyboard-wedge scanner or a human at
// the keyboard, with no single input of its own to own exclusively. So it
// measures something useScanInput.ts never needed to -- the GAP between
// consecutive keydowns. A barcode scanner "typing" a code emits characters
// at a near-constant, very fast cadence (low-tens of milliseconds or
// faster); no human sustains anything close to that. A burst whose
// inter-key gaps exceed WEDGE_MAX_INTER_KEY_MS is therefore rejected as
// human typing and never becomes a detection.

export interface WedgeDetection {
  code: string;
  terminator: "enter" | "tab" | "none";
  millis: number;
}

export interface UseWedgeListenResult {
  detection: WedgeDetection | null;
  reset(): void;
}

// Comfortably exceeds a real keyboard-wedge scanner's per-character
// interval (typically single digits to ~20ms) while safely rejecting human
// typing speed (rarely faster than ~150ms/char even for a fast typist) --
// matches task-9-brief.md's own test-matrix figure ("typing slower than
// the wedge threshold (>80ms/char) never yields a detection").
const WEDGE_MAX_INTER_KEY_MS = 80;

// A real barcode payload is always several characters -- this floor keeps a
// single stray keydown (e.g. a Tab that lands here while focus is
// genuinely just moving between two ordinary controls) from ever reading
// as a one-character "scan".
const MIN_CHARS = 3;

// A wedge scanner with no configured terminator character still stops
// "typing" and goes quiet once its payload is sent -- this is how a burst
// with no Enter/Tab suffix resolves to terminator "none".
const SILENCE_MS = 300;

interface Burst {
  chars: string[];
  timestamps: number[];
}

// Task 9 review round 2, Important: once the wizard's Device-name/Terminator
// fields became editable WHILE listening (the round-1 Important-1
// restructure), a fast human typist bursting 3+ chars at wedge speed into
// the name input could fabricate a detection off this window-level
// listener. Keydowns targeted at an editable element are therefore ignored
// for detection purposes (and clear the accumulator -- see the guard in
// handleKeyDown). Same editable-element classification as
// checkin/useScanInput.ts's isDeliberateFocusTarget, minus its
// dialog/menu containers (a keydown inside THIS dialog is exactly what we
// listen for; only text-entry surfaces are excluded).
//
// ACCEPTED LIMITATION (controller decision): a physical scan fired while a
// text field is focused will NOT detect -- a wedge scanner "types" into
// whatever has focus, so its characters land in the focused field natively
// (that is wedge-hardware physics any application has, not something this
// guard introduces), and the operator sees the garbage land in the field.
// The flow re-arms itself: clearing the field / clicking "Scan again"
// moves focus to a non-editable element (a button), where detection works.
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (target as HTMLElement).isContentEditable;
}

/**
 * Window-scoped keystroke capture for detecting a keyboard-wedge scan while
 * `active`. Once a detection lands it is STICKY -- further keydowns are
 * ignored (never silently overwritten) until the caller calls `reset()`
 * (the wizard's "Scan again" affordance).
 */
export function useWedgeListen(active: boolean): UseWedgeListenResult {
  const [detection, setDetection] = React.useState<WedgeDetection | null>(null);
  const burstRef = React.useRef<Burst | null>(null);
  const silenceTimerRef = React.useRef<number | undefined>(undefined);
  // Mirrors detection state without forcing every keydown handler
  // invocation to close over a stale `detection` from the render that
  // registered the listener -- the effect below only re-subscribes on
  // `active` changes, not on every detection.
  const detectionRef = React.useRef<WedgeDetection | null>(null);

  const clearSilenceTimer = React.useCallback(() => {
    if (silenceTimerRef.current !== undefined) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = undefined;
    }
  }, []);

  const reset = React.useCallback(() => {
    burstRef.current = null;
    detectionRef.current = null;
    clearSilenceTimer();
    setDetection(null);
  }, [clearSilenceTimer]);

  React.useEffect(() => {
    if (!active) return;

    function finalize(terminator: WedgeDetection["terminator"]) {
      const burst = burstRef.current;
      if (!burst || burst.chars.length < MIN_CHARS) {
        burstRef.current = null;
        return;
      }
      clearSilenceTimer();
      const millis = Math.max(0, burst.timestamps[burst.timestamps.length - 1] - burst.timestamps[0]);
      const next: WedgeDetection = { code: burst.chars.join(""), terminator, millis };
      burstRef.current = null;
      detectionRef.current = next;
      setDetection(next);
    }

    function handleKeyDown(event: KeyboardEvent) {
      // Frozen until reset() -- see this hook's own doc comment.
      if (detectionRef.current) return;
      // Round-2 Important guard (see isEditableTarget's comment): typing
      // into an input/textarea/select/contenteditable never feeds
      // detection, AND abandons any burst in progress -- a detection must
      // never be assembled from a mix of field-typing and stray
      // keystrokes.
      if (isEditableTarget(event.target)) {
        burstRef.current = null;
        clearSilenceTimer();
        return;
      }
      // A real wedge scan never involves a modifier combo; a human
      // shortcut (Cmd+R, Ctrl+Tab, …) must never feed the buffer.
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      if (event.key === "Enter" || event.key === "Tab") {
        const burst = burstRef.current;
        if (burst && burst.chars.length >= MIN_CHARS) {
          // Only swallow the keystroke when it actually closed a
          // detection -- an ordinary Tab/Enter mid-dialog (moving focus,
          // submitting nothing) must keep working normally.
          event.preventDefault();
          finalize(event.key === "Enter" ? "enter" : "tab");
        } else {
          // Too short to be a real scan payload -- abandon the false
          // start rather than let a stray Enter/Tab retroactively
          // "close" an unrelated future burst.
          burstRef.current = null;
          clearSilenceTimer();
        }
        return;
      }

      // Anything else that isn't a single printable character (Shift,
      // ArrowLeft, F5, …) carries no payload content and is ignored.
      if (event.key.length !== 1) return;

      const now = Date.now();
      const burst = burstRef.current;
      if (burst) {
        const gap = now - burst.timestamps[burst.timestamps.length - 1];
        if (gap > WEDGE_MAX_INTER_KEY_MS) {
          // Slower than wedge speed -- this isn't the same burst. Abandon
          // it and start fresh from THIS keystroke; a genuine scan may
          // still follow.
          burstRef.current = { chars: [event.key], timestamps: [now] };
        } else {
          burst.chars.push(event.key);
          burst.timestamps.push(now);
        }
      } else {
        burstRef.current = { chars: [event.key], timestamps: [now] };
      }

      clearSilenceTimer();
      silenceTimerRef.current = window.setTimeout(() => finalize("none"), SILENCE_MS);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearSilenceTimer();
      // A burst mid-flight when listening stops (dialog closed, or the
      // wizard left this kind) must not survive into a LATER active
      // session on now-stale timestamps.
      burstRef.current = null;
    };
  }, [active, clearSilenceTimer]);

  return { detection, reset };
}
