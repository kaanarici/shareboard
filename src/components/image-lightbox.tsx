import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Hint } from "@/components/ui/tooltip";

export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string | null;
  alt?: string;
  onClose: () => void;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const open = src !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!src || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm animate-in fade-in-0 duration-150"
      onClick={onClose}
      role="dialog"
      aria-label="Image viewer"
    >
      <img
        src={src}
        alt={alt ?? ""}
        className="max-h-[92vh] max-w-[92vw] object-contain select-none"
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />
      <Hint label="Close">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white inline-flex items-center justify-center text-lg leading-none"
        >
          ×
        </button>
      </Hint>
    </div>,
    document.body,
  );
}
