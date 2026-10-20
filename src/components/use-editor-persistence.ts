import { useCallback, useEffect, useRef, useState } from "react";
import { isQuotaExceededError } from "@/lib/idb";
import { loadLocalDraft, saveLocalDraft, type DraftSnapshot } from "@/lib/local-draft";
import { notify } from "@/lib/toast";

const AUTOSAVE_DELAY_MS = 600;

export function useEditorPersistence({
  draft,
  draftRef,
  restore,
  seed,
}: {
  draft: DraftSnapshot;
  draftRef: { current: DraftSnapshot };
  restore: (draft: DraftSnapshot) => void;
  seed: () => Promise<DraftSnapshot | null>;
}) {
  const [mounted, setMounted] = useState(false);
  const canSaveRef = useRef(false);
  const savedRef = useRef<DraftSnapshot | null>(null);

  const persist = useCallback(async () => {
    const snapshot = draftRef.current;
    if (!canSaveRef.current || snapshot === savedRef.current) return;
    savedRef.current = snapshot;
    try {
      await saveLocalDraft(snapshot);
    } catch (error) {
      if (savedRef.current === snapshot) savedRef.current = null;
      if (isQuotaExceededError(error)) notify.error("This browser is out of storage space for drafts");
    }
  }, [draftRef]);

  useEffect(() => {
    let cancelled = false;
    void loadLocalDraft().then(async (result) => {
      const draft = result.status === "loaded" ? result.draft : result.status === "empty" ? await seed() : null;
      if (cancelled) return;
      if (draft) restore(draft);
      savedRef.current = draftRef.current;
      canSaveRef.current = result.status !== "unavailable";
      setMounted(true);
    });
    return () => {
      cancelled = true;
    };
  }, [draftRef, restore, seed]);

  useEffect(() => {
    if (!mounted || draft === savedRef.current) return;
    const timer = window.setTimeout(() => void persist(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [mounted, draft, persist]);

  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") void persist();
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [persist]);

  return { mounted };
}
