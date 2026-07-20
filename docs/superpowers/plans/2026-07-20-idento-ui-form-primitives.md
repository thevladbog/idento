# @idento/ui custom form primitives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every native / native-wrapper form control in the panel with a fully-styled `@idento/ui` primitive (Select, Checkbox, RadioGroup, NumberInput, DatePicker), migrate all consumers, and lock the rule in with an AGENTS.md convention + ESLint ban.

**Architecture:** New primitives live in `packages/ui/src/components/`, built on Radix (Select/Checkbox/RadioGroup/Popover) and react-day-picker (DatePicker), styled with the existing token/cva conventions and mirroring `switch.tsx`'s Radix-wrapper pattern. Consumers migrate from native `<select><option>`/`<input type=…>` to the primitives. The ESLint `no-restricted-syntax` ban and the AGENTS.md rule land LAST, after every consumer has migrated, so the build never goes red mid-initiative.

**Tech Stack:** React 19, Radix UI, react-day-picker v9 + date-fns, class-variance-authority, Vitest + @testing-library/user-event (panel), Tailwind v4 tokens.

**Spec:** `docs/superpowers/specs/2026-07-20-idento-ui-form-primitives-design.md` (user-approved).

## Global Constraints

- Branch `worktree-idento-ui-form-primitives` (worktree `.claude/worktrees/idento-ui-form-primitives`), base = main `cbf8aa5`. Run from the worktree root; `git branch --show-current` before every commit (subagent-cwd hazard — see memory).
- **Semantic tokens only** — the `no-hardcoded-colors` test in packages/ui bans literal hex/rgb in components; every new primitive uses `--popover`/`--border`/`--ring`/`--muted`/`--primary` etc. via Tailwind classes. Dark mode via the `.dark` remap (already in theme.css); never color-alone.
- **Mirror `switch.tsx`** for Radix wrappers: `forwardRef` with `React.ElementRef`/`React.ComponentPropsWithoutRef<typeof Primitive.Root>`, `cn(...)` for classes, `displayName`.
- **Barrel export** every new primitive + its sub-parts and prop types from `packages/ui/src/index.ts` (match the existing `export { Select, selectVariants, type SelectProps } from "./components/select";` line style).
- **packages/ui peer stays `react >=18`**; new deps added to `packages/ui/package.json` dependencies. `.npmrc` pins `registry=https://registry.npmjs.com/` (present at repo root) — `npm install` in the worktree honors it.
- Panel typecheck via `npm run typecheck -w panel` (tsc -b, NEVER bare tsc). Panel lint via direct `npx eslint .` in `panel/` if the rtk wrapper mis-parses clean output.
- i18n: any new user-facing copy (placeholders, calendar aria) → flat keys in BOTH `panel/src/shared/i18n/en.json` and `ru.json`; `keyParity.test.ts` green.
- TDD per task; commit at each green step. Gates before "done" per task: `npm run test -w packages/ui && npm run typecheck -w packages/ui && (cd packages/ui && npx eslint .)` for primitive tasks; `npm run test -w panel && npm run typecheck -w panel && (cd panel && npx eslint .)` for consumer tasks.
- **The ESLint `no-restricted-syntax` ban and AGENTS.md rule are Task 8 only** — do NOT enable the lint rule earlier or the mid-migration build breaks.
- Out of scope: `web/` (frozen), backend, agent, combobox/multi-select, new tokens.

---

### Task 1: Select primitive (Radix listbox) + test-setup polyfills

