# @idento/ui Select Primitive + Panel Retrofit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared `Select` primitive to `@idento/ui` and retrofit every raw `<select>` in `panel/` onto it, closing the CodeRabbit finding from PR #77 (`panel/AGENTS.md`'s "UI primitives come only from `@idento/ui`" rule) without changing any select's values, options, or event-handling behavior.

**Architecture:** `Select` wraps a native `<select>` element (same pattern as `packages/ui/src/components/input.tsx` wraps `<input>`), not a Radix-style custom listbox. This is a deliberate choice, not a shortcut: every existing call site already relies on native keyboard navigation, the OS's own mobile picker, and plain `<option>`/`<optgroup>` children, and every existing test (`AttendeeDrawer.test.tsx`, `AttendeesPage.test.tsx`, `BulkBar.test.tsx`, `ImportWizard.test.tsx`, `LaunchCeremony.test.tsx`, `RecentScansRail.test.tsx`, `TestPrintDialog.test.tsx`, `BadgeEditorPage.test.tsx`, `PropertiesPane.test.tsx`) already asserts against `getByRole("combobox")` / `userEvent.selectOptions`. A custom listbox would change the DOM role structure and break all of them; a native-`<select>` wrapper preserves 100% of existing behavior and every existing test keeps passing untouched. Styling is exposed via three `cva` variants (`default`, `pill`, `compact`) that reproduce the three distinct hand-rolled classNames already in use across the codebase byte-for-byte (plus additive `focus-visible` ring / `disabled` styling, which is a pure accessibility improvement with no visual effect on any site that was never actually disabled or focused in a way that would show it).

**Tech Stack:** React 19 (panel) / React 18-compatible (`packages/ui` peer dep), `class-variance-authority` (already a `packages/ui` dependency), `tailwind-merge` via the existing `cn()` helper, Vitest + Testing Library.

## Global Constraints

- `packages/ui/AGENTS.md`: no hex/rgb literals anywhere outside `theme.css` (`no-hardcoded-colors.test.ts` enforces this) — use only token-backed Tailwind classes.
- `packages/ui/AGENTS.md`: React peer dep is `>=18` — no React-19-only APIs in `packages/ui` source.
- `packages/ui/AGENTS.md` verify gate: `npm test -w @idento/ui && npm run typecheck -w @idento/ui && npm run lint -w @idento/ui` (run from repo root) before finishing any change there.
- `panel/AGENTS.md`: UI primitives come only from `@idento/ui` — this plan exists to close the last gap.
- `panel/AGENTS.md`: theming is light/dark only via `@idento/ui` token classes — no literal colors added to any retrofitted file.
- This is a **component swap, not a behavior change**: every retrofitted `<select>` keeps its exact `value`/`onChange`/`disabled`/options/optgroups. No test file listed above should need its assertions changed — only, where applicable, no changes at all (they query by role/label, which is unaffected).

---

## File Structure

- **Create** `packages/ui/src/components/select.tsx` — the primitive (forwardRef, `cva` variants: `default`/`pill`/`compact`).
- **Create** `packages/ui/src/components/select.test.tsx` — unit tests mirroring `button.test.tsx`/`input.test.tsx` conventions.
- **Modify** `packages/ui/src/index.ts` — export `Select`, `selectVariants`, `SelectProps`.
- **Modify** `packages/ui/src/index.test.ts` — add `"Select"` and `"selectVariants"` to the exported-names table.
- **Modify** (retrofit only, no new files) the 8 panel files that render a raw `<select>`:
  `panel/src/features/badge/PropertiesPane.tsx`, `panel/src/features/badge/TestPrintDialog.tsx`,
  `panel/src/features/attendees/AttendeeDrawer.tsx`, `panel/src/features/attendees/BulkBar.tsx`,
  `panel/src/features/checkin/LaunchCeremony.tsx`, `panel/src/features/checkin/RecentScansRail.tsx`,
  `panel/src/features/attendees/AttendeesPage.tsx`, `panel/src/features/attendees/import/ImportWizard.tsx`.

Note on scope: `panel/src/features/checkin/ScanInput.tsx` and `panel/src/features/badge/BadgeEditorPage.tsx` were named in the originating brief but contain **no** raw `<select>` — grep confirms their only `<select` hits are prose comments referencing other files. No changes are needed in either file; do not touch them.

---

### Task 1: `Select` primitive in `@idento/ui`

