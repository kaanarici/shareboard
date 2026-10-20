export interface BucketObject {
  etag: string;
  httpMetadata?: { contentType?: string };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface BucketPutOptions {
  httpMetadata?: { contentType?: string };
  onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string };
}

export interface Bucket {
  get(key: string): Promise<BucketObject | null>;
  put(key: string, value: ArrayBuffer | ArrayBufferView | string, options?: BucketPutOptions): Promise<{ etag: string } | null>;
  delete(keys: string | string[]): Promise<void>;
}

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface ServerEnv {
  SHAREBOARD_R2?: Bucket;
  SHAREBOARD_LOCKED_STORAGE_SECRET?: string;
  SHAREBOARD_SETUP_CODE?: string;
  SHAREBOARD_OWNER_RATE_LIMIT?: RateLimiter;
  SHAREBOARD_SHARE_CREATE_RATE_LIMIT?: RateLimiter;
  SHAREBOARD_SHARE_DELETE_RATE_LIMIT?: RateLimiter;
  SHAREBOARD_UNLOCK_RATE_LIMIT?: RateLimiter;
  SHAREBOARD_UNLOCK_BOARD_RATE_LIMIT?: RateLimiter;
  SHAREBOARD_OG_RATE_LIMIT?: RateLimiter;
  SHAREBOARD_TWEET_RATE_LIMIT?: RateLimiter;
  SHAREBOARD_HANDOFF_RATE_LIMIT?: RateLimiter;
  SHAREBOARD_OBJECTS_RATE_LIMIT?: RateLimiter;
  SHAREBOARD_PUBLIC_READ_RATE_LIMIT?: RateLimiter;
}

let override: ServerEnv | undefined;
let workerEnv: Promise<ServerEnv> | undefined;

async function loadWorkerEnv(): Promise<ServerEnv> {
  try {
    const { env } = await import("cloudflare:workers");
    return env;
  } catch {
    return {};
  }
}

export function getServerEnv(): Promise<ServerEnv> {
  if (override) return Promise.resolve(override);
  workerEnv ??= loadWorkerEnv();
  return workerEnv;
}

export function setServerEnvForTesting(env: ServerEnv | undefined) {
  override = env;
}

export function isDevelopmentBuild(): boolean {
  const env: unknown = import.meta.env;
  return typeof env === "object" && env !== null && "DEV" in env && env.DEV === true;
}
