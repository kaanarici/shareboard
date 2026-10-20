import { useEffect, useState } from "react";
import { sanitizeStoredBoard } from "@/lib/canvas-sanitize";
import { isRecord, readString } from "@/lib/json";
import type { BoardFetchResponse } from "@/lib/types";

export type SharedBoardLoadState<T> = { status: "loading" } | { status: "ready"; canvas: T } | { status: "error" };

export const SHARED_BOARD_LOADING_LABEL = "Loading board...";
export const SHARED_BOARD_NOT_FOUND_LABEL = "This board isn't available";

export function storedBoardFetchUrl(id: string) {
  return `/api/share/${encodeURIComponent(id)}`;
}

export function parseBoardFetchResponse(value: unknown): BoardFetchResponse | null {
  if (isRecord(value) && value.locked === true) {
    const id = readString(value.id);
    return id ? { id, encrypted: true, locked: true } : null;
  }
  return sanitizeStoredBoard(value);
}

export function subscribeToHashChange(reload: () => void) {
  window.addEventListener("hashchange", reload);
  return () => window.removeEventListener("hashchange", reload);
}

export function useSharedBoardLoad<T>({
  load,
  subscribe,
  showLoadingOnReload = true,
}: {
  load: (signal: AbortSignal) => Promise<T | null>;
  subscribe?: (reload: () => void) => () => void;
  showLoadingOnReload?: boolean;
}): SharedBoardLoadState<T> {
  const [state, setState] = useState<SharedBoardLoadState<T>>({ status: "loading" });

  useEffect(() => {
    let controller: AbortController | undefined;

    const run = async (reloading: boolean) => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      if (!reloading || showLoadingOnReload) setState({ status: "loading" });
      try {
        const canvas = await load(current.signal);
        if (!current.signal.aborted) setState(canvas ? { status: "ready", canvas } : { status: "error" });
      } catch {
        if (!current.signal.aborted) setState({ status: "error" });
      }
    };

    void run(false);
    const unsubscribe = subscribe?.(() => void run(true));
    return () => {
      controller?.abort();
      unsubscribe?.();
    };
  }, [load, showLoadingOnReload, subscribe]);

  return state;
}