**Files:**
- Rewrite: `packages/ui/src/components/select.tsx`
- Rewrite: `packages/ui/src/components/select.test.tsx`
- Modify: `packages/ui/src/index.ts` (export the new sub-parts), `packages/ui/package.json` (+`@radix-ui/react-select`)
- Modify: `panel/src/test/setup.ts` (jsdom polyfills for Radix Select)
- Modify: `packages/ui/vitest`/test setup if packages/ui tests also render Select interactions (check `packages/ui`'s test setup file; add the same polyfills there if its tests open the listbox)

**Interfaces:**
- Produces (consumed by Tasks 2-4):

```tsx
// packages/ui/src/components/select.tsx — shadcn/Radix compositional set
export const Select: typeof SelectPrimitive.Root;              // value + onValueChange
export const SelectGroup: typeof SelectPrimitive.Group;
export const SelectValue: typeof SelectPrimitive.Value;        // placeholder prop
export const SelectTrigger: React.FC<{ variant?: "default"|"pill"|"compact" } & ...>;
export const SelectContent: React.FC<...>;                      // portaled, styled
export const SelectLabel: React.FC<...>;                        // group heading (was <optgroup label>)
export const SelectItem: React.FC<{ value: string; disabled?: boolean } & ...>;
export const SelectSeparator: React.FC<...>;
export const selectTriggerVariants: (...) => string;            // the cva
```

- [ ] **Step 1: Add the dependency**

```bash
npm install @radix-ui/react-select -w packages/ui
```

Verify `packages/ui/package.json` gained `"@radix-ui/react-select"` under dependencies; commit the lockfile change with this task.

- [ ] **Step 2: Write the failing @idento/ui test** — `select.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./select";

function Basic({ onValueChange = () => {} }: { onValueChange?: (v: string) => void }) {
  return (
    <Select onValueChange={onValueChange}>
      <SelectTrigger><SelectValue placeholder="Pick" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="a">Alpha</SelectItem>
        <SelectItem value="b">Beta</SelectItem>
      </SelectContent>
    </Select>
  );
}

it("opens the listbox and selects an item via keyboard/click", async () => {
  const onValueChange = vi.fn();
  render(<Basic onValueChange={onValueChange} />);
  const trigger = screen.getByRole("combobox");
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByRole("option", { name: "Beta" }));
  expect(onValueChange).toHaveBeenCalledWith("b");
});

it("shows the placeholder when no value is set", () => {
  render(<Basic />);
  expect(screen.getByText("Pick")).toBeInTheDocument();
});

it("renders a disabled item that can't be chosen", async () => {
  render(
    <Select><SelectTrigger><SelectValue placeholder="p" /></SelectTrigger>
      <SelectContent><SelectItem value="x" disabled>X</SelectItem></SelectContent>
    </Select>,
  );
  await userEvent.click(screen.getByRole("combobox"));
  expect(await screen.findByRole("option", { name: "X" })).toHaveAttribute("aria-disabled", "true");
});
```

- [ ] **Step 3: Run to verify failure** — `cd packages/ui && npx vitest run src/components/select.test.tsx` → FAIL (`SelectTrigger` undefined) AND likely a jsdom `hasPointerCapture`/`scrollIntoView` error once the component exists — that's what Step 5 fixes.

- [ ] **Step 4: Implement `select.tsx`** — the shadcn/Radix Select, tokens only, keeping the three trigger variants:

```tsx
import * as SelectPrimitive from "@radix-ui/react-select";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const selectTriggerVariants = cva(
  "flex items-center justify-between gap-2 border border-input bg-card text-body text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground [&>span]:truncate",
  {
    variants: {
      variant: {
        default: "h-9 w-full rounded-md px-3 py-1 shadow-sm",
        pill: "h-9 rounded-full px-3",
        compact: "h-9 w-auto rounded-md px-2",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & VariantProps<typeof selectTriggerVariants>
>(({ className, variant, children, ...props }, ref) => (
  <SelectPrimitive.Trigger ref={ref} className={cn(selectTriggerVariants({ variant }), className)} {...props}>
    {children}
    <SelectPrimitive.Icon asChild><ChevronDown className="size-4 opacity-60" /></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md",
        position === "popper" && "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center"><ChevronUp className="size-4" /></SelectPrimitive.ScrollUpButton>
      <SelectPrimitive.Viewport className={cn("p-1", position === "popper" && "w-full min-w-[var(--radix-select-trigger-width)]")}>
        {children}
      </SelectPrimitive.Viewport>
      <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center"><ChevronDown className="size-4" /></SelectPrimitive.ScrollDownButton>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = "SelectContent";

export const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label ref={ref} className={cn("px-2 py-1.5 text-caption text-muted-foreground", className)} {...props} />
));
SelectLabel.displayName = "SelectLabel";

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-body outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex size-4 items-center justify-center">
      <SelectPrimitive.ItemIndicator><Check className="size-4" /></SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = "SelectItem";

export const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
));
SelectSeparator.displayName = "SelectSeparator";
```

(`lucide-react` is already a packages/ui dependency — verify with `grep lucide packages/ui/package.json`; if absent, the Check/Chevron icons can come from wherever `status-pill.tsx`/`agent-status.tsx` already source their icons — match that import.)

- [ ] **Step 5: Add the jsdom polyfills** — Radix Select uses pointer-capture + `scrollIntoView` + `ResizeObserver`, none in jsdom. Append to `panel/src/test/setup.ts` AND packages/ui's test setup (find it: `grep -rn setupFiles packages/ui`):

```ts
// Radix Select (and other Radix popper primitives) call these; jsdom has no
// implementation, so without stubs opening a <Select> throws.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  } as unknown as typeof ResizeObserver;
}
```

- [ ] **Step 6: Export from the barrel** — replace the old select export line in `packages/ui/src/index.ts`:

```ts
export {
  Select, SelectGroup, SelectValue, SelectTrigger, SelectContent,
  SelectLabel, SelectItem, SelectSeparator, selectTriggerVariants,
} from "./components/select";
```

(The old `SelectProps`/`selectVariants` names are GONE — Tasks 2-4 update every importer; a stale import will fail typecheck, which is the safety net.)

- [ ] **Step 7: Run tests + gates** — `npm run test -w packages/ui && npm run typecheck -w packages/ui && (cd packages/ui && npx eslint .)`. The 3 select tests pass; `no-hardcoded-colors` passes (tokens only).

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/components/select.tsx packages/ui/src/components/select.test.tsx packages/ui/src/index.ts packages/ui/package.json package-lock.json panel/src/test/setup.ts
git commit -m "@idento/ui: Select as a styled Radix listbox (replaces native-select wrapper)"
```

---

### Task 2: Migrate Select consumers — attendees batch (establishes the pattern)

**Files (Modify each + its test):**
- `panel/src/features/attendees/AttendeesPage.tsx` (`pill` variant filters, `""`→`"__all"` sentinel)
- `panel/src/features/attendees/AttendeeTable.tsx`
- `panel/src/features/attendees/AttendeeDrawer.tsx` (printer select)
- `panel/src/features/attendees/import/ImportWizard.tsx` (`compact` variant + warning className override)
- `panel/src/features/attendees/BulkBar.tsx` (printer select)

**Interfaces:** Consumes Task 1's Select set. Produces nothing downstream (behavior-preserving migration).

**The migration pattern (apply to every file here and in Tasks 3-4):**

Native shape → primitive shape:
```tsx
// BEFORE
<Select value={v} onChange={(e) => setV(e.target.value)} variant="pill">
  <option value="">All zones</option>
  <option value={z.id} key={z.id}>{z.name}</option>
</Select>

// AFTER
<Select value={v || SENTINEL} onValueChange={(next) => setV(next === SENTINEL ? "" : next)}>
  <SelectTrigger variant="pill" aria-label="Zone filter"><SelectValue /></SelectTrigger>
  <SelectContent>
    <SelectItem value={SENTINEL}>All zones</SelectItem>
    <SelectItem value={z.id} key={z.id}>{z.name}</SelectItem>
  </SelectContent>
</Select>
```

- **`""`-value sentinel:** Radix throws if any `SelectItem` has `value=""`. For every "All/Any/None" option that used `value=""`, use a module-const sentinel `const SELECT_ALL = "__all"` (name per-site) and map it to `""` at the `onValueChange`/`value` boundary so the consumer's own state/query params are unchanged. Document the sentinel at each site.
- **`onChange(e)`→`onValueChange(v)`:** replace `e.target.value` with the `v` arg.
- **`<optgroup label={x}>`→`<SelectGroup><SelectLabel>{x}</SelectLabel>…</SelectGroup>`** (badge PropertiesPane in Task 3).
- **disabled `<option>`→`<SelectItem disabled>`**.
- **`aria-label`:** the old native `<select>` often relied on an associated `<label htmlFor>`; keep that association by putting the label's `id` relationship on `SelectTrigger` (or an `aria-label`) so the trigger has an accessible name — a11y parity.

**Test migration pattern (apply to every migrated file's test):**
- `userEvent.selectOptions(getByRole("combobox"), "x")` → `await userEvent.click(getByRole("combobox", {name}))` then `await userEvent.click(await screen.findByRole("option", {name}))`.
- Assertions on the selected display value read the trigger's text (`getByRole("combobox")` shows the selected item's text), not a `<select>`'s `.value`.

- [ ] **Step 1:** For each of the 5 files, migrate the component per the pattern, then update its test to the interaction idiom. Do them one file at a time, running that file's test after each.
- [ ] **Step 2:** After all 5, run `npm run test -w panel -- src/features/attendees` → PASS.
- [ ] **Step 3:** Full gates — `npm run typecheck -w panel && npm run test -w panel && (cd panel && npx eslint .)` (eslint still ALLOWS the primitive; the ban is Task 8).
- [ ] **Step 4: Commit** — `git add panel/src/features/attendees && git commit -m "panel: migrate attendees Select consumers to the styled Select"`

---

### Task 3: Migrate Select consumers — badge batch (incl. optgroup)

**Files (Modify each + test):**
- `panel/src/features/badge/PropertiesPane.tsx` — **the hard one**: two `<optgroup>`s (built-in fonts, event fonts) + a disabled "missing font" option + mixed values (ZPL codes + font families). `<optgroup>`→`SelectGroup`+`SelectLabel`; disabled option→disabled `SelectItem`; keep the exact same values so `fontSelectValue` logic is unchanged.
- `panel/src/features/badge/ElementsPane.tsx`
- `panel/src/features/badge/PreviewPicker.tsx`
- `panel/src/features/badge/TestPrintDialog.tsx` (printer select)
- `panel/src/features/badge/BadgeEditorPage.tsx` (verify it actually renders a `<Select>` — the grep may have matched `selectedId`; migrate only real `<Select>` usages)
- `panel/src/features/badge/BadgeCanvas.tsx` (same verify — likely `selectedId`, may need NO change)

**Interfaces:** Consumes Task 1's Select set.

- [ ] **Step 1:** Confirm which of BadgeEditorPage/BadgeCanvas actually render `<Select` (grep `<Select` in each); skip files that only reference `selectedId`.
- [ ] **Step 2:** Migrate each real consumer per Task 2's pattern. For PropertiesPane, preserve `fontSelectValue`/`missingFontFamily`/`fontsByFamily` logic exactly — only the JSX shape changes (option→SelectItem, optgroup→SelectGroup/SelectLabel). Update each file's test to the interaction idiom (PropertiesPane's font-select tests are the most involved — open trigger, assert grouped options, pick one).
- [ ] **Step 3:** `npm run test -w panel -- src/features/badge` → PASS.
- [ ] **Step 4:** Full gates.
- [ ] **Step 5: Commit** — `git add panel/src/features/badge && git commit -m "panel: migrate badge Select consumers to the styled Select"`

---

### Task 4: Migrate Select consumers — checkin/equipment/zones/staff batch

**Files (Modify each + test), real `<Select>` usages among:**
- `panel/src/features/checkin/LaunchCeremony.tsx`, `ScanInput.tsx`, `RecentScansRail.tsx`
- `panel/src/features/equipment/DeviceCard.tsx`, `ScannerWizard.tsx` (terminator select), `EquipmentPage.tsx`, `PrinterWizard.tsx`
- `panel/src/features/zones/ZonesPage.tsx`
- `panel/src/features/staff/QrPrintSheet.tsx`, `AddStaffDialog.tsx` (role select — NOT the radio, that's Task 5)

**Interfaces:** Consumes Task 1's Select set.

- [ ] **Step 1:** For each file, confirm the real `<Select>` usage (grep `<Select`), migrate per Task 2's pattern, update its test to the interaction idiom, running that file's test after each.
- [ ] **Step 2:** `npm run test -w panel -- src/features/checkin src/features/equipment src/features/zones src/features/staff` → PASS.
- [ ] **Step 3:** Full gates. **Also grep-confirm zero `<Select …><option` remains anywhere** (`grep -rn "<option" panel/src/features --include="*.tsx" | grep -v .test` should now be empty in migrated files) — any straggler means a missed consumer.
- [ ] **Step 4: Commit** — `git add panel/src/features/{checkin,equipment,zones,staff} && git commit -m "panel: migrate remaining Select consumers to the styled Select"`

---

### Task 5: Checkbox + RadioGroup primitives + migrate their sites

**Files:**
- Create: `packages/ui/src/components/checkbox.tsx`, `checkbox.test.tsx`, `radio-group.tsx`, `radio-group.test.tsx`
- Modify: `packages/ui/src/index.ts`, `packages/ui/package.json` (+`@radix-ui/react-checkbox`, `@radix-ui/react-radio-group`)
- Migrate checkbox sites: `panel/src/features/attendees/AttendeeTable.tsx`, `panel/src/features/workspace/settings/FontsCard.tsx`, `panel/src/features/equipment/PrinterWizard.tsx` (+ their tests)
- Migrate radio site: `panel/src/features/staff/AddStaffDialog.tsx` (role radios) (+ test)

**Interfaces:**
- Produces: `Checkbox` (`checked`, `onCheckedChange(boolean)`), `RadioGroup` (`value`, `onValueChange`) + `RadioGroupItem` (`value`).

- [ ] **Step 1: Deps** — `npm install @radix-ui/react-checkbox @radix-ui/react-radio-group -w packages/ui`.
- [ ] **Step 2: Failing tests** — `checkbox.test.tsx`: renders `role="checkbox"`, toggles via space/click firing `onCheckedChange(true/false)`, disabled blocks. `radio-group.test.tsx`: renders `role="radiogroup"` with `role="radio"` items, arrow-key/click selection fires `onValueChange(value)`.
- [ ] **Step 3: Implement** both, mirroring `switch.tsx` (Radix wrapper, tokens):

```tsx
// checkbox.tsx
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn";
export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root ref={ref} className={cn(
    "peer size-4 shrink-0 rounded-sm border border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
    className)} {...props}>
    <CheckboxPrimitive.Indicator className="flex items-center justify-center"><Check className="size-3.5" /></CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";
```

```tsx
// radio-group.tsx
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Circle } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn";
export const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root ref={ref} className={cn("grid gap-2", className)} {...props} />
));
RadioGroup.displayName = "RadioGroup";
export const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Item ref={ref} className={cn(
    "aspect-square size-4 rounded-full border border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
    className)} {...props}>
    <RadioGroupPrimitive.Indicator className="flex items-center justify-center"><Circle className="size-2 fill-primary text-primary" /></RadioGroupPrimitive.Indicator>
  </RadioGroupPrimitive.Item>
));
RadioGroupItem.displayName = "RadioGroupItem";
```

- [ ] **Step 4: Barrel export** — add `Checkbox`, `RadioGroup`, `RadioGroupItem` to `index.ts`.
- [ ] **Step 5: Migrate** the 3 checkbox files (`<input type="checkbox" checked onChange={e=>set(e.target.checked)}>` → `<Checkbox checked onCheckedChange={set}>`, label via the existing `Label` htmlFor/id) and AddStaffDialog's role radios (`<input type="radio">`×2 → `<RadioGroup value onValueChange><RadioGroupItem value="admin"/>…`), updating each test (space/click on `role="checkbox"`/`role="radio"`).
- [ ] **Step 6: Gates** — packages/ui suite + full panel suite + typechecks + eslint.
- [ ] **Step 7: Commit** — `git add packages/ui panel/src/features/{attendees,workspace,equipment,staff} package.json package-lock.json && git commit -m "@idento/ui: Checkbox + RadioGroup primitives; migrate their consumers"`

---

### Task 6: NumberInput primitive + migrate its sites

**Files:**
- Create: `packages/ui/src/components/number-input.tsx`, `number-input.test.tsx`
- Modify: `packages/ui/src/index.ts`
- Migrate: `panel/src/features/checkin/LaunchCeremony.tsx`, `panel/src/features/equipment/EquipmentPage.tsx`, `panel/src/features/equipment/PrinterWizard.tsx`, `panel/src/features/badge/PropertiesPane.tsx` (its `NumberField` wrapper at ~line 629) (+ tests)

**Interfaces:**
- Produces: `NumberInput` — props `{ value: number | ""; onValueChange(n: number | ""): void; step?, min?, max?, showSteppers?=true, ...InputHTMLAttributes }`. Reuses the styled `Input` visual; hides native spinners; `+`/`−` `Button`s step by `step` (default 1), clamped to `min`/`max`.

- [ ] **Step 1: Failing test** — `number-input.test.tsx`: renders a number field; clicking `+` calls `onValueChange(value+step)` clamped to `max`; `−` clamped to `min`; typing a number fires `onValueChange(n)`; `showSteppers={false}` hides the buttons; native spinner is suppressed (assert the input has the spinner-hiding class).
- [ ] **Step 2: Implement** — compose the existing `Input` (import from `./input` within packages/ui) with a spinner-hiding class and flanking `Button`s:

```tsx
import * as React from "react";
import { Button } from "./button";
import { Input } from "./input";
import { cn } from "../lib/cn";
// Tailwind arbitrary variant hides the native spinners (webkit + firefox).
const NO_SPINNER = "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";
export interface NumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: number | "";
  onValueChange: (v: number | "") => void;
  step?: number; min?: number; max?: number; showSteppers?: boolean;
}
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ className, value, onValueChange, step = 1, min, max, showSteppers = true, ...props }, ref) => {
    const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    const bump = (dir: 1 | -1) => onValueChange(clamp((typeof value === "number" ? value : 0) + dir * step));
    return (
      <div className="flex items-center gap-1">
        {showSteppers && <Button type="button" variant="outline" className="size-9 shrink-0 p-0" aria-label="Decrease" disabled={props.disabled} onClick={() => bump(-1)}>−</Button>}
        <Input
          ref={ref} type="number" inputMode="numeric" step={step} min={min} max={max}
          className={cn(NO_SPINNER, className)} value={value}
          onChange={(e) => onValueChange(e.target.value === "" ? "" : Number(e.target.value))}
          {...props}
        />
        {showSteppers && <Button type="button" variant="outline" className="size-9 shrink-0 p-0" aria-label="Increase" disabled={props.disabled} onClick={() => bump(1)}>+</Button>}
      </div>
    );
  },
);
NumberInput.displayName = "NumberInput";
```

(Confirm `Button` has an `outline` variant — `grep outline packages/ui/src/components/button.tsx`; if the variant name differs, use the real one.)

- [ ] **Step 3: Barrel export** `NumberInput` + `NumberInputProps`.
- [ ] **Step 4: Migrate** the 4 sites. PropertiesPane's `NumberField` already wraps `<Input type="number">` with `value`/`onChange(e)` — swap to `NumberInput value={num} onValueChange={...}` (its callers pass numeric x/y/width/height; keep `showSteppers` default on). LaunchCeremony/EquipmentPage/PrinterWizard number fields (port, verdict-timeout) — swap likewise; where a raw string is wanted (port), keep `onValueChange` mapping to the consumer's state type. Update each test (click +/−, assert clamped callback).
- [ ] **Step 5: Gates** — packages/ui + full panel + typechecks + eslint.
- [ ] **Step 6: Commit** — `git add packages/ui panel/src/features/{checkin,equipment,badge} && git commit -m "@idento/ui: NumberInput (styled steppers, no native spinner); migrate consumers"`

---

### Task 7: DatePicker primitive (date-only preserving) + migrate its sites

**Files:**
- Create: `packages/ui/src/components/date-picker.tsx`, `date-picker.test.tsx`, `calendar.tsx` (the react-day-picker wrapper)
- Modify: `packages/ui/src/index.ts`, `packages/ui/package.json` (+`@radix-ui/react-popover`, `react-day-picker`, `date-fns`)
- Migrate: `panel/src/features/workspace/settings/GeneralCard.tsx` (start/end), `panel/src/features/events/CreateEventDialog.tsx` (start/end) (+ tests)

**Interfaces:**
- Produces: `DatePicker` — props `{ value: string; onValueChange(v: string): void; locale?: "en"|"ru"; placeholder?; disabled?; id? }` where `value`/`onValueChange` are the SAME `YYYY-MM-DD` string `<input type="date">` used — a drop-in that leaves `eventTiming.ts` untouched.
- `Calendar` — thin styled `react-day-picker` `DayPicker` wrapper (tokens; the shadcn Calendar).

- [ ] **Step 1: Deps** — `npm install @radix-ui/react-popover react-day-picker date-fns -w packages/ui`. Confirm react-day-picker resolves v9 (`grep react-day-picker package-lock.json | head`).
- [ ] **Step 2: Failing tests** — `date-picker.test.tsx`:
  - **Timezone round-trip (the load-bearing test):** with `value="2026-03-14"`, opening the picker and selecting the same day calls `onValueChange("2026-03-14")` — and this holds regardless of `process.env.TZ`. Add a second run under a non-UTC TZ (set `process.env.TZ = "America/Los_Angeles"` before importing, or use `vi.stubEnv`) asserting the SAME string, proving no UTC/local drift.
  - Empty value shows the placeholder; a value shows the formatted date.
  - Locale `ru` renders Russian month names in the calendar header.
- [ ] **Step 3: Implement `calendar.tsx`** (styled DayPicker) then `date-picker.tsx`:

```tsx
// date-picker.tsx (essentials)
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { format, parse } from "date-fns";
import { enUS, ru } from "date-fns/locale";
import { Calendar as CalendarIcon } from "lucide-react";
import * as React from "react";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { cn } from "../lib/cn";