**Files:**
- Create: `packages/ui/src/components/select.tsx`
- Create: `packages/ui/src/components/select.test.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/index.test.ts`

**Interfaces:**
- Produces: `Select` — `React.forwardRef<HTMLSelectElement, SelectProps>`, where `SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement>` plus an optional `variant?: "default" | "pill" | "compact"` (defaults to `"default"`). Renders a plain `<select ref={ref} className={...} {...props} />` — all native props (`id`, `value`, `defaultValue`, `onChange`, `disabled`, `aria-label`, children `<option>`/`<optgroup>`) pass through untouched.
- Produces: `selectVariants` — the exported `cva` function, for any future caller that wants the raw class string.
- Consumed by: Tasks 2–9 (`import { Select } from "@idento/ui"`).

- [ ] **Step 1: Write the failing test file**

Create `packages/ui/src/components/select.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Label } from "./label";
import { Select } from "./select";

describe("Select", () => {
  it("is reachable by its label", () => {
    render(
      <>
        <Label htmlFor="zone">Zone</Label>
        <Select id="zone">
          <option value="a">Alpha</option>
        </Select>
      </>,
    );
    expect(screen.getByLabelText("Zone")).toBeInTheDocument();
  });

  it("renders its options and reflects the selected value", () => {
    render(
      <Select aria-label="Zone" defaultValue="b">
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </Select>,
    );
    expect(screen.getByRole("combobox", { name: "Zone" })).toHaveValue("b");
  });

  it("fires onChange with the newly picked option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Select aria-label="Zone" onChange={onChange}>
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </Select>,
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Zone" }), "b");
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Zone" })).toHaveValue("b");
  });

  it("applies variant classes from tokens", () => {
    render(
      <Select aria-label="Status filter" variant="pill">
        <option value="a">Alpha</option>
      </Select>,
    );
    expect(screen.getByRole("combobox", { name: "Status filter" })).toHaveClass("rounded-full");
  });

  it("is disabled when disabled", () => {
    render(
      <Select aria-label="Zone" disabled>
        <option value="a">Alpha</option>
      </Select>,
    );
    expect(screen.getByRole("combobox", { name: "Zone" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from repo root): `npm test -w @idento/ui -- src/components/select.test.tsx`
Expected: FAIL — `Cannot find module './select'` (or similar resolution error), since `select.tsx` doesn't exist yet.

- [ ] **Step 3: Write the component**

Create `packages/ui/src/components/select.tsx`:

```tsx
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../lib/cn";

const selectVariants = cva(
  "border border-input bg-card text-body text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "flex h-9 w-full rounded-md px-3 py-1 shadow-sm",
        pill: "h-9 rounded-full px-3",
        compact: "h-9 w-auto rounded-md px-2",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement>,
    VariantProps<typeof selectVariants> {}

// Wraps a native <select> rather than a custom listbox: every call site this
// replaces (packages/ui/AGENTS.md's "primitives only from @idento/ui" rule,
// closing a CodeRabbit finding on PR #77) already relies on native keyboard
// nav, the OS's own mobile picker, and plain <option>/<optgroup> children --
// and every one of those call sites' tests already assert via
// getByRole("combobox")/userEvent.selectOptions. A Radix-style listbox would
// change the DOM role structure and break all of them for no behavioral gain.
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, variant, ...props }, ref) => (
    <select ref={ref} className={cn(selectVariants({ variant }), className)} {...props} />
  ),
);
Select.displayName = "Select";

export { selectVariants };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @idento/ui -- src/components/select.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Export from the package's public API**

In `packages/ui/src/index.ts`, change:

```ts
export { Input } from "./components/input";
```

to:

```ts
export { Input } from "./components/input";
export { Select, selectVariants, type SelectProps } from "./components/select";
```

- [ ] **Step 6: Add the new exports to the public-API contract test**

In `packages/ui/src/index.test.ts`, change:

```ts
    "Button", "buttonVariants", "Label", "Input",
```

to:

```ts
    "Button", "buttonVariants", "Label", "Input", "Select", "selectVariants",
```

- [ ] **Step 7: Run the full `@idento/ui` gate**

