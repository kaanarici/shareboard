import { useState } from "react";
import { useMountEffect } from "@/lib/use-mount-effect";
import { notify } from "@/lib/toast";

// localStorage key: "1" once the user dismisses. No expiry — if they want it
// back they can clear site data, same as every other local flag in this app.
const DISMISS_KEY = "shareboard_mobile_banner_dismissed";

/**
 * Thin top banner shown only on narrow viewports (md:hidden). Tells the user
 * the editor is desktop-first and offers to copy the current URL so they can
 * reopen on a laptop. Dismissal persists in localStorage.
 *
 * Rendered unconditionally — visibility is gated by Tailwind `md:hidden`, so
 * desktop users never see it regardless of localStorage state.
 */
export function MobileEditorBanner() {
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useMountEffect(() => {
    setMounted(true);
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
  });

  if (!mounted || dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      notify.success("Link copied — open on desktop to edit");
    } catch {
      notify.error("Couldn't copy link");
    }
  };

  return (
    <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center gap-2 px-3 py-2 text-[11px] bg-white/95 backdrop-blur border-b border-black/[0.06] shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      <span className="flex-1 min-w-0 text-foreground/80 leading-tight">
        Shareboard edits best on desktop. Viewing works everywhere.
      </span>
      <button
        type="button"
        onClick={copyLink}
        className="shrink-0 rounded-full px-2.5 py-1 bg-black text-white font-medium tracking-tight"
      >
        Copy link
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-full w-6 h-6 inline-flex items-center justify-center text-foreground/50 hover:text-foreground hover:bg-black/5"
      >
        ×
      </button>
    </div>
  );
}
