/// <reference types="vite/client" />

// Worker secrets supplied via `wrangler secret put`. Bindings declared in
// wrangler.jsonc are picked up by `wrangler types`; secrets are not.
declare namespace Cloudflare {
  interface Env {
    SHAREBOARD_LOCKED_STORAGE_SECRET?: string;
    R2_PUBLIC_URL?: string;
  }
}
