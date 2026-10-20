import { useCallback, useEffect, useRef, useState } from "react";
import { parseJson } from "@/lib/json";

const SAME_RATIO_TOLERANCE = 0.02;

function hydrate(storageKey: string): ReadonlyMap<string, number> {
  if (typeof window === "undefined") return new Map();
  try {
    const parsed = parseJson(localStorage.getItem(storageKey) ?? "[]");
    const out = new Map<string, number>();
    if (!Array.isArray(parsed)) return out;
    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [key, ratio] = entry;
      if (typeof key === "string" && typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0) {
        out.set(key, ratio);
      }
    }
    return out;
  } catch {
    return new Map();
  }
}

export function useAspectCache(storageKey: string) {
  const [snapshot, setSnapshot] = useState<ReadonlyMap<string, number>>(() => hydrate(storageKey));
  const snapshotRef = useRef(snapshot);
  const transientKeysRef = useRef(new Set<string>());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey) return;
      snapshotRef.current = hydrate(storageKey);
      setSnapshot(snapshotRef.current);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);

  const set = useCallback(
    (key: string, ratio: number, options: { persist: boolean }) => {
      if (!Number.isFinite(ratio) || ratio <= 0) return;
      const current = snapshotRef.current.get(key);
      if (current && Math.abs(current - ratio) / ratio < SAME_RATIO_TOLERANCE) return;
      if (options.persist) transientKeysRef.current.delete(key);
      else transientKeysRef.current.add(key);
      const next = new Map(snapshotRef.current).set(key, ratio);
      snapshotRef.current = next;
      setSnapshot(next);
      try {
        const persisted = [...next].filter(([entryKey]) => !transientKeysRef.current.has(entryKey));
        localStorage.setItem(storageKey, JSON.stringify(persisted));
      } catch {}
    },
    [storageKey],
  );

  return { snapshot, set };
}
