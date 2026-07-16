import { Button, Input, Label, cn } from "@idento/ui";
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { bindingOptions, displayBinding } from "./bindings";
import { clampPosition, clampSize, elementFootprint } from "./canvasMath";
import type { BadgeConfig, BadgeElement } from "./templateTypes";
import { ZPL_FONTS } from "./templateTypes";

export interface PropertiesPaneProps {
  // `null` when nothing is selected (ElementsPane/BadgeCanvas both allow a
  // null selectedId) -- the pane renders its own muted hint in that case,
  // never a blank/empty-looking panel.
  element: BadgeElement | null;
  // Same `event.field_schema ?? []` convention ElementsPane already takes
  // -- fed straight into bindings.ts's bindingOptions() for the binding
  // <select>'s option list.
  fieldSchema: string[];
  // Needed by canvasMath's clampPosition/clampSize (both take a
  // BadgeConfig) so a typed X/Y/Width/Height change clamps to the SAME
  // artboard bounds BadgeCanvas's own drag/resize/nudge paths already
  // enforce -- one clamp rule, never re-derived here.
  config: BadgeConfig;
  onUpdate: (id: string, patch: Partial<BadgeElement>) => void;
}

// Native <select>, styled to match `Input`'s own classes (packages/ui/src/
// components/input.tsx) -- there is no shared `@idento/ui` Select primitive
// yet (AttendeesPage.tsx's filters and ImportWizard.tsx's column mapper
// style their own native selects inline the same way), so the exact Input
// classes are duplicated here rather than reusing the Input *component*
// (which always renders an `<input>`, never a `<select>`).
const SELECT_CLASSNAME =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-body text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const ROTATIONS: ReadonlyArray<0 | 90 | 180 | 270> = [0, 90, 180, 270];

const ALIGN_OPTIONS: { value: "left" | "center" | "right"; icon: typeof AlignLeft; labelKey: string }[] = [
  { value: "left", icon: AlignLeft, labelKey: "badgeAlignLeft" },
  { value: "center", icon: AlignCenter, labelKey: "badgeAlignCenter" },
  { value: "right", icon: AlignRight, labelKey: "badgeAlignRight" },
];

// One id per control, hard-coded (not derived from element.id) -- exactly
// one PropertiesPane is ever mounted at a time (board 4a's right column),
// so a static id can never collide with another instance's, and label
// `htmlFor` wiring stays simple across re-selection.
const IDS = {
  x: "badge-props-x",
  y: "badge-props-y",
  width: "badge-props-width",
  height: "badge-props-height",
  binding: "badge-props-binding",
  text: "badge-props-text",
  font: "badge-props-font",
  fontSize: "badge-props-font-size",
  rotation: "badge-props-rotation",
  maxLines: "badge-props-max-lines",
};

