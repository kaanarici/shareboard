import { useMountEffect } from "@/lib/use-mount-effect";
import { useRef } from "react";
import { createPortal } from "react-dom";

/**
 * Fullscreen image viewer. Tap/click anywhere to dismiss, Escape also closes.
 * Rendered via portal so it's not constrained by the canvas's overflow:hidden.
 *
 * We render even `null` src so the Escape listener can mount once per page —
 * latest-handler ref lets us read the live `onClose` without re-subscribing.
 */
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
  const srcRef = useRef(src);
  srcRef.current = src;

  useMountEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && srcRef.current) onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

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
        // Allow pinch-zoom and prevent the outer tap-to-close from firing on
        // the image itself so the user can inspect without dismissing.
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white inline-flex items-center justify-center text-lg leading-none"
      >
        ×
      </button>
    </div>,
    document.body,
  );
}
