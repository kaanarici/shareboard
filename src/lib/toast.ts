import type { CSSProperties } from "react";
import { toast } from "sonner";

/**
 * Thin wrapper around sonner that dedupes same-message toasts within the same
 * visible lifetime (same id = update in place). Repeats while the toast is
 * still open show an iOS-style count badge; when the toast dismisses, the
 * count resets for the next time.
 *
 * Example:
 *   notify.success("URL added")  // first call → toast, no badge
 *   notify.success("URL added")  // again before dismiss → badge "2", then "3", …
 */

const countById = new Map<string, number>();

function hashKey(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function trigger(kind: "success" | "error", message: string): void {
  const key = `${kind}:${message}`;
  const hash = hashKey(key);
  const id = `sb-${hash}`;
  const baseClass = `sb-toast-${hash}`;
  const count = (countById.get(id) ?? 0) + 1;
  countById.set(id, count);

  const showBadge = count > 1;
  // Alternating class restarts the badge animation on each count change (see toast.css).
  const className = showBadge
    ? `${baseClass} sb-toast--badged sb-badge-tick-${count % 2}`
    : baseClass;

  toast[kind](message, {
    id,
    className,
    style: showBadge
      ? ({
          // Quoted value so `content: var(--sb-badge-count)` is valid CSS.
          "--sb-badge-count": `"${count}"`,
        } as CSSProperties)
      : undefined,
    onDismiss: () => {
      countById.delete(id);
    },
  });
}

export const notify = {
  success: (message: string) => trigger("success", message),
  error: (message: string) => trigger("error", message),
};
