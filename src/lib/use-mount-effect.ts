import { useEffect } from "react";

/**
 * The ONLY wrapper around useEffect allowed in this codebase. Runs once on mount.
 * Components must never call useEffect directly — see AGENTS.md for the rules.
 */
export function useMountEffect(effect: () => void | (() => void)) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}
