import { toast } from "sonner";

/**
 * Thin wrapper around sonner that dedupes same-message toasts within a short
 * window. Instead of stacking a fresh toast on every call, we reuse sonner's
 * id-collision behavior (same id = update in place) and shake the existing
 * element so the user notices the repeat.
 *
 * Example shape:
 *   notify.success("URL added")  // first call → new toast
 *   notify.success("URL added")  // within 3s → same toast shakes
 */

const DUPE_WINDOW_MS = 3000;
const lastFired = new Map<string, number>();

function hashKey(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function trigger(kind: "success" | "error", message: string): void {
  const key = `${kind}:${message}`;
  const hash = hashKey(key);
  const id = `sb-${hash}`;
  const className = `sb-toast-${hash}`;
  const now = Date.now();
  const prev = lastFired.get(id);
  const isDupe = prev != null && now - prev < DUPE_WINDOW_MS;
  lastFired.set(id, now);

  toast[kind](message, { id, className });

  if (!isDupe) return;
  // Sonner reuses the existing DOM node when id matches, so the inner wrapper
  // is already mounted — we can apply synchronously. We target [data-content]
  // (not the root) via inline style because that element is not rewritten on
  // sonner's re-renders.
  const apply = () => {
    const inner = document.querySelector<HTMLElement>(
      `[data-sonner-toast].${className} [data-content]`,
    );
    if (!inner) return;
    inner.style.animation = "none";
    // Force a reflow so repeated duplicates restart the animation.
    void inner.offsetWidth;
    inner.style.animation = "sb-toast-shake 0.36s cubic-bezier(0.36, 0.07, 0.19, 0.97)";
  };
  // Update path: node already exists, apply immediately. For the rare race
  // where sonner hasn't attached the className yet, retry on next microtask.
  apply();
  queueMicrotask(apply);
}

export const notify = {
  success: (message: string) => trigger("success", message),
  error: (message: string) => trigger("error", message),
};
