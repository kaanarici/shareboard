import { lazy, Suspense, type ReactNode } from "react";
import { Copy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const QrCodeView = lazy(() => import("@/components/qr-code"));

export function BoardPassDialog({
  open,
  onClose,
  title,
  description,
  qrUrl,
  children,
  primaryLabel,
  onPrimary,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  qrUrl: string | null;
  children: ReactNode;
  primaryLabel: string;
  onPrimary: () => void | Promise<void>;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="board-pass-dialog sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-pretty">{description}</DialogDescription>
        </DialogHeader>
        {qrUrl ? (
          <Suspense fallback={<div className="board-pass-qr board-pass-qr--pending" />}>
            <QrCodeView url={qrUrl} />
          </Suspense>
        ) : null}
        {children}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Done
          </Button>
          <Button type="button" onClick={() => void onPrimary()}>
            <Copy className="h-4 w-4" />
            {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
