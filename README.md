# Shareboard

A canvas for collecting URLs, notes, embeds, pasted SVG, and images, with optional AI summaries. Free side project — **not** a paid product. You bring your own [OpenAI](https://platform.openai.com/) key; it stays in the browser and is sent to the API only for generation.

## Run locally

Requires [Bun](https://bun.sh).

```bash
bun install
bun dev
```

Open [http://localhost:3000](http://localhost:3000), set a display name and API key in the dialog, then use the app.

## Env (optional)

Sharing boards to a public URL uses Cloudflare R2. Without these, the rest of the app still works.

Copy `.env.example` → `.env` and fill in values.

## Share Architecture

- Shared boards are stored in Cloudflare R2 as one immutable JSON manifest at `canvases/{id}.json`.
- Shared images are uploaded as separate R2 objects under `images/{id}/{itemId}` and referenced by URL from the manifest.
- The editor never persists local blob URLs or `File` objects.
- Non-image files are intentionally rejected. This is a shareboard, not general file storage.
- Each share returns a one-time delete token, stored locally in the browser for future deletion flows.

## Stack

TanStack Start + Vite, React 19, Tailwind v4, Cloudflare R2 — see `package.json`.
