import { useCallback, useRef, useState } from "react";
import { useMountEffect } from "@/lib/use-mount-effect";

/**
 * localStorage-backed cache for measured aspect ratios (pxW/pxH). Any auto-measuring
 * tile (tweet embeds, OG previews, iframes) can write its ratio here, and on the
 * next page load <AutoCanvas> will place the tile with the correct height on
 * first paint — no jump after the embed settles.
 *
 * Keys are caller-defined strings. Consumers namespace them (e.g. "tweet:1234..."
 * or "og:https://...") to avoid collisions across tile types.
 */
export interface AspectCache {
  get(key: string): number | undefined;
  set(key: string, ratio: number, options?: { persist?: boolean }): void;
  /** Reactive snapshot of the cache. Referentially stable until cache changes. */
  snapshot: ReadonlyMap<string, number>;
}

export interface UseAspectCacheOptions {
  /** localStorage key. Omit to disable persistence (memory-only). */
  storageKey?: string;
  /** Minimum relative delta to trigger a rewrite (default 0.02 = 2%). Prevents thrash. */
  epsilon?: number;
}

export function useAspectCache(options: UseAspectCacheOptions = {}): AspectCache {
  const { storageKey, epsilon = 0.02 } = options;
  const [snapshot, setSnapshot] = useState<ReadonlyMap<string, number>>(() => hydrate(storageKey));
  const stableRef = useRef(snapshot);
  const transientKeysRef = useRef(new Set<string>());
  stableRef.current = snapshot;

  // storageKey is effectively static per-mount; read it from a ref so the
  // mount-only subscriber sees the current value without resubscribing.
  const storageKeyRef = useRef(storageKey);
  storageKeyRef.current = storageKey;
  useMountEffect(() => {
    const onStorage = (e: StorageEvent) => {
      const key = storageKeyRef.current;
      if (!key || e.key !== key) return;
      setSnapshot(hydrate(key));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  });

  const set = useCallback(
    (key: string, ratio: number, setOptions?: { persist?: boolean }) => {
      if (!Number.isFinite(ratio) || ratio <= 0) return;
      const current = stableRef.current.get(key);
      if (current && Math.abs(current - ratio) / ratio < epsilon) return;
      if (setOptions?.persist === false) transientKeysRef.current.add(key);
      else transientKeysRef.current.delete(key);
      setSnapshot((prev) => {
        const next = new Map(prev);
        next.set(key, ratio);
        if (storageKey) {
          try {
            const persisted = Array.from(next.entries()).filter(
              ([entryKey]) => !transientKeysRef.current.has(entryKey),
            );
            localStorage.setItem(storageKey, JSON.stringify(persisted));
          } catch {
            // Quota exceeded or disabled storage — fall back to in-memory only.
          }
        }
        return next;
      });
    },
    [storageKey, epsilon],
  );

  const get = useCallback((key: string) => snapshot.get(key), [snapshot]);

  return { get, set, snapshot };
}

function hydrate(storageKey: string | undefined): ReadonlyMap<string, number> {
  if (!storageKey || typeof window === "undefined") return new Map();
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Map();
    const out = new Map<string, number>();
    for (const entry of parsed) {
      if (
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "number" &&
        entry[1] > 0
      ) {
        out.set(entry[0], entry[1]);
      }
    }
    return out;
  } catch {
    return new Map();
  }
}
