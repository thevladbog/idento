# Equipment pairing-QR UX follow-ups (CodeRabbit PR #109)

Date: 2026-07-23
Status: approved

Two deferred, real-but-scoped CodeRabbit findings from PR #109 (printer
pairing QR export, merged as `fc487dd`). Both are panel-only UX polish in the
Equipment hub; the backend is unchanged. Shipped as one small standalone PR
off `main`.

## Finding 1 — per-device "Download pairing QR" hidden during an agent outage

`DeviceCard.tsx` renders the whole row-actions block (Retry, Test print, Test
scan, and the `⋯` `DropdownMenu` holding Rename / Edit address / Download
pairing QR / Set-default / Delete) inside the card's `{!agentDown ? (…)}`
degraded-state branch. So when the agent is unreachable the entire menu
disappears — including "Download pairing QR", which is generated server-side
from the tenant-scoped stored printer config and needs **no** live agent.

### Fix

Keep the agent-dependent inline buttons (Retry / Test print / Test scan)
inside the existing `{!agentDown …}` block, unchanged. Render the `⋯` menu in
**both** states, gating per item:

- Trigger shows when `!agentDown || (onDownloadPairingQr && kind === "network")`
  — so it never renders an empty menu.
- Rename / Edit address / Set-default / Delete each gated on `!agentDown`
  (they stay unreachable in the degraded state — the intentional "unreachable"
  behavior for agent-dependent actions).
- "Download pairing QR" (network-only) is **not** agent-gated, so it survives
  an outage.

Net effect in agent-down: a `kind: "system"` printer row still shows no menu
(the board-5d test asserts no buttons on the system `dev-printer-live` row —
stays green); a `kind: "network"` row shows a `⋯` with only "Download pairing
QR". The card keeps its `opacity-55` degraded look; the Radix menu popover
portals out of the dimmed subtree.

The hub-level "Export printers (CSV)" button is already always-enabled, so
tenant-wide data stays reachable offline regardless — this is the per-device
shortcut.

## Finding 2 — download errors are swallowed

`EquipmentPage.tsx` calls both `downloadPrinterPairingCsv()` and
`downloadPrinterPairingQr(...)` with `void`. The `pairingExport.ts` helpers
reject with `ApiError` (or an "empty response" `Error`) on a non-2xx / empty
body, but `void` discards the rejection and the operator sees nothing. The
panel has no toast utility.

### Fix (reuse the existing banner convention)

Reuse the in-page dismissible-banner pattern already used three times in this
same file (`comRemoveWarning`, `defaultMirrorWarning`, `addressMirrorWarning`)
rather than adding a toast primitive — minimal surface, house convention,
YAGNI on a new cross-cutting primitive.

- New `downloadError` boolean state.
- A banner styled **destructive** (`border-destructive bg-destructive/5`,
  `text-destructive`, `role="alert"`) — red, not the amber "warn, don't fail"
  used by the mirror banners, because a download failure means the operator
  genuinely got no file. `role="alert"` (assertive) fits a true error surfaced
  in response to an action.
- Both call sites become
  `setDownloadError(false); download…().catch(() => setDownloadError(true))` —
  clears any stale error at the start of a fresh attempt, sets it on failure.
  Matches the `.catch`-terminated style of `mirrorDefaultToAgent`.
- Close button dismisses (same as the three sibling banners).
- New i18n key `equipmentDownloadError` in **both** `en.json` and `ru.json`
  (keyParity.test.ts).

## Testing

- `EquipmentPage.test.tsx`:
  1. Agent-down + a network printer → the `⋯` menu's "Download pairing QR" is
     reachable and clicking it calls `downloadPrinterPairingQr`, while
     agent-dependent items (Edit address / Delete / Set-default) are absent.
  2. A rejected download (`mockRejectedValueOnce`) → the
     `equipment-download-error` banner appears with the copy; Close dismisses
     it.
- Harness fix: the `vi.mock("./pairingExport")` stubs return `undefined`;
  since the new code calls `.catch()` on the result, change them to
  `vi.fn().mockResolvedValue(undefined)` so the existing click-tests keep
  passing.

## Gates

- Panel typecheck: `npm run typecheck` (not bare `tsc`).
- No backend / openapi changes → no `generate:api` drift step.
- Direct push to `origin/main` blocked → PR from
  `panel/equipment-pairing-qr-ux`.
