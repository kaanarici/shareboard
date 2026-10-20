import { createHash } from "node:crypto";
import type { Bucket, BucketObject, BucketPutOptions } from "@/lib/server/env";
import { setServerEnvForTesting, type ServerEnv } from "@/lib/server/env";
import { resetRateLimitsForTesting } from "@/lib/server/rate-limit";

type Entry = { bytes: Uint8Array<ArrayBuffer>; contentType?: string; etag: string };

export class MemoryBucket implements Bucket {
  readonly objects = new Map<string, Entry>();
  failPutsMatching: RegExp | null = null;
  beforePut: ((key: string) => Promise<void> | void) | null = null;

  async get(key: string): Promise<BucketObject | null> {
    const entry = this.objects.get(key);
    if (!entry) return null;
    return {
      etag: entry.etag,
      httpMetadata: { contentType: entry.contentType },
      arrayBuffer: async () => entry.bytes.slice().buffer,
    };
  }

  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options: BucketPutOptions = {},
  ): Promise<{ etag: string } | null> {
    await this.beforePut?.(key);
    if (this.failPutsMatching?.test(key)) throw new Error(`put failed for ${key}`);
    const existing = this.objects.get(key);
    const { etagMatches, etagDoesNotMatch } = options.onlyIf ?? {};
    if (etagMatches !== undefined && existing?.etag !== etagMatches) return null;
    if (etagDoesNotMatch === "*" && existing) return null;
    const bytes =
      typeof value === "string"
        ? new TextEncoder().encode(value)
        : value instanceof ArrayBuffer
          ? new Uint8Array(value.slice(0))
          : Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    const etag = createHash("sha256").update(bytes).update(String(Math.random())).digest("hex").slice(0, 32);
    this.objects.set(key, { bytes, contentType: options.httpMetadata?.contentType, etag });
    return { etag };
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }

  keys(prefix = ""): string[] {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix) && !key.startsWith("_shareboard/")).sort();
  }

  text(key: string): string | null {
    const entry = this.objects.get(key);
    return entry ? new TextDecoder().decode(entry.bytes) : null;
  }
}

export function useMemoryStorage(env: Omit<ServerEnv, "SHAREBOARD_R2"> = {}): MemoryBucket {
  const bucket = new MemoryBucket();
  resetRateLimitsForTesting();
  setServerEnvForTesting({ SHAREBOARD_LOCKED_STORAGE_SECRET: "test-secret", ...env, SHAREBOARD_R2: bucket });
  return bucket;
}

export function resetServerEnv() {
  setServerEnvForTesting(undefined);
  resetRateLimitsForTesting();
}