// Board 4a's Properties pane (P3.1 Task 9): the right column of the badge
// editor's three-pane grid. Renders the common X/Y/Width/Height controls for
// EVERY element type, plus a per-type section: text gets binding + static
// text + font + font size + alignment + rotation + max lines; qrcode/barcode
// get a binding select only (same options as text's); line/box get nothing
// beyond the common section. Every control here dispatches a single-field
// `onUpdate(id, patch)` call -- never a batched multi-field patch -- so each
// keystroke/click is independently undoable-in-principle and mirrors
// editorState.ts's "update" action shape (`{id, patch: Partial<BadgeElement>}`).
export function PropertiesPane({
  element, fieldSchema, config, onUpdate,
}: PropertiesPaneProps) {
  const { t } = useTranslation();

  if (!element) {
    return (
      <div className="flex h-full flex-col gap-3 rounded-lg border border-border p-4" data-testid="badge-pane-properties">
        <h3 className="text-body font-medium text-muted-foreground">{t("badgePaneProperties")}</h3>
        <p className="text-caption text-muted-foreground">{t("badgePropsEmpty")}</p>
      </div>
    );
  }

  // Dispatches exactly the fields the caller passes -- callers always pass
  // a single-key object (see each handler below), never accumulate several
  // fields into one call.
  function patch(fields: Partial<BadgeElement>) {
    onUpdate(element!.id, fields);
  }

  function handleNumberChange(
    field: "x" | "y" | "width" | "height",
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const value = event.target.valueAsNumber;
    // A cleared/invalid field reports NaN -- ignore rather than dispatching
    // a patch that would corrupt the element's position/size.
    if (Number.isNaN(value)) return;

    // elementFootprint, NOT raw element.width/height: a width/height-less
    // element (a fresh text element) renders 40x8mm on the canvas, and its
    // drag/nudge paths clamp against that same footprint -- clamping a
    // typed X/Y against `width ?? 0` here would let this THIRD input path
    // park the rendered box past the edge the other two enforce (one
    // footprint rule; see canvasMath.ts's elementFootprint doc).
    const footprint = elementFootprint(element!);
    const candidate = {
      x: element!.x,
      y: element!.y,
      width: footprint.width,
      height: footprint.height,
      [field]: value,
    };

    if (field === "x" || field === "y") {
      const clamped = clampPosition(candidate, config);
      patch({ [field]: clamped[field] } as Partial<BadgeElement>);
    } else {
      const clamped = clampSize(candidate, config);
      patch({ [field]: clamped[field] } as Partial<BadgeElement>);
    }
  }

  function handleBindingChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    patch({ source: value === "" ? undefined : value });
  }

  const isTextType = element.type === "text";
  const hasBindingSection = element.type === "text" || element.type === "qrcode" || element.type === "barcode";

  // Width/Height display the RENDERED footprint, not `width ?? 0`: for a
  // footprint-defaulted element (a fresh text element carries no explicit
  // width/height) the canvas draws -- and clamps against -- these default
  // dimensions, so showing 0 would misstate what's actually on the
  // artboard. The shown value is the rendered default until the operator
  // explicitly sets one (the first edit dispatches it onto the element).
  const footprint = elementFootprint(element);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto rounded-lg border border-border p-4" data-testid="badge-pane-properties">
      <h3 className="text-body font-medium text-muted-foreground">{t("badgePaneProperties")}</h3>

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          id={IDS.x}
          label={t("badgePropsX")}
          value={element.x}
          onChange={(e) => handleNumberChange("x", e)}
        />
        <NumberField
          id={IDS.y}
          label={t("badgePropsY")}
          value={element.y}
          onChange={(e) => handleNumberChange("y", e)}
        />
        <NumberField
          id={IDS.width}
          label={t("badgePropsWidth")}
          value={footprint.width}
          onChange={(e) => handleNumberChange("width", e)}
        />
        <NumberField
          id={IDS.height}
          label={t("badgePropsHeight")}
          value={footprint.height}
          onChange={(e) => handleNumberChange("height", e)}
        />
      </div>

      {hasBindingSection && (
        <div className="flex flex-col gap-1">
          <Label htmlFor={IDS.binding}>{t("badgePropsBinding")}</Label>
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
        </div>
      )}

      {isTextType && (
        <>
          <div className="flex flex-col gap-1">
            <Label htmlFor={IDS.text}>{t("badgePropsText")}</Label>
            <Input
              id={IDS.text}
              type="text"
              value={element.text ?? ""}
              disabled={!!element.source}
              onChange={(e) => patch({ text: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor={IDS.font}>{t("badgePropsFont")}</Label>
            <select
              id={IDS.font}
              className={SELECT_CLASSNAME}
              value={element.fontFamily ?? "0"}
              onChange={(e) => patch({ fontFamily: e.target.value })}
            >
              {ZPL_FONTS.map(({ code, labelKey }) => (
                <option key={code} value={code}>
                  {t(labelKey)}
                </option>
              ))}
            </select>
          </div>

          <NumberField
            id={IDS.fontSize}
            label={t("badgePropsFontSize")}
            value={element.fontSize ?? 12}
            step={1}
            min={1}
            onChange={(e) => {
              const value = e.target.valueAsNumber;
              if (Number.isNaN(value)) return;
              patch({ fontSize: value });
            }}
          />

          <div className="flex flex-col gap-1">
            <span className="text-card-title text-foreground">{t("badgePropsAlignment")}</span>
            <div
              role="group"
              aria-label={t("badgePropsAlignment")}
              className="inline-flex w-fit gap-1 rounded-md border border-border p-0.5"
            >
              {ALIGN_OPTIONS.map(({ value, icon: Icon, labelKey }) => {
                const pressed = (element.align ?? "left") === value;
                return (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-pressed={pressed}
                    aria-label={t(labelKey)}
                    className={cn(pressed && "border-foreground bg-foreground text-background hover:bg-foreground/90")}
                    onClick={() => patch({ align: value })}
                  >
                    <Icon aria-hidden className="size-4" />
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor={IDS.rotation}>{t("badgePropsRotation")}</Label>
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
          </div>

          <NumberField
            id={IDS.maxLines}
            label={t("badgePropsMaxLines")}
            value={element.maxLines ?? ""}
            step={1}
            min={1}
            onChange={(e) => {
              const value = e.target.valueAsNumber;
              if (Number.isNaN(value)) return;
              patch({ maxLines: value });
            }}
          />
        </>
      )}
    </div>
  );
}

function NumberField({
  id, label, value, step = 0.5, min, onChange,
}: {
  id: string;
  label: string;
  value: number | "";
  step?: number;
  min?: number;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" step={step} min={min} value={value} onChange={onChange} />
    </div>
  );
}
