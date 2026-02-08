## Context

The agent currently opens every detected serial port at startup for both scanners and serial printers, which blocks unrelated devices and creates noisy failures. The web UI expects scanner lists and COM port lists as string arrays and does not support a keyboard-wedge scanner mode explicitly. We need a safe allow-list model for scanners, metadata-rich port listing for selection, and UI options that align with the actual hardware model (network + system printers, COM scanners, keyboard scanners).

## Goals / Non-Goals

**Goals:**
- List available serial ports with metadata without opening them.
- Persist a scanner allow-list and only open those ports at startup or on add.
- Remove serial/COM printer auto-discovery and auto-open; keep system and network printers.
- Align the web UI and agent client with metadata-rich port lists and a keyboard scanner mode.
- Preserve a reliable keyboard-wedge check-in flow by focusing input.

**Non-Goals:**
- Implement a new serial driver or change low-level scanner reading logic.
- Add OS-specific drivers or advanced device enumeration beyond what the serial library provides.
- Redesign check-in UX beyond ensuring input focus.

## Decisions

- **Persist scanner allow-list in agent config**
  - Rationale: allow deterministic behavior across restarts without locking all ports.
  - Alternatives: in-memory only (lost on restart), UI localStorage only (agent unaware), auto-detect and heuristics (risk false positives).

- **Port discovery returns metadata objects, not just strings**
  - Rationale: provide meaningful options in the UI and reduce user error when choosing ports.
  - Alternatives: keep string list and infer labels on UI (limited context, OS differences).

- **Agent opens scanner ports only when allow-listed**
  - Rationale: prevents global COM lock while still enabling always-on scanning for configured devices.
  - Alternatives: open-on-demand per scan (not viable for async scanner input), time-sliced polling (complex, unreliable).

- **Remove serial printer discovery/opening**
  - Rationale: printers are system or network only; serial discovery is unnecessary and causes port contention.
  - Alternatives: keep serial discovery but disable open (adds complexity with no product need).

- **Keyboard scanner as explicit UI mode**
  - Rationale: keyboard-wedge scanners do not use COM and require different UX guidance.
  - Alternatives: reusing USB mode with no agent calls (confusing for operators).

## Risks / Trade-offs

- **[Risk] Port metadata not available on some OSes** → **Mitigation:** fields are optional; UI falls back to `port_name`.
- **[Risk] Allow-listed port becomes unavailable or busy** → **Mitigation:** log and skip at startup; UI shows port as unavailable when re-listing.
- **[Risk] Users forget to remove old allow-listed ports** → **Mitigation:** add remove endpoint and UI action; optional warning when open fails.

## Migration Plan

- Update agent config schema to include `scanner_ports` while keeping backward compatibility for existing config.
- Update agent endpoints and OpenAPI to new scanner semantics.
- Update web agent client types and Equipment Settings UI to consume port metadata and add keyboard scanner mode.
- Rollout can be backward-compatible if `/scanners/ports` temporarily supports both strings and objects in the UI adapter; remove legacy once agent is updated.

## Open Questions

- Which port metadata fields can we reliably surface across Windows/macOS/Linux with the current serial library?
- Do we need a UI action to clear all allow-listed scanners at once?
