# Equipment hub: gate "Edit address…" Save on agent reachability

**Date:** 2026-07-20
**Status:** Approved
**Scope:** `panel/src/features/equipment/EquipmentPage.tsx` (`EditAddressDialog` only)

## Background

PR #85 added a row-menu "Edit address…" action to the equipment hub for saved
network printers: it PATCHes the registry (source of truth) with the new
ip/port, then best-effort mirrors the change onto the local print agent via
`agentClient.removeNetworkPrinter` + `addNetworkPrinter` (remove-then-add,
since the agent's own `POST /printers/add` only appends to its persisted
config for genuinely new names — a bare re-add under an unchanged name would
silently revert to the stale address on the agent's next restart).

Codex's PR review flagged that `mirrorAddressToAgent` silently skips the
mirror attempt whenever the agent isn't yet confirmed reachable
(`agentReachable` false — connectivity state `"checking"`). Triage confirmed
this is real but narrow:

- It matches an already-accepted precedent: `mirrorDefaultToAgent` (Make
  default) has the identical skip-silently-when-not-reachable guard, merged
  in PR #83.
- The window is bounded: `DeviceCard.tsx` hides the entire row menu once the
  agent is confirmed `"disconnected"`, so the only state where the menu is
  visible AND the mirror can be skipped is `"checking"` — capped at
  `checkHealth`'s hardcoded 2000ms timeout (`agentClient.ts`).
- Unlike a stale mirrored *default* (which has a server > agent > first
  fallback at print time — `useAgentPrinters.ts`), a stale mirrored
  *address* has no runtime fallback: the agent's `PrinterManager` holds
  whatever ip/port it was last told, and prints go there indefinitely.

This asymmetry — no fallback exists for address, unlike default — is why
this gap is worth closing specifically for this action, even though the
identical-shaped code in `mirrorDefaultToAgent` is left alone.

## Decision

Of three options considered (see PR #85 review thread and this session's
brainstorming), the user picked **gating Save on `agentReachable`**, over:

- **Warn-on-skip + Retry button** — smaller diff, but leaves a real window
  where an operator must notice a warning and act on it (and needs a new
  "Retry mirror" affordance, since PR #85's own dirty-check disables Save on
  unchanged values — a plain re-save can't be used to retry).
- **Agent-side address readback + reconcile** — most architecturally
  complete, but needs a new agent endpoint, `agent/openapi.yaml` changes,
  and a fleet-wide agent upgrade before it helps anyone; even then it only
  self-heals opportunistically (whenever the hub happens to be open while
  both sides are live). Disproportionate for a sub-2-second race.

## Design

`EditAddressDialog` gains a new required prop:

```ts
interface EditAddressDialogProps {
  // ...existing fields...
  agentReachable: boolean;
}
```

`EquipmentPage.tsx` passes its already-computed `agentReachable` const
through to the dialog (no new state, no new query).

Inside the dialog, the existing `valid` (dirty + port-range check) becomes
`canSave = valid && agentReachable`, and the Save button's `disabled` prop
switches from `pending || !valid` to `pending || !canSave`.

When Save is disabled *specifically* because `!agentReachable` (regardless
of what the operator typed), a visible inline caption explains why — this
codebase's established convention for any non-obvious disabled affordance
(`AgentCard`'s legacy-agent hint, `DeviceCard`'s `wizard-todo` pattern: never
a silently-disabled control with no explanation). Copy: "Save is unavailable
until the agent connection is confirmed." (en) / "Сохранение недоступно,
пока не подтверждено соединение с агентом." (ru), new i18n key
`equipmentEditAddressAgentUnreachable`, added to both `en.json`/`ru.json`.
Rendered directly above `DialogFooter`, conditional on `!agentReachable`
(no testid needed — queried by text in tests, matching the existing
consequence caption's own convention).

**Scope decision made explicit**: this is the first mirror in the equipment
feature where the *registry write itself* is gated on agent reachability —
every other mirror (Make default, this feature's own remove→add) lets the
PATCH proceed unconditionally and only skips/warns on the mirror step. This
divergence is deliberate and specific to address having no runtime
fallback; it does not change `mirrorDefaultToAgent` or any other mirror.

## Testing

The existing test `"agent not yet known-reachable (checking): PATCHes the
registry but skips the mirror -- no agent calls, no warning"` in
`EquipmentPage.test.tsx` is rewritten: under the new behavior the PATCH no
longer fires in that state at all (Save is disabled), so the rewritten test
asserts:

- Save is disabled once a real (differs-from-saved) edit is made while the
  agent is `"checking"` (same held-open `/health` pattern the test already
  uses).
- The inline "Save is unavailable…" caption is visible.
- Zero PATCH calls and zero agent mirror calls occur even after attempting
  to click Save.

No new test is needed for the enabled/connected case — the existing happy
path test (`"opens prefilled with the saved ip/port, ... mirrors
remove-then-add onto the agent"`) already exercises Save while the agent is
fully connected and continues to pass unchanged.

TDD: the rewritten test is written and watched fail first (the current code
has no `agentReachable` gate, so Save would incorrectly enable and PATCH
would fire), then the minimal implementation change lands to make it pass.

## Out of scope

- No change to `mirrorDefaultToAgent` or any other existing mirror.
- No new agent capability or `agent/openapi.yaml` change (Option C, filed
  separately if ever revisited).
- No new "Retry mirror" UI (only relevant to Option A, not pursued).
