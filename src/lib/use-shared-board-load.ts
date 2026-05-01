import { useEffect, useState } from "react";
import type { SharedBoardLoadState } from "@/lib/shared-board";

type SharedBoardLoader<TCanvas> = (signal: AbortSignal) => Promise<TCanvas | null>;
type SharedBoardReloadSubscription = (reload: () => void) => () => void;

export function useSharedBoardLoad<TCanvas>({
  load,
  subscribe,
  showLoadingOnReload = true,
}: {
  load: SharedBoardLoader<TCanvas>;
  subscribe?: SharedBoardReloadSubscription;
  showLoadingOnReload?: boolean;
}): SharedBoardLoadState<TCanvas> {
  const [state, setState] = useState<SharedBoardLoadState<TCanvas>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;

    const run = async (fromSubscription = false) => {
      if (!fromSubscription || showLoadingOnReload) setState({ status: "loading" });
      try {
        const canvas = await load(controller.signal);
        if (disposed || controller.signal.aborted) return;
        setState(canvas ? { status: "ready", canvas } : { status: "error" });
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        if ((error as DOMException)?.name === "AbortError") return;
        setState({ status: "error" });
      }
    };

    void run();
    const unsubscribe = subscribe?.(() => {
      void run(true);
    });

    return () => {
      disposed = true;
      controller.abort();
      unsubscribe?.();
    };
  }, [load, showLoadingOnReload, subscribe]);

  return state;
}