Run: `npm test -w @idento/ui && npm run typecheck -w @idento/ui && npm run lint -w @idento/ui`
Expected: all three pass.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/components/select.tsx packages/ui/src/components/select.test.tsx packages/ui/src/index.ts packages/ui/src/index.test.ts
git commit -m "feat(ui): add Select primitive (default/pill/compact variants)"
```

---

### Task 2: Retrofit `panel/src/features/badge/PropertiesPane.tsx`

**Files:**
- Modify: `panel/src/features/badge/PropertiesPane.tsx`
- Test: `panel/src/features/badge/PropertiesPane.test.tsx` (pre-existing, unmodified)

**Interfaces:**
- Consumes: `Select` from `@idento/ui` (Task 1), `variant="default"` (the default, so `variant` prop can be omitted).

This file has 3 raw `<select>`s (binding, font, rotation), all sharing the same `SELECT_CLASSNAME` constant that byte-for-byte matches `Select`'s `default` variant.

- [ ] **Step 1: Update the import**

Change:

```tsx
import { Button, Input, Label, cn } from "@idento/ui";
```

to:

```tsx
import { Button, Input, Label, Select, cn } from "@idento/ui";
```

- [ ] **Step 2: Remove the now-unneeded `SELECT_CLASSNAME` constant and its comment**

Delete these lines entirely:

```tsx
// Native <select>, styled to match `Input`'s own classes (packages/ui/src/
// components/input.tsx) -- there is no shared `@idento/ui` Select primitive
// yet (AttendeesPage.tsx's filters and ImportWizard.tsx's column mapper
// style their own native selects inline the same way), so the exact Input
// classes are duplicated here rather than reusing the Input *component*
// (which always renders an `<input>`, never a `<select>`).
const SELECT_CLASSNAME =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-body text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

```

- [ ] **Step 3: Swap the binding select**

Change:

```tsx
          <select
            id={IDS.binding}
            className={SELECT_CLASSNAME}
            value={element.source ?? ""}
            onChange={handleBindingChange}
          >
            <option value="">{t("badgeBindingStatic")}</option>
            {bindingOptions(fieldSchema).map((name) => (
              <option key={name} value={name}>
                {displayBinding(name)}
              </option>
            ))}
          </select>
```

to:

```tsx
          <Select
            id={IDS.binding}
            value={element.source ?? ""}
            onChange={handleBindingChange}
          >
            <option value="">{t("badgeBindingStatic")}</option>
            {bindingOptions(fieldSchema).map((name) => (
              <option key={name} value={name}>
                {displayBinding(name)}
              </option>
            ))}
          </Select>
```

- [ ] **Step 4: Swap the font select**

Change:

```tsx
            <select
              id={IDS.font}
              className={SELECT_CLASSNAME}
              value={fontSelectValue}
              onChange={handleFontChange}
            >
```

to:

```tsx
            <Select
              id={IDS.font}
              value={fontSelectValue}
              onChange={handleFontChange}
            >
```

and change its closing `</select>` to `</Select>` (the `<optgroup>`/`<option>` children in between are unchanged).

- [ ] **Step 5: Swap the rotation select**

Change:

```tsx
            <select
              id={IDS.rotation}
              className={SELECT_CLASSNAME}
              value={String(element.rotation ?? 0)}
              onChange={(e) => patch({ rotation: Number(e.target.value) as 0 | 90 | 180 | 270 })}
            >
              {ROTATIONS.map((deg) => (
                <option key={deg} value={deg}>
                  {deg}°
                </option>
              ))}
            </select>
```

to:

```tsx
            <Select
              id={IDS.rotation}
              value={String(element.rotation ?? 0)}
              onChange={(e) => patch({ rotation: Number(e.target.value) as 0 | 90 | 180 | 270 })}
            >
              {ROTATIONS.map((deg) => (
                <option key={deg} value={deg}>
                  {deg}°
                </option>
              ))}
            </Select>
```

- [ ] **Step 6: Run this file's test suite**

Run: `npm test -w panel -- PropertiesPane.test.tsx`
Expected: PASS, unchanged assertions.

- [ ] **Step 7: Commit**

```bash
git add panel/src/features/badge/PropertiesPane.tsx
git commit -m "refactor(panel): PropertiesPane onto @idento/ui Select"
```

---

### Task 3: Retrofit `panel/src/features/badge/TestPrintDialog.tsx`

**Files:**
- Modify: `panel/src/features/badge/TestPrintDialog.tsx`
- Test: `panel/src/features/badge/TestPrintDialog.test.tsx` (pre-existing, unmodified)

- [ ] **Step 1: Update the import**

Change:

```tsx
import {
  AgentStatus, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Label,
} from "@idento/ui";
```

to:

```tsx
import {
  AgentStatus, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Label, Select,
} from "@idento/ui";
```

- [ ] **Step 2: Remove the now-unneeded `SELECT_CLASSNAME` constant and its comment**

Delete:

```tsx
// Native <select>, styled to match PropertiesPane.tsx's own SELECT_CLASSNAME
// (duplicated per-file on purpose -- see that file's comment: there's no
// shared @idento/ui Select primitive yet).
const SELECT_CLASSNAME =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-body text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

