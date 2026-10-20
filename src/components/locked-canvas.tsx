import { useEffect, useId, useRef, useState } from "react";
import { OTPFieldPreview as OTPField } from "@base-ui/react/otp-field";
import { LockKeyhole, Loader2 } from "lucide-react";
import { SharedCanvas } from "@/components/shared-canvas";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  LOCKED_SHARE_PIN_LENGTH,
  cleanPin,
  isCompletePin,
} from "@/lib/crypto";
import { unlockBoard } from "@/lib/share-import";
import type { Board } from "@/lib/types";

export function PinOtpField({
  id,
  pin,
  disabled,
  onPinChange,
  onComplete,
}: {
  id: string;
  pin: string;
  disabled: boolean;
  onPinChange: (pin: string) => void;
  onComplete: (pin: string) => void;
}) {
  return (
    <OTPField.Root
      id={id}
      length={LOCKED_SHARE_PIN_LENGTH}
      value={pin}
      onValueChange={(value) => onPinChange(cleanPin(value))}
      onValueComplete={(value) => onComplete(cleanPin(value))}
      validationType="numeric"
      inputMode="numeric"
      autoComplete="one-time-code"
      mask
      disabled={disabled}
      className="locked-share-otp"
    >
      {Array.from({ length: LOCKED_SHARE_PIN_LENGTH }, (_, index) => (
        <OTPField.Input
          key={index}
          className="locked-share-otp-input"
          aria-label={`PIN digit ${index + 1} of ${LOCKED_SHARE_PIN_LENGTH}`}
        />
      ))}
    </OTPField.Root>
  );
}

export function UnlockBoardDialog({
  open,
  busy,
  error,
  onOpenChange,
  onUnlock,
}: {
  open: boolean;
  busy: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onUnlock: (pin: string) => void;
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
            if (isCompletePin(pin)) onUnlock(pin);
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LockKeyhole className="h-4 w-4" />
              Unlock board
            </DialogTitle>
            <p className="locked-share-copy">Enter the board&apos;s 6-digit PIN.</p>
          </DialogHeader>

          <label htmlFor={id} className="sr-only">
            Board PIN
          </label>
          <PinOtpField
            id={id}
            pin={pin}
            disabled={busy}
            onPinChange={setPin}
            onComplete={(value) => {
              setPin(value);
              onUnlock(value);
            }}
          />
          <p className="locked-share-error" aria-live="polite">
            {error}
          </p>

          <DialogFooter className="locked-share-actions">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isCompletePin(pin) || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
              Unlock
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LockedCanvas({
  id: boardId,
}: {
  id: string;
}) {
  const id = useId();
  const [pin, setPin] = useState("");
  const [canvas, setCanvas] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const disposeRef = useRef<() => void>(() => {});

  useEffect(() => () => disposeRef.current(), []);

  const unlock = async (value = pin) => {
    const nextPin = cleanPin(value);
    if (!isCompletePin(nextPin) || unlocking) return;
    setUnlocking(true);
    setError("");
    const result = await unlockBoard(boardId, nextPin);
    setUnlocking(false);
    if (!result.ok) {
      setPin("");
      setError(result.error === "wrong-pin" ? "Incorrect PIN." : "Couldn't unlock that board");
      return;
    }
    disposeRef.current();
    disposeRef.current = result.dispose ?? (() => {});
    setCanvas(result.canvas);
  };

  if (canvas) return <SharedCanvas canvas={canvas} />;

  return (
    <div className="locked-share-screen">
      <form
        className="locked-share-card locked-share-card--inline"
        onSubmit={(e) => {
          e.preventDefault();
          void unlock();
        }}
      >
        <div className="locked-share-icon" aria-hidden>
          <LockKeyhole className="h-5 w-5" />
        </div>
        <label htmlFor={id} className="locked-share-title">
          This board is locked
        </label>
        <p className="locked-share-copy">Enter the 6-digit PIN to view it.</p>
        <PinOtpField
          id={id}
          pin={pin}
          disabled={unlocking}
          onPinChange={(value) => {
            setError("");
            setPin(value);
          }}
          onComplete={(value) => void unlock(value)}
        />
        <p className="locked-share-error" aria-live="polite">
          {error}
        </p>
      </form>
    </div>
  );
}
