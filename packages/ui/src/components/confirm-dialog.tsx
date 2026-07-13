import * as React from "react";
import { Button } from "./button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "./dialog";
import { Input } from "./input";
import { Label } from "./label";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  closeLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
  typedConfirmation?: string;
  typedConfirmationLabel?: string;
}

export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel, cancelLabel, closeLabel,
  onConfirm, destructive = false, typedConfirmation, typedConfirmationLabel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = React.useState("");
  const inputId = React.useId();

  React.useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const confirmDisabled = typedConfirmation !== undefined && typed !== typedConfirmation;

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
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