```

- [ ] **Step 3: Swap the printer select**

Change:

```tsx
          <select
            id="test-print-printer"
            className={SELECT_CLASSNAME}
            value={selectedPrinter ?? ""}
            disabled={agent.state !== "connected" || agent.printers.length === 0 || printing}
            onChange={(event) => setSelectedPrinter(event.target.value)}
          >
            {agent.printers.length === 0 ? (
              <option value="">{t("printNoPrinters")}</option>
            ) : (
              agent.printers.map((printer) => (
                <option key={printer.name} value={printer.name}>{printer.name}</option>
              ))
            )}
          </select>
```

to:

```tsx
          <Select
            id="test-print-printer"
            value={selectedPrinter ?? ""}
            disabled={agent.state !== "connected" || agent.printers.length === 0 || printing}
            onChange={(event) => setSelectedPrinter(event.target.value)}
          >
            {agent.printers.length === 0 ? (
              <option value="">{t("printNoPrinters")}</option>
            ) : (
              agent.printers.map((printer) => (
                <option key={printer.name} value={printer.name}>{printer.name}</option>
              ))
            )}
          </Select>
```

- [ ] **Step 4: Run this file's test suite**

Run: `npm test -w panel -- TestPrintDialog.test.tsx`
Expected: PASS, unchanged assertions.

- [ ] **Step 5: Commit**

```bash
git add panel/src/features/badge/TestPrintDialog.tsx
git commit -m "refactor(panel): TestPrintDialog onto @idento/ui Select"
```

---

### Task 4: Retrofit `panel/src/features/attendees/AttendeeDrawer.tsx`

**Files:**
- Modify: `panel/src/features/attendees/AttendeeDrawer.tsx`
- Test: `panel/src/features/attendees/AttendeeDrawer.test.tsx` (pre-existing, unmodified — includes 3 tests that explicitly reference the reprint `<select>` by name; they query by role/label so no assertion changes are needed)

- [ ] **Step 1: Update the import**

Change:

```tsx
import {
  Avatar, AvatarFallback, Button, ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Label,
  Sheet, SheetContent, SheetHeader, SheetTitle, Skeleton, StatusPill,
} from "@idento/ui";
```

to:

```tsx
import {
  Avatar, AvatarFallback, Button, ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Label,
  Select, Sheet, SheetContent, SheetHeader, SheetTitle, Skeleton, StatusPill,
} from "@idento/ui";
```

- [ ] **Step 2: Remove the now-unneeded `REPRINT_SELECT_CLASSNAME` constant and its comment**

Delete:

```tsx
// Native <select>, styled to match PropertiesPane.tsx's/TestPrintDialog.tsx's
// own SELECT_CLASSNAME (duplicated per-file on purpose -- see those files'
// own comments: there's no shared @idento/ui Select primitive yet).
const REPRINT_SELECT_CLASSNAME =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-body text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

```

- [ ] **Step 3: Swap the reprint printer select**

Change:

```tsx
          <select
            id="reprint-printer"
            className={REPRINT_SELECT_CLASSNAME}
            value={reprintPrinter ?? ""}
            disabled={agent.printers.length === 0 || reprintPrinting}
            onChange={(event) => setReprintPrinter(event.target.value)}
          >
            {agent.printers.length === 0 ? (
              <option value="">{t("printNoPrinters")}</option>
            ) : (
              agent.printers.map((printer) => (
                <option key={printer.name} value={printer.name}>{printer.name}</option>
              ))
            )}
          </select>
```

to:

```tsx
          <Select
            id="reprint-printer"
            value={reprintPrinter ?? ""}
            disabled={agent.printers.length === 0 || reprintPrinting}
            onChange={(event) => setReprintPrinter(event.target.value)}
          >
            {agent.printers.length === 0 ? (
              <option value="">{t("printNoPrinters")}</option>
            ) : (
              agent.printers.map((printer) => (
                <option key={printer.name} value={printer.name}>{printer.name}</option>
              ))
            )}
          </Select>