const FMT = "yyyy-MM-dd";
export interface DatePickerProps {
  value: string; onValueChange: (v: string) => void;
  locale?: "en" | "ru"; placeholder?: string; disabled?: boolean; id?: string; className?: string;
}
export function DatePicker({ value, onValueChange, locale = "en", placeholder, disabled, id, className }: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const dfnsLocale = locale === "ru" ? ru : enUS;
  // Parse the YYYY-MM-DD as a LOCAL date (parse() with a reference now is
  // local, unlike new Date(iso) which is UTC and drifts across timezones).
  const selected = value ? parse(value, FMT, new Date()) : undefined;
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button id={id} type="button" variant="outline" disabled={disabled}
          className={cn("w-full justify-start gap-2 font-normal", !value && "text-muted-foreground", className)}>
          <CalendarIcon className="size-4" />
          {value ? format(selected!, "PPP", { locale: dfnsLocale }) : (placeholder ?? "")}
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content align="start" sideOffset={4}
          className="z-50 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md">
          <Calendar mode="single" selected={selected} locale={dfnsLocale}
            onSelect={(d) => { if (d) { onValueChange(format(d, FMT)); setOpen(false); } }} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
```

  `calendar.tsx`: `import { DayPicker } from "react-day-picker"` + `import "react-day-picker/style.css"` (or the token-mapped classNames per shadcn) — style the DayPicker with semantic-token classes (selected day → `bg-primary text-primary-foreground`, today → `bg-accent`, nav/labels → `text-foreground`/`text-muted-foreground`). Keep it a thin pass-through of DayPicker props. NOTE: `format(d, FMT)` uses the LOCAL date's y/m/d — never `toISOString()`.

- [ ] **Step 4: Barrel export** `DatePicker`, `DatePickerProps`, `Calendar`.
- [ ] **Step 5: Migrate** the 2 files. Each `<Input type="date" value={x} onChange={(e)=>set(e.target.value)}>` → `<DatePicker value={x} onValueChange={set} locale={i18nLang} placeholder={t(...)} id={...} />` where `i18nLang` comes from the consumer's `useTranslation().i18n.language` mapped to `"en"|"ru"`. The consumers' date-only state and eventTiming calls are UNCHANGED (still `YYYY-MM-DD` strings). Add EN+RU placeholder keys if a new placeholder is introduced. Update each test — the date field is now a button opening a calendar; select a day and assert the same `onValueChange` string the native input produced.
- [ ] **Step 6: Gates** — packages/ui + full panel + typechecks + eslint + keyParity.
- [ ] **Step 7: Commit** — `git add packages/ui panel/src/features/{workspace,events} panel/src/shared/i18n package.json package-lock.json && git commit -m "@idento/ui: DatePicker (styled calendar, date-only YYYY-MM-DD preserved); migrate consumers"`

---

### Task 8: AGENTS.md convention + ESLint ban + final sweep

**Files:**
- Modify: root `AGENTS.md`, `packages/ui/AGENTS.md`, `panel/AGENTS.md` (the rule)
- Modify: `panel/eslint.config.js` (the `no-restricted-syntax` ban)
- Modify: `.superpowers/sdd/progress.md` (ledger)

**Interfaces:** None — enforcement + docs.

- [ ] **Step 1: Add the ESLint ban** — in `panel/eslint.config.js`, alongside the existing `no-restricted-imports`, add to the same rules block:

```js
"no-restricted-syntax": [
  "error",
  { selector: "JSXOpeningElement[name.name='select']", message: "Use @idento/ui Select, not a native <select>." },
  { selector: "JSXOpeningElement[name.name='option']", message: "Use @idento/ui SelectItem, not <option>." },
  { selector: "JSXOpeningElement[name.name='optgroup']", message: "Use @idento/ui SelectGroup/SelectLabel, not <optgroup>." },
  { selector: "JSXOpeningElement[name.name='input'][attributes.0.value.value=/^(checkbox|radio)$/]", message: "Use @idento/ui Checkbox / RadioGroup." },
  { selector: "JSXAttribute[name.name='type'][value.value='date']", message: "Use @idento/ui DatePicker, not <input type=\"date\">." },
  { selector: "JSXAttribute[name.name='type'][value.value='number']", message: "Use @idento/ui NumberInput, not <input type=\"number\">." },
],
```

(The attribute-selector forms are AST-brittle; if a selector doesn't match reliably, use the simpler `JSXAttribute[name.name='type'][value.value='...']` form shown for date/number and a text-based approach for checkbox/radio. Validate each selector fires by temporarily adding a raw element and confirming the lint error, then removing it.)

- [ ] **Step 2: Run the ban** — `(cd panel && npx eslint .)` → it must be CLEAN (every consumer migrated in Tasks 2-7). Any error = a missed native site; migrate it (per the relevant pattern) before continuing. This is the safety net that proves the migration is complete.
- [ ] **Step 3: AGENTS.md rule** — add to each AGENTS.md (root has a UI section per memory; panel/packages/ui have their own) the sentence from the spec's Convention section: feature code uses @idento/ui form primitives; raw native `<select>/<option>/<optgroup>/<input type=checkbox|radio|number|date>` are banned outside packages/ui.
- [ ] **Step 4: Full final gates**:

```bash
npm run typecheck -w panel && npm run test -w panel && (cd panel && npx eslint .) && npm run build -w panel
npm run test -w packages/ui && npm run typecheck -w packages/ui && (cd packages/ui && npx eslint .)
npm run test -w panel -- keyParity
```

- [ ] **Step 5: Grep-proof completeness** — `grep -rn "<select\|<option\|<optgroup\|type=\"checkbox\"\|type=\"radio\"\|type=\"number\"\|type=\"date\"" panel/src --include="*.tsx" | grep -v "\.test\." | grep -v "^\S*:\s*//"` returns ZERO non-comment hits (comments referencing "<select>" are fine). Record the output in the ledger.
- [ ] **Step 6: Ledger + commit** — append the execution trail to `.superpowers/sdd/progress.md`; `git add AGENTS.md packages/ui/AGENTS.md panel/AGENTS.md panel/eslint.config.js .superpowers/sdd/progress.md && git commit -m "panel: ban raw native form controls (ESLint + AGENTS.md) — migration complete"` → then finishing-a-development-branch (PR).
