import { useEffect } from "react";

/**
 * Convenience wrapper for one-shot mount effects with empty deps. Use plain
 * `useEffect` when you have actual dependencies; reach for this only to make
 * the "runs once" intent explicit at the call site.
 */
export function useMountEffect(effect: () => void | (() => void)) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}