```

- [ ] **Step 4: Run this file's test suite**

Run: `npm test -w panel -- AttendeeDrawer.test.tsx`
Expected: PASS, unchanged assertions.

- [ ] **Step 5: Commit**

```bash
git add panel/src/features/attendees/AttendeeDrawer.tsx
git commit -m "refactor(panel): AttendeeDrawer reprint select onto @idento/ui Select"
```

---

### Task 5: Retrofit `panel/src/features/attendees/BulkBar.tsx`

**Files:**
- Modify: `panel/src/features/attendees/BulkBar.tsx`
- Test: `panel/src/features/attendees/BulkBar.test.tsx` (pre-existing, unmodified)

- [ ] **Step 1: Update the import**

Change:

```tsx
import {
  Button, ConfirmDialog, Dialog, DialogContent, DialogHeader, DialogTitle, Label,
} from "@idento/ui";
```

to:

```tsx
import {
  Button, ConfirmDialog, Dialog, DialogContent, DialogHeader, DialogTitle, Label, Select,
} from "@idento/ui";
```

- [ ] **Step 2: Remove the now-unneeded `PRINT_SELECT_CLASSNAME` constant and its comment**

Delete:

```tsx
// Native <select>, styled to match TestPrintDialog.tsx's/AttendeeDrawer.tsx's
// own SELECT_CLASSNAME (duplicated per-file on purpose -- see those files'
// own comments: there's no shared @idento/ui Select primitive yet).
const PRINT_SELECT_CLASSNAME =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-body text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

```

- [ ] **Step 3: Swap the bulk print select**

Change:

```tsx
          <select
            id="bulk-print-printer"
            className={PRINT_SELECT_CLASSNAME}
            value={printerSelection ?? ""}
            disabled={agent.printers.length === 0 || printing}
            onChange={(event) => setPrinterSelection(event.target.value)}
          >
            {agent.printers.length === 0 ? (
              <option value="">{t("printNoPrinters")}</option>
            ) : (
              agent.printers.map((printer) => (
                <option key={printer.name} value={printer.name}>{printer.name}</option>
              ))
            )}
          </select>
```

to:

```tsx
          <Select
            id="bulk-print-printer"
            value={printerSelection ?? ""}
            disabled={agent.printers.length === 0 || printing}
            onChange={(event) => setPrinterSelection(event.target.value)}
          >
            {agent.printers.length === 0 ? (
              <option value="">{t("printNoPrinters")}</option>
            ) : (
              agent.printers.map((printer) => (
                <option key={printer.name} value={printer.name}>{printer.name}</option>
              ))
            )}
          </Select>
```

- [ ] **Step 4: Run this file's test suite**

Run: `npm test -w panel -- BulkBar.test.tsx`
Expected: PASS, unchanged assertions.

- [ ] **Step 5: Commit**

```bash
git add panel/src/features/attendees/BulkBar.tsx
git commit -m "refactor(panel): BulkBar print select onto @idento/ui Select"
```

---

### Task 6: Retrofit `panel/src/features/checkin/LaunchCeremony.tsx`

**Files:**
- Modify: `panel/src/features/checkin/LaunchCeremony.tsx`
- Test: `panel/src/features/checkin/LaunchCeremony.test.tsx` (pre-existing, unmodified)

This file has 2 raw `<select>`s (zone, scan-input mode), both sharing one `SELECT_CLASSNAME`.

- [ ] **Step 1: Update the import**

Change:

```tsx
import {
  AgentStatus, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Skeleton, Switch,
} from "@idento/ui";
```

to:

```tsx
import {
  AgentStatus, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, Skeleton, Switch,
} from "@idento/ui";
```

- [ ] **Step 2: Remove the now-unneeded `SELECT_CLASSNAME` constant and its comment**

Delete:

```tsx
// Native <select>, styled to match TestPrintDialog.tsx's/PropertiesPane.tsx's
// own SELECT_CLASSNAME (duplicated per-file on purpose -- see those files'
// own comments: there's no shared @idento/ui Select primitive yet).
const SELECT_CLASSNAME =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-body text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

