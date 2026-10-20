import { useId, useState } from "react";
import { LockKeyhole, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PinOtpField } from "@/components/locked-canvas";
import { isCompletePin } from "@/lib/crypto";

export function LockedShareDialog({
  open,
  busy,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (pin: string) => void;
}) {
  const id = useId();
  const [pin, setPin] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPin("");
  }

  const close = (nextOpen: boolean) => {
    if (!nextOpen && busy) return;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="locked-share-dialog sm:max-w-[390px]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isCompletePin(pin)) onCreate(pin);
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LockKeyhole className="h-4 w-4" />
              Share with a PIN
            </DialogTitle>
            <p className="locked-share-copy text-balance">
              Only people with this 6-digit PIN can open the link.
            </p>
          </DialogHeader>

          <label htmlFor={id} className="sr-only">
            Board PIN
          </label>
          <PinOtpField
            id={id}
            pin={pin}
            disabled={busy}
            onPinChange={setPin}
            onComplete={onCreate}
          />

          <DialogFooter className="locked-share-actions">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isCompletePin(pin) || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
              Create link
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
