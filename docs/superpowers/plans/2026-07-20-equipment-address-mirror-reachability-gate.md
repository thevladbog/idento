# Equipment "Edit address…" reachability gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the equipment hub's "Edit address…" dialog Save button on the agent being confirmed reachable, so a network printer's ip/port PATCH can never succeed without the agent-side remove→add mirror also being attempted — closing the silent-skip gap Codex flagged in PR #85's review (spec: `docs/superpowers/specs/2026-07-20-equipment-address-mirror-reachability-gate-design.md`).

**Architecture:** `EditAddressDialog` (in `panel/src/features/equipment/EquipmentPage.tsx`) gains a new required `agentReachable: boolean` prop, fed from the page's already-computed `agentReachable` const (no new state, no new query). The dialog's existing `valid` (dirty + port-range check) becomes an input to a new `canSave = valid && agentReachable`, and a visible inline caption explains the block specifically when `!agentReachable` is the active reason.

**Tech Stack:** React 19, TanStack Query, `@idento/ui`, `react-i18next`, Vitest + Testing Library + MSW (existing stack, no new dependencies).

## Global Constraints

- Every user-facing string is an i18n key added to **both** `panel/src/shared/i18n/en.json` and `ru.json` in the same change (panel/AGENTS.md) — `keyParity.test.ts` fails the suite otherwise.
- Panel typecheck **must** use `npm run typecheck` (`tsc -b`), never bare `tsc --noEmit` (which silently checks zero files against this repo's solution-style `tsconfig.json`).
- TDD: write the failing test first, watch it fail for the stated reason, then implement.
- This task modifies **only** `panel/src/features/equipment/EquipmentPage.tsx`, `panel/src/features/equipment/EquipmentPage.test.tsx`, `panel/src/shared/i18n/en.json`, `panel/src/shared/i18n/ru.json`. No other file changes.

---

### Task 1: Gate Save on `agentReachable`, with a visible reason

**Files:**
- Modify: `panel/src/features/equipment/EquipmentPage.tsx:141-234` (`EditAddressDialogProps` interface + `EditAddressDialog` component)
- Modify: `panel/src/features/equipment/EquipmentPage.tsx:566-587` (the `<EditAddressDialog ... />` call site)
- Modify: `panel/src/features/equipment/EquipmentPage.test.tsx:1174-1198` (rewrite the existing "checking" test)
- Modify: `panel/src/shared/i18n/en.json` (add one key after `equipmentEditAddressConsequence`, line 679)
- Modify: `panel/src/shared/i18n/ru.json` (add the same key after `equipmentEditAddressConsequence`, line 681)

**Interfaces:**
- Consumes: `EquipmentPage`'s existing `const agentReachable = agentInfo.state === "connected" || agentInfo.state === "connected_legacy";` (line 359) — already computed, do not change its definition.
- Produces: `EditAddressDialogProps.agentReachable: boolean` — no other task/file depends on this; it's consumed only inside this same component.

- [ ] **Step 1: Add the new i18n key to both locale files**

In `panel/src/shared/i18n/en.json`, immediately after the `equipmentEditAddressConsequence` line (679):

```json
  "equipmentEditAddressAgentUnreachable": "Save is unavailable until the agent connection is confirmed.",
```

In `panel/src/shared/i18n/ru.json`, immediately after the `equipmentEditAddressConsequence` line (681):

```json
  "equipmentEditAddressAgentUnreachable": "Сохранение недоступно, пока не подтверждено соединение с агентом.",
```

- [ ] **Step 2: Rewrite the failing test first**

Replace the entire existing test in `panel/src/features/equipment/EquipmentPage.test.tsx` (lines 1174-1198):

```ts
    it("agent not yet known-reachable (checking): Save stays disabled with an inline reason -- no PATCH, no agent calls", async () => {
      localStorage.setItem("idento.agent-info.http://agent.test", JSON.stringify(AGENT_INFO));
      server.use(
        http.get("http://agent.test/health", async () => {
          await delay("infinite");
          return new HttpResponse(null, { status: 200 });
        }),
      );
      const user = userEvent.setup();
      renderPage();

      const row = await screen.findByTestId("equipment-device-row-dev-printer-notseen");
      await user.click(within(row).getByRole("button", { name: /More actions/ }));
      await user.click(await screen.findByRole("menuitem", { name: "Edit address…" }));
      const dialog = await screen.findByRole("dialog", { name: "Edit address" });
      const ipInput = within(dialog).getByLabelText("IP address");
      await user.clear(ipInput);
      await user.type(ipInput, "10.0.0.77");

      const save = within(dialog).getByRole("button", { name: "Save" });
      expect(save).toBeDisabled();
      expect(
        within(dialog).getByText("Save is unavailable until the agent connection is confirmed."),
      ).toBeInTheDocument();

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(patchCalls).toHaveLength(0);
      expect(agentPrinterMirrorCalls).toEqual([]);
    });
```

This replaces the OLD test's expectations (`patchCalls` reaching length 1, no agent calls, no warning) with the NEW behavior: Save itself is disabled while `"checking"`, so the PATCH never fires at all in this state.

- [ ] **Step 3: Run the test to verify it fails for the right reason**

Run: `cd panel && npx vitest run src/features/equipment/EquipmentPage.test.tsx -t "Save stays disabled with an inline reason"`

Expected: FAIL. The Save button is not yet disabled in this state (current code only checks `pending || !valid`, and `valid` is true here since the ip was genuinely changed and the port is unchanged/valid) — the assertion `expect(save).toBeDisabled()` fails, and/or the caption text is never found because the i18n key isn't wired into the dialog yet.

- [ ] **Step 4: Add `agentReachable` to `EditAddressDialogProps` and gate Save**

In `panel/src/features/equipment/EquipmentPage.tsx`, update the interface (currently lines 141-146):

```ts
interface EditAddressDialogProps {
  device: EquipmentDevice | null;
  onOpenChange: (open: boolean) => void;
  onSave: (ip: string, port: number) => void;
  pending: boolean;
  // Codex PR #85 review: Save must not be clickable unless the agent is
  // confirmed reachable -- otherwise a successful registry PATCH could
  // silently skip its own remove-then-add agent mirror with no visible
  // sign anything didn't sync (see this file's own mirrorAddressToAgent).
  // Unlike mirrorDefaultToAgent (which lets its PATCH proceed regardless
  // and only skips/warns on the mirror), address has no runtime fallback
  // at print time -- gating the write itself is the only way to guarantee
  // the mirror is attempted whenever the PATCH succeeds.
  agentReachable: boolean;
}
```

Update the function signature (currently line 155):

```ts
function EditAddressDialog({ device, onOpenChange, onSave, pending, agentReachable }: EditAddressDialogProps) {
```

Update the `valid` computation (currently lines 184-188) to add `canSave`:

```ts
  const trimmedIp = ip.trim();
  const portNumber = Number(port);
  const portValid = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;
  const dirty = trimmedIp !== originalIp.trim() || portNumber !== Number(originalPort);
  const valid = trimmedIp.length > 0 && portValid && dirty;
  const canSave = valid && agentReachable;
```

Add the inline caption directly above `<DialogFooter>` (currently line 223), and update Save's `disabled` prop (currently line 227):

```tsx
        {!agentReachable ? (
          <p className="text-body text-warning">{t("equipmentEditAddressAgentUnreachable")}</p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            {t("createEventCancel")}
          </Button>
          <Button type="button" disabled={pending || !canSave} onClick={() => onSave(trimmedIp, portNumber)}>
            {t("settingsSave")}
          </Button>
        </DialogFooter>
```

Note: the caption is shown whenever `!agentReachable`, regardless of `valid` — it's the reason Save is blocked "on top of" whatever the operator typed, matching the spec's "visible whenever it's the active reason" rule. It does not need to check `dirty`/`portValid` itself.

- [ ] **Step 5: Wire the prop at the call site**

In `panel/src/features/equipment/EquipmentPage.tsx`, at the `<EditAddressDialog ... />` call site (currently starting at line 566), add the new prop:

```tsx
      <EditAddressDialog
        device={dialog?.kind === "edit-address" ? dialog.device : null}
        pending={patchDevice.isPending}
        agentReachable={agentReachable}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        onSave={(ip, port) => {
```

(Only the new `agentReachable={agentReachable}` line is added; every other prop and the `onSave` body below it are unchanged.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd panel && npx vitest run src/features/equipment/EquipmentPage.test.tsx -t "Save stays disabled with an inline reason"`

Expected: PASS.

- [ ] **Step 7: Run the full equipment suite and the i18n key-parity test**

Run: `cd panel && npx vitest run src/features/equipment/ src/shared/i18n/keyParity.test.ts`

Expected: all tests pass, including the existing happy-path test (`"opens prefilled with the saved ip/port, ... mirrors remove-then-add onto the agent"`), which exercises Save while the agent is fully `"connected"` (`agentReachable` true throughout the standard `beforeEach`) and must continue to pass unchanged.

- [ ] **Step 8: Typecheck and lint**

Run: `cd panel && npm run typecheck && npx eslint src/features/equipment/EquipmentPage.tsx src/features/equipment/EquipmentPage.test.tsx`

Expected: both clean, no errors.

- [ ] **Step 9: Run the full panel test suite**

Run: `cd panel && npm run test`

Expected: all tests pass. (If an unrelated test fails, re-run it in isolation — this repo has a known, pre-existing `msw delay + waitFor` timing-flake class in a few unrelated files; do not treat an isolated-passing rerun as a regression from this change.)

- [ ] **Step 10: Commit**

```bash
git add panel/src/features/equipment/EquipmentPage.tsx panel/src/features/equipment/EquipmentPage.test.tsx panel/src/shared/i18n/en.json panel/src/shared/i18n/ru.json
git commit -m "panel: gate equipment Edit-address Save on agent reachability

Closes the Codex-flagged gap from PR #85's review: mirrorAddressToAgent
silently skipped the remove-then-add mirror whenever the agent wasn't yet
confirmed reachable, with no visible sign the address didn't actually sync
to the physical agent. Save now requires agentReachable alongside the
existing dirty/port validation, with an inline caption explaining the
block -- so a successful registry PATCH now always means the mirror was
at least attempted.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** The spec's single design change (thread `agentReachable` into `EditAddressDialog`, `canSave = valid && agentReachable`, inline caption, rewritten "checking" test) is fully covered by Task 1's steps. The spec's "Out of scope" items (no change to `mirrorDefaultToAgent`, no new agent capability, no "Retry mirror" UI) are respected — no task touches any of them.

**Placeholder scan:** No TBD/TODO; every step shows the exact code to write.

**Type consistency:** `EditAddressDialogProps.agentReachable: boolean` (Step 4) matches the value passed at the call site (Step 5, `agentReachable={agentReachable}`, itself `boolean` per its existing definition at `EquipmentPage.tsx:359`). No naming drift.