```

- [ ] **Step 3: Swap the zone select**

Change:

```tsx
              <select
                id="launch-zone"
                className={SELECT_CLASSNAME}
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
              >
                <option value="">{t("launchZoneNone")}</option>
                {zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </select>
```

to:

```tsx
              <Select
                id="launch-zone"
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
              >
                <option value="">{t("launchZoneNone")}</option>
                {zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </Select>
```

- [ ] **Step 4: Swap the scan-input mode select**

Change:

```tsx
              <select
                id="launch-scan-input"
                className={SELECT_CLASSNAME}
                disabled={!settingsReady}
                value={settingsForm.scan_input}
                onChange={(e) => updateSetting("scan_input", e.target.value as CheckinSettings["scan_input"])}
              >
                {SCAN_INPUT_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(SCAN_INPUT_LABEL_KEYS[mode])}
                  </option>
                ))}
              </select>
```

to:

```tsx
              <Select
                id="launch-scan-input"
                disabled={!settingsReady}
                value={settingsForm.scan_input}
                onChange={(e) => updateSetting("scan_input", e.target.value as CheckinSettings["scan_input"])}
              >
                {SCAN_INPUT_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(SCAN_INPUT_LABEL_KEYS[mode])}
                  </option>
                ))}
              </Select>
```

- [ ] **Step 5: Run this file's test suite**

Run: `npm test -w panel -- LaunchCeremony.test.tsx`
Expected: PASS, unchanged assertions.

- [ ] **Step 6: Commit**

```bash
git add panel/src/features/checkin/LaunchCeremony.tsx
git commit -m "refactor(panel): LaunchCeremony zone/scan-input selects onto @idento/ui Select"
```

---

### Task 7: Retrofit `panel/src/features/checkin/RecentScansRail.tsx`

**Files:**
- Modify: `panel/src/features/checkin/RecentScansRail.tsx`
- Test: `panel/src/features/checkin/RecentScansRail.test.tsx` (pre-existing, unmodified)

- [ ] **Step 1: Update the import**

Change:

```tsx
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, Label, Skeleton,
} from "@idento/ui";
```

to:

```tsx
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, Label, Select, Skeleton,
} from "@idento/ui";
```

- [ ] **Step 2: Remove the now-unneeded `SELECT_CLASSNAME` constant and its comment**

Delete:

```tsx
// Native <select>, styled to match PropertiesPane.tsx's/TestPrintDialog.tsx's/
// AttendeeDrawer.tsx's own SELECT_CLASSNAME (duplicated per-file on purpose --
// see those files' own comments: there's no shared @idento/ui Select
// primitive yet).
const SELECT_CLASSNAME =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-body text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

```

- [ ] **Step 3: Swap the reprint printer select**

Change:

```tsx
          <select
            id="checkin-reprint-printer"
            className={SELECT_CLASSNAME}
            value={reprintPrinter ?? ""}
            disabled={agent.printers.length === 0 || reprintPrinting}
            onChange={(event) => setReprintPrinter(event.target.value)}
          >
            {agent.printers.length === 0 ? (
              <option value="">{t("printNoPrinters")}</option>
            ) : (
              agent.printers.map((printer) => (
                <option key={printer.name} value={printer.name}>{printer.name}</option>
              ))
            )}
          </select>
```

to:

```tsx
          <Select
            id="checkin-reprint-printer"
            value={reprintPrinter ?? ""}
            disabled={agent.printers.length === 0 || reprintPrinting}
            onChange={(event) => setReprintPrinter(event.target.value)}
          >
            {agent.printers.length === 0 ? (
              <option value="">{t("printNoPrinters")}</option>
            ) : (
              agent.printers.map((printer) => (
                <option key={printer.name} value={printer.name}>{printer.name}</option>
              ))
            )}
          </Select>
