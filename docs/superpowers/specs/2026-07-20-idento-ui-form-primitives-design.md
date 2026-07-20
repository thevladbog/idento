# @idento/ui custom form primitives — Design

## Problem

The design system's form controls are only partly styled: the trigger boxes
carry the theme, but the **dropdown popups are the browser's native chrome**
— a native `<select>` popup (the `@idento/ui` `Select` deliberately wraps a
native `<select>`, PR #79), a native date-picker calendar (`<input
type="date">`), native number spinners, and raw `<input type="checkbox">` /
`type="radio">` in feature code. These popups can't be themed, look
out of place, and are especially wrong in dark mode (surfaced during the
2026-07-20 QA run, right after the dark-mode base-color fix). Standing
directive from the user: **no native form controls anywhere in the product —
only styled ones.**

## Goal

Replace every native / native-wrapper form control with a fully styled
@idento/ui primitive (styled trigger AND styled popup, theme-aware,
keyboard-accessible), migrate all panel consumers, and lock the rule in with
an AGENTS.md convention + an ESLint ban so raw natives can't creep back.

## Decisions (user-approved during brainstorm, 2026-07-20)

1. **Custom popups, not native** — the `Select` popup, date-picker calendar,
   etc. must be styled DOM, not OS chrome. This reverses PR #79's
   native-`<select>`-wrapper choice.
2. **All form controls in scope, one initiative** — Select, Checkbox,
   RadioGroup, NumberInput, DatePicker. (The implementation *plan* phases the
   tasks; the initiative ships as one branch/PR.)
3. **DatePicker uses the shadcn "radix date-picker" pattern** — a Popover +
   `react-day-picker` Calendar + a Button trigger (user-requested).
4. **Select uses the shadcn compositional API** — `Select` / `SelectTrigger`
   / `SelectValue` / `SelectContent` / `SelectItem` / `SelectGroup` /
   `SelectLabel` (chosen over a flat `options`-prop wrapper: the existing
   consumers need `<optgroup>` grouping, disabled options, and per-variant
   triggers, which the compositional shape expresses directly).

## Primitive set

All live in `packages/ui/src/components/`, exported from the barrel
`packages/ui/src/index.ts`, styled with the existing token/cva conventions
(`cn`, semantic tokens only — the `no-hardcoded-colors` test still applies),
dark-mode via the `.dark` token remap, never color-alone.

| Primitive | Radix / lib base | New dependency |
|---|---|---|
| `Select` (+ sub-parts) | `@radix-ui/react-select` | `@radix-ui/react-select` |
| `Checkbox` | `@radix-ui/react-checkbox` | `@radix-ui/react-checkbox` |
| `RadioGroup` (+ `RadioGroupItem`) | `@radix-ui/react-radio-group` | `@radix-ui/react-radio-group` |
| `NumberInput` | custom (styled `Input` + `+`/`−`) | — |
| `DatePicker` | `@radix-ui/react-popover` + `react-day-picker` | `@radix-ui/react-popover`, `react-day-picker`, `date-fns` |

`react-day-picker` v9 supports React 19 (panel is React 19; packages/ui peer
stays `react >=18`, dev-dep react 19). `date-fns` is react-day-picker's
formatting/locale companion. `.npmrc`'s `registry` pin (project rule) applies
to the worktree unchanged.

## Select — the largest piece (~20 consumers)

### Primitive shape

Radix `Select` composed into the shadcn parts, keeping the current `cva`
trigger variants so consumer intent survives:

- `variant: "default" | "pill" | "compact"` on `SelectTrigger` (the three
  variants the current native-wrapper already ships — AttendeesPage filter
  chips use `pill`, ImportWizard's column mapper uses `compact` with a
  warning `className` override that must still compose via `cn`).
- `SelectContent` is portaled, styled (surface/border/shadow tokens),
  scrollable, with styled up/down scroll buttons; `SelectItem` shows a check
  indicator on the selected row; `SelectGroup` + `SelectLabel` replace
  `<optgroup label>`; a disabled `SelectItem` replaces the disabled
  `<option>` (PropertiesPane's "missing font" row).
- Value API: `value` + `onValueChange(value: string)` (Radix) — replacing the
  native `value` + `onChange(event)`.

### Consumer migration (each of the ~20 files)

Mechanical per file: `<Select value={x} onChange={(e)=>set(e.target.value)}>
<option value=…>…</option>…</Select>` becomes
`<Select value={x} onValueChange={set}><SelectTrigger variant=…><SelectValue
placeholder=… /></SelectTrigger><SelectContent><SelectItem value=…>…
</SelectItem>…</SelectContent></Select>`. `<optgroup>`→`SelectGroup`/
`SelectLabel`; disabled `<option>`→disabled `SelectItem`;
`e.target.value`→the value arg. Empty-string "all/any" options
(AttendeesPage filters) stay `value=""`-equivalent — Radix reserves `""` for
"no value", so a sentinel like `"__all"` maps to the filter's empty state at
the consumer boundary (documented at each such site).

### Test story (the real cost)

Radix `Select` is NOT a native select: `userEvent.selectOptions` and
`getByRole("combobox")`+`selectOptions` stop working. Consumer tests migrate
to the interaction idiom: open the trigger (`userEvent.click`), then click the
target `role="option"`. Radix Select needs jsdom polyfills that jsdom lacks —
`Element.prototype.hasPointerCapture`, `Element.prototype.scrollIntoView`,
and `ResizeObserver` — added once to the panel vitest setup
(`panel/src/test/setup.ts` or the established setup file; verify its path).
`@idento/ui`'s own `select.test.tsx` is rewritten for the primitive.

## DatePicker — preserving date-only semantics

The 5 `<input type="date">` sites (`CreateEventDialog` start/end,
`GeneralCard` start/end, and any other found at implementation) feed
`panel/src/features/events/eventTiming.ts`'s date-only pipeline (`isDateOnly`,
UTC-midnight ISO — see [[panel-rewrite-status]]'s P1.1 date-only conventions).

- The `DatePicker` primitive's public value stays a **`YYYY-MM-DD` string**
  (in and out) — a drop-in for `<input type="date">`'s `value`/`onChange`, so
  the eventTiming pipeline is untouched.
- Internally: parse `YYYY-MM-DD` as a **local** `Date` (no `new Date(iso)` —
  that's UTC-parsed and drifts; construct via `new Date(y, m-1, d)` or
  date-fns `parse`), hand it to react-day-picker, and on select format the
  chosen `Date` back to `YYYY-MM-DD` with a local formatter (date-fns `format`
  / manual `getFullYear/getMonth/getDate`) — never `toISOString()` (UTC). A
  unit test pins that a pick of a given calendar day round-trips to the same
  `YYYY-MM-DD` regardless of the runner's timezone.
- Trigger: a `Button`-styled control showing the formatted date (locale from
  the current i18n language via react-day-picker's `locale`), placeholder when
  empty, clearable where the native input allowed empty.
- The calendar's month/day labels localize to EN/RU (react-day-picker
  `date-fns/locale` `enUS`/`ru`).

## Checkbox / RadioGroup / NumberInput

- **Checkbox** — Radix `Checkbox`: styled box + check indicator, `checked` +
  `onCheckedChange`, label association via the existing `Label`. Replaces the
  4 raw `type="checkbox"` sites.
- **RadioGroup** — Radix `RadioGroup` + `RadioGroupItem`: styled dot,
  `value`+`onValueChange`. Replaces the 2 raw `type="radio"` sites.
- **NumberInput** — the styled `Input` (`type="number"`) with the native
  spinner buttons hidden (CSS `appearance: textfield` /
  `::-webkit-inner-spin-button { display:none }`, scoped to this primitive)
  plus optional `+`/`−` `Button`s (a `showSteppers` prop, default on) that
  step by the field's `step`. Replaces the 5 `<Input type="number">` sites,
  clamping to `min`/`max` like the native control did. `date`-typed inputs are
  handled by DatePicker, not here.

## Convention + enforcement

- **AGENTS.md chain** (root `AGENTS.md`, `packages/ui/AGENTS.md`,
  `panel/AGENTS.md`): a rule — "Feature code MUST use @idento/ui form
  primitives (`Select`, `Checkbox`, `RadioGroup`, `NumberInput`,
  `DatePicker`, `Input`, `Switch`); raw native `<select>`, `<option>`,
  `<optgroup>`, `<input type=checkbox|radio|number|date>` are banned outside
  `packages/ui` (where the primitives encapsulate any underlying native)."
- **ESLint** — add `no-restricted-syntax` to `panel/eslint.config.js`
  (flat config, sibling of the existing `no-restricted-imports`) with
  JSXOpeningElement selectors for `select`, `option`, `optgroup`, and
  `input[type in {checkbox,radio,number,date}]`, each with a message naming
  the replacement primitive. `packages/ui/eslint.config.js` is NOT given the
  rule (that's where the primitives legitimately wrap natives). **The lint
  rule is enabled only in the final task, after every consumer has migrated**,
  so the build never goes red mid-initiative.

## Testing

- **@idento/ui** per primitive: render, controlled value, keyboard
  (open/arrow/enter/escape for Select & DatePicker; space for Checkbox;
  arrows for RadioGroup; +/− for NumberInput), ARIA roles, disabled state,
  dark-mode token usage (the `no-hardcoded-colors` guard already enforces
  token-only colors). DatePicker: the timezone-round-trip test above.
- **Panel consumers**: existing behavior preserved; each migrated file's test
  moves to the new interaction idiom. `keyParity` unaffected (no user-facing
  copy change beyond any new placeholder keys, which are added to EN+RU).
- **Gates** (the standard full set): `npm run typecheck -w panel`,
  `npm run test -w panel`, `npx eslint .` (panel), `npm run test -w
  packages/ui` + its typecheck/lint, `npm run build -w panel`. Backend/agent
  untouched.

## Out of scope

- `web/` (frozen) — its own native controls are not touched.
- Combobox/autocomplete/multi-select (no consumer needs them today — YAGNI).
- A full design-token pass on the new popups beyond the existing semantic
  tokens (they reuse `popover`/`border`/`ring`/`muted` tokens).
- Backend, agent, kiosk, console — panel + packages/ui only.

## Implementation phasing (one branch/PR; plan sequences the tasks)

1. Select primitive (+ jsdom test-setup polyfills) + @idento/ui select tests.
2. Migrate the ~20 Select consumers + their tests (batched by feature area).
3. Checkbox primitive + migrate 4 sites.
4. RadioGroup primitive + migrate 2 sites.
5. NumberInput primitive + migrate 5 sites.
6. DatePicker primitive (+ date-only round-trip) + migrate 5 sites.
7. AGENTS.md rule + ESLint `no-restricted-syntax` (enabled last) + final sweep.
