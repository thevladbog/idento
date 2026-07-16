import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Input,
  StatusPill,
} from "@idento/ui";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { SAMPLE_PERSONA } from "./usePreviewAttendee";
import type { components } from "../../shared/api/schema";

type Attendee = components["schemas"]["Attendee"];

export interface PreviewPickerProps {
  mode: "attendee" | "sample";
  attendee?: Attendee;
  options: Attendee[];
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (attendee: Attendee) => void;
  listError: boolean;
  // Controlled (not internal state) FOR A REASON: BadgeEditorPage's
  // page-level Escape listener (the dirty guard, Task 11) must NOT also
  // fire while this dropdown is merely being dismissed via its own Escape
  // -- Radix's DismissableLayer closes it via a native `document` listener
  // running in PARALLEL with React's own synthetic dispatch (same
  // mechanism BadgeEditorPage.tsx's handlePageKeyDown comment already
  // documents for the Reload/Overwrite ConfirmDialogs), so the same
  // keystroke reaches the page handler too unless it's gated on this exact
  // open state. A DropdownMenu is not a Dialog (no `role="dialog"`), so it
  // isn't covered by any Dialog-specific check -- the page has to track
  // this one explicitly.
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function fullName(firstName: string, lastName: string): string {
  return [firstName, lastName].filter(Boolean).join(" ");
}

const SAMPLE_NAME = fullName(SAMPLE_PERSONA.first_name, SAMPLE_PERSONA.last_name);

// P3.1 Task 12 -- board 4a's top-bar preview switcher (adopted from 4b's
// exploration, spec §6). Presentational only: every piece of state
// (current mode/attendee/search text/option list, AND whether the dropdown
// itself is open -- see `open`'s own doc comment above) is owned by the
// caller and threaded in as props, so this component has no data-fetching
// of its own and is trivial to unit test with plain mock props.
export function PreviewPicker({
  mode, attendee, options, search, onSearchChange, onSelect, listError, open, onOpenChange,
}: PreviewPickerProps) {
  const { t } = useTranslation();
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // `onOpenAutoFocus` isn't part of @radix-ui/react-dropdown-menu's PUBLIC
  // Content props (Radix deliberately omits it -- it's "private" to the
  // package's own internal MenuContentImpl, verified against
  // node_modules/@radix-ui/react-menu's own type: MenuRootContentTypeProps
  // Omits every key of MenuContentImplPrivateProps, which is where
  // onOpenAutoFocus lives), so there's no supported way to pre-empt Radix's
  // own mount-time auto-focus via a prop. Steal focus back to the search
  // input on the NEXT tick instead, once Radix's own FocusScope has already
  // run -- still lands before the operator can act on whatever Radix
  // focused first.
  React.useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const currentName = mode === "attendee" && attendee ? fullName(attendee.first_name, attendee.last_name) : SAMPLE_NAME;

  return (
    <div className="flex items-center gap-2">
      <span className="text-caption text-muted-foreground">{t("badgePreviewLabel")}</span>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            {currentName}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <div className="p-1">
            <Input
              ref={inputRef}
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              // Without this, Radix's Content-level character-key handler
              // (its roving-focus type-ahead-search, @radix-ui/react-menu)
              // would treat every keystroke here as "jump to the item
              // starting with this letter" instead of normal typing --
              // stopping propagation keeps the keydown from ever reaching
              // that Content-level listener.
              onKeyDown={(event) => event.stopPropagation()}
              placeholder={t("badgePreviewSearchPlaceholder")}
              aria-label={t("badgePreviewSearchLabel")}
            />
          </div>
          <DropdownMenuSeparator />
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-caption text-muted-foreground">{t("badgePreviewNoResults")}</p>
          ) : (
            options.map((option) => (
              <DropdownMenuItem key={option.id} onSelect={() => onSelect(option)}>
                {fullName(option.first_name, option.last_name)}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {mode === "sample" ? <StatusPill status="optional" label={t("badgePreviewSample")} /> : null}
      {listError ? <span className="text-caption text-destructive">{t("badgePreviewListError")}</span> : null}
    </div>
  );
}
