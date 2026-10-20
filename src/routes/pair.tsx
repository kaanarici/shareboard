import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { redeemDeviceLink } from "@/lib/owner-client";

export const Route = createFileRoute("/pair")({
  head: () => ({
    meta: [
      { title: "Add this device · Shareboard" },
      { name: "robots", content: "noindex,nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: PairPage,
});

type PairState = { status: "working" } | { status: "done" } | { status: "error"; message: string };

function PairPage() {
  const [state, setState] = useState<PairState>({ status: "working" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = window.location.hash.slice(1);
    window.history.replaceState(null, "", window.location.pathname);
    if (!code) {
      setState({ status: "error", message: "This link is missing its code." });
      return;
    }
    redeemDeviceLink(code)
      .then(() => setState({ status: "done" }))
      .catch((error: unknown) =>
        setState({ status: "error", message: error instanceof Error ? error.message : "This link didn't work." }),
      );
  }, []);

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-1.5 px-6 text-center">
      {state.status === "working" ? (
        <p className="text-sm text-muted-foreground">Adding this device…</p>
      ) : state.status === "done" ? (
        <>
          <p className="text-base font-medium">This device can publish now</p>
          <p className="max-w-[34ch] text-sm text-pretty text-muted-foreground">
            You can remove it any time from Settings on your other devices.
          </p>
          <Link to="/" className="board-cta-link mt-4">
            <span>Open Shareboard</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </>
      ) : (
        <>
          <p className="text-base font-medium">This link didn&apos;t work</p>
          <p className="max-w-[34ch] text-sm text-pretty text-muted-foreground">
            {state.message} Create a new one from Settings on a device that&apos;s already signed in.
          </p>
          <Link to="/" className="board-cta-link mt-4">
            <span>Open Shareboard</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </>
      )}
    </div>
  );
}
