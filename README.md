# Shareboard

Shareboard is a browser-first canvas for collecting URLs, notes, embeds, pasted SVG, and images, with optional AI summaries. It has no accounts and no server-side board storage until you explicitly share. Free side project — **not** a paid product.

You bring your own [OpenAI](https://platform.openai.com/) key. The key is stored in your browser and sent to Shareboard's generation API only when you ask for a summary.

## Run locally

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000), set a display name, optionally add an API key, then use the app.

`npm start` also runs the dev server with hot reload. Use `bun run build && bun run preview` only when you want to serve the latest production build output.

## Configuration

Shareboard has two storage paths:

- Tiny text/URL-only shares are compressed into the URL fragment. They are storage-free and never hit R2.
- Stored shares use Cloudflare R2 for immutable JSON manifests and image objects. Without R2 env vars, the editor and tiny shares still work.

Copy `.env.example` → `.env` and fill in values:

- `R2_PUBLIC_URL` (optional; enables direct public R2 image URLs)
- `SHAREBOARD_LOCKED_STORAGE_SECRET` (required for production locked boards)

Stored shares use the `SHAREBOARD_R2` bucket binding in `wrangler.jsonc`. Local development falls back to `.shareboard-storage` unless `SHAREBOARD_LOCAL_STORAGE=0` is set. `R2_PUBLIC_URL` can be set as a Worker secret so shared image URLs point directly at R2 instead of proxying through the app.

Locked shares are encrypted in the browser with a 6-digit PIN before upload. The server stores only the encrypted envelope and encrypted image bytes, and keeps the ciphertext behind a server-derived storage key so it is not downloadable before PIN verification. Set `SHAREBOARD_LOCKED_STORAGE_SECRET` to a long random value before enabling locked boards on a public deployment.

Do not commit account-specific URLs, tokens, bucket endpoints, API keys, or internal planning docs. This repository is intended to be public and self-hostable.

## Deploy on Cloudflare

Create the bucket once:

```bash
bunx wrangler r2 bucket create shareboard
```

Enable public access for the bucket and copy the resulting `r2.dev` URL:

```bash
bunx wrangler r2 bucket dev-url enable shareboard
bunx wrangler r2 bucket dev-url get shareboard
```

Set the R2 URL and locked-board storage secret as Worker secrets, then deploy:

```bash
bunx wrangler secret put R2_PUBLIC_URL
bunx wrangler secret put SHAREBOARD_LOCKED_STORAGE_SECRET
bun run deploy:cloudflare
```

For cost control, configure lifecycle expiry on the anonymous share prefixes:

```bash
bunx wrangler r2 bucket lifecycle add shareboard expire-canvases-30d canvases/ --expire-days 30 --force
bunx wrangler r2 bucket lifecycle add shareboard expire-images-30d images/ --expire-days 30 --force
```

Use a shorter expiry for public demos. Stored board manifests are cacheable for one hour; delete links still remove the source objects, but recently viewed public copies may linger until cache expiry.

The committed `wrangler.jsonc` deliberately contains only reusable infrastructure shape: Worker name, static assets, and the `SHAREBOARD_R2` binding. Each operator supplies their own bucket endpoint through Cloudflare secrets.

### Custom Domain

The default `workers.dev` URL is fine for development and demos. For a polished public launch, attach a Cloudflare custom domain after the domain is on Cloudflare:

```jsonc
{
  "routes": [
    { "pattern": "clip.example.com", "custom_domain": true }
  ]
}
```

Cloudflare creates DNS records and certificates for Worker custom domains. Keep domain-specific routes out of forks unless they belong to that deployment.

## Share Architecture

- Draft boards live in browser state. Shareboard does not create an account, database row, or server board record while you edit.
- Tiny text/URL-only boards are encoded into `/s#b=...` links using browser compression. The server stores nothing for those links.
- Public media-backed boards are stored in Cloudflare R2 as one cacheable JSON manifest at `canvases/{id}.json`.
- Shared images are optimized in the browser, uploaded as separate immutable R2 objects under `images/{id}/{pageId}/{itemId}`, and referenced by URL from the manifest.
- Locked boards encrypt the manifest and images client-side before upload. The `/c/:id` page shows an unlock screen until the correct PIN returns the encrypted envelope.
- The editor never persists local blob URLs or `File` objects.
- Non-image files are intentionally rejected. This is a shareboard, not general file storage.
- Stored R2 shares return a one-time delete token, stored locally in the browser for future deletion flows.

## Trust Boundaries

- Browser editor state may contain `File` handles and `blob:` preview URLs.
- Share payloads contain only ids, text, URLs, layouts, captions, and image metadata; image bytes travel as separate multipart files.
- Stored public manifests contain only sanitized shareable items and R2 image references.
- Locked manifests are encrypted in the browser before upload; unlock responses return the encrypted envelope only after PIN verification.

## Stack

TanStack Start + Vite, React 19, Tailwind v4, Cloudflare R2 — see `package.json`.