```

- [ ] **Step 4: Run this file's test suite**

Run: `npm test -w panel -- RecentScansRail.test.tsx`
Expected: PASS, unchanged assertions.

- [ ] **Step 5: Commit**

```bash
git add panel/src/features/checkin/RecentScansRail.tsx
git commit -m "refactor(panel): RecentScansRail reprint select onto @idento/ui Select"
```

---

### Task 8: Retrofit `panel/src/features/attendees/AttendeesPage.tsx`

**Files:**
- Modify: `panel/src/features/attendees/AttendeesPage.tsx`
- Test: `panel/src/features/attendees/AttendeesPage.test.tsx` (pre-existing, unmodified)

**Interfaces:**
- Consumes: `Select` with `variant="pill"` (reproduces the original rounded-full filter chrome).

This file's two filter `<select>`s use an inline className (rounded-full, no shadow) that's *different* from the six form-field selects retrofitted in Tasks 2–7 — that's what the `pill` variant is for.

- [ ] **Step 1: Update the import**

Change:

```tsx
import { Button, EmptyState, Skeleton } from "@idento/ui";
```

to:

```tsx
import { Button, EmptyState, Select, Skeleton } from "@idento/ui";
```

- [ ] **Step 2: Swap the zone filter select**

Change:

```tsx
        <select
          aria-label={t("attendeesZoneFilterAll")}
          value={search.zone ?? ""}
          onChange={(e) => updateFilter({ zone: e.target.value || undefined })}
          className="h-9 rounded-full border border-input bg-card px-3 text-body text-foreground"
        >
          <option value="">{t("attendeesZoneFilterAll")}</option>
          {(zonesQuery.data ?? []).map((entry) => {
            const zone = zoneIdentity(entry);
            return (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            );
          })}
        </select>
```

to:

```tsx
        <Select
          aria-label={t("attendeesZoneFilterAll")}
          value={search.zone ?? ""}
          onChange={(e) => updateFilter({ zone: e.target.value || undefined })}
          variant="pill"
        >
          <option value="">{t("attendeesZoneFilterAll")}</option>
          {(zonesQuery.data ?? []).map((entry) => {
            const zone = zoneIdentity(entry);
            return (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            );
          })}
        </Select>
```

- [ ] **Step 3: Swap the status filter select**

Change:

```tsx
        <select
          aria-label={t("attendeesStatusFilterAny")}
          value={search.status ?? ""}
          onChange={(e) => updateFilter({ status: (e.target.value || undefined) as AttendeeStatus | undefined })}
          className="h-9 rounded-full border border-input bg-card px-3 text-body text-foreground"
        >
          <option value="">{t("attendeesStatusFilterAny")}</option>
          <option value="checked_in">{t("attendeesStatusCheckedIn")}</option>
          <option value="not_checked_in">{t("attendeesStatusNotCheckedIn")}</option>
        </select>
```

to:

```tsx
        <Select
          aria-label={t("attendeesStatusFilterAny")}
          value={search.status ?? ""}
          onChange={(e) => updateFilter({ status: (e.target.value || undefined) as AttendeeStatus | undefined })}
          variant="pill"
        >
          <option value="">{t("attendeesStatusFilterAny")}</option>
          <option value="checked_in">{t("attendeesStatusCheckedIn")}</option>
          <option value="not_checked_in">{t("attendeesStatusNotCheckedIn")}</option>
        </Select>
```

- [ ] **Step 4: Run this file's test suite**

Run: `npm test -w panel -- AttendeesPage.test.tsx`
Expected: PASS, unchanged assertions.

- [ ] **Step 5: Commit**

```bash
git add panel/src/features/attendees/AttendeesPage.tsx
git commit -m "refactor(panel): AttendeesPage filter selects onto @idento/ui Select (pill variant)"
```

---

### Task 9: Retrofit `panel/src/features/attendees/import/ImportWizard.tsx`

**Files:**
- Modify: `panel/src/features/attendees/import/ImportWizard.tsx`
- Test: `panel/src/features/attendees/import/ImportWizard.test.tsx` (pre-existing, unmodified)

**Interfaces:**
- Consumes: `Select` with `variant="compact"` (reproduces the column-mapper's smaller `px-2` padding and lack of shadow) plus a `className` override for the warning-state border/text color, exactly as the original `cn(...)` call did.

- [ ] **Step 1: Update the import**

Change:

```tsx
import {
  Button, cn, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Progress,
} from "@idento/ui";
```

to:

```tsx
import {
  Button, cn, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Progress, Select,
} from "@idento/ui";
```

(`cn` stays imported — it's still used elsewhere in this file, e.g. the column-header badge's className.)

- [ ] **Step 2: Swap the column-mapping select**

Change:

```tsx
        <select
          aria-label={header}
          value={selectValue}
          onChange={handleSelectChange}
          className={cn(
            "h-9 rounded-md border bg-card px-2 text-body text-foreground",
            hasWarning ? "border-dashed border-warning/40 text-warning" : "border-input",
          )}
        >
          {/* Placeholder-only option: visually reads as "Don't import" (per
              board 3b's unmapped-column treatment) while the column is
              still `unset`, but it's a DISTINCT value from the real `skip`
              option below — picking nothing yet is not the same decision as
              explicitly confirming a skip, and only the latter clears the
              must-acknowledge gate on the footer's Import button. */}
          {isUnset ? (
            <option value="unset" disabled hidden>
              {t("importDontImport")}
            </option>
          ) : null}
          {STANDARD_FIELDS.map((field) => (
            <option key={field} value={field}>
              {t(STANDARD_FIELD_LABEL_KEYS[field])}
            </option>
          ))}
          <option value="custom">{t("importCustomField")}</option>
          <option value="skip">{t("importDontImport")}</option>
        </select>
