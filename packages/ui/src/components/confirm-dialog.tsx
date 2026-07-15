import * as React from "react";
import { Button } from "./button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "./dialog";
import { Input } from "./input";
import { Label } from "./label";

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  closeLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
  // Caller-driven disable on top of the typed-confirmation check below —
  // e.g. while the confirm action's mutation is in flight, so a slow
  // network can't be double-clicked into firing the action twice.
  confirmDisabled?: boolean;
} & (
  // Tier 2 (typed confirm) needs a visible label for the input's accessible
  // name — @idento/ui has no i18n fallback text to supply one, so the type
  // forces callers to pass both together or neither.
  | { typedConfirmation?: undefined; typedConfirmationLabel?: never }
  | { typedConfirmation: string; typedConfirmationLabel: string }
);

export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel, cancelLabel, closeLabel,
  onConfirm, destructive = false, typedConfirmation, typedConfirmationLabel, confirmDisabled = false,
}: ConfirmDialogProps) {
  const [typed, setTyped] = React.useState("");
  const inputId = React.useId();

  React.useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const disabled = confirmDisabled || (typedConfirmation !== undefined && typed !== typedConfirmation);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={closeLabel}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {typedConfirmation !== undefined ? (
          <div className="flex flex-col gap-2">
            {typedConfirmationLabel ? <Label htmlFor={inputId}>{typedConfirmationLabel}</Label> : null}
            <Input
              id={inputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={disabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
