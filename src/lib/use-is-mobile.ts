import { useSyncExternalStore } from "react";
import { LG_BREAKPOINT } from "@/lib/tile-specs";

const MQ = `(max-width: ${LG_BREAKPOINT - 1}px)`;

function subscribe(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(MQ);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia(MQ).matches;
}

export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