```

to:

```tsx
        <Select
          aria-label={header}
          value={selectValue}
          onChange={handleSelectChange}
          variant="compact"
          className={hasWarning ? "border-dashed border-warning/40 text-warning" : undefined}
        >
          {/* Placeholder-only option: visually reads as "Don't import" (per
              board 3b's unmapped-column treatment) while the column is
              still `unset`, but it's a DISTINCT value from the real `skip`
              option below — picking nothing yet is not the same decision as
              explicitly confirming a skip, and only the latter clears the
              must-acknowledge gate on the footer's Import button. */}
          {isUnset ? (
            <option value="unset" disabled hidden>
              {t("importDontImport")}
            </option>
          ) : null}
          {STANDARD_FIELDS.map((field) => (
            <option key={field} value={field}>
              {t(STANDARD_FIELD_LABEL_KEYS[field])}
            </option>
          ))}
          <option value="custom">{t("importCustomField")}</option>
          <option value="skip">{t("importDontImport")}</option>
        </Select>
```

- [ ] **Step 3: Run this file's test suite**

Run: `npm test -w panel -- ImportWizard.test.tsx`
Expected: PASS, unchanged assertions.

- [ ] **Step 4: Commit**

```bash
git add panel/src/features/attendees/import/ImportWizard.tsx
git commit -m "refactor(panel): ImportWizard column-mapper select onto @idento/ui Select (compact variant)"
```

---

### Task 10: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Confirm no raw `<select>` remains outside the primitive itself**

Run: `grep -rn "<select" panel/src --include="*.tsx" | grep -v "\.test\.tsx"`
Expected: no output (every real usage was retrofitted in Tasks 2–9; any remaining hits would only be inside `.test.tsx` files or prose comments, which are already excluded/expected).

- [ ] **Step 2: Run the full `@idento/ui` gate**

Run: `npm test -w @idento/ui && npm run typecheck -w @idento/ui && npm run lint -w @idento/ui`
Expected: all three pass.

- [ ] **Step 3: Run the full `panel` gate**

Run: `npm run typecheck -w panel && npm test -w panel && npm run lint -w panel && npm run build -w panel`
Expected: all four pass. Pay particular attention to `BadgeEditorPage.test.tsx` (mounts `PropertiesPane`) and any i18n key-parity test — this refactor adds no new i18n keys, so `keyParity.test.ts` should be unaffected.

- [ ] **Step 4: Commit if Steps 1–3 required any fixups**

Only if verification surfaced something to fix (it shouldn't, given Tasks 2–9 already ran their own scoped test suites):

```bash
git add -A
git commit -m "fix(panel): address full-gate verification findings"
```

---

## Manual / visual verification (performed by the orchestrating session after Task 10, not a subagent)

Since this touches complex, high-stakes forms, confirm visually in the browser preview (not just via tests) that nothing regressed:

1. Badge editor → select an element → **PropertiesPane**: binding select, font select (with its "Event fonts" optgroup and a disabled "missing font" option if reachable), rotation select. Confirm dropdown opens, options match pre-change, focus ring shows on Tab, disabled state (if any element type disables a field) still greys out correctly.
2. Check-in **Launch Ceremony**: zone select and scan-input-mode select — confirm both list the same options as before, respect `disabled={!settingsReady}` while settings are loading, and keep their form values in sync.
3. **AttendeesPage** filter row: zone/status pill-shaped selects — confirm the `rounded-full` chrome still reads as a filter chip, not a form field.
4. **ImportWizard** column mapper: confirm the warning (dashed amber border + amber text) still appears for an unresolved/ambiguous column mapping, and the compact select still fits its table-row layout.
5. Toggle dark mode in at least one of the above screens to confirm token classes (not literal colors) render correctly in both themes.
