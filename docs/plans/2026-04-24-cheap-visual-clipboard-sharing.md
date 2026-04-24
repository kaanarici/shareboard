Status: Revised for execution
Plan Depth: compact
Revision Pass Count: 1
Execution Ready: yes
Project Maturity: prototype
Task Shape: good

## Goal
Make Shareboard behave like a no-auth experimental visual clipboard without becoming anonymous file hosting. The user should keep one Share action; internally the app chooses the cheapest viable strategy, optimizes visual media before upload, and rejects formats that do not fit the product or budget.

## Verified Reality
- Current stack is TanStack Start v1, Vite 8, React 19, Tailwind v4, optional R2. The old PRD still mentions Next.js and should not guide implementation details.
- Shared boards currently upload images as original files to R2 and store an immutable JSON manifest at `canvases/{id}.json`.
- Existing server policy rejects non-image files. This matches the current safety floor.
- R2 is low-cost but not abuse-proof. Free egress does not make anonymous storage free; storage, operations, and abuse cleanup still matter.
- Current history is only the latest share in localStorage.

## Project Maturity and Risk
Prototype. Bias toward small, reversible implementation and strict caps. Main risks are anonymous upload abuse, storage growth, browser memory use during optimization, and accidentally presenting Shareboard as lossless file preservation.

## Mission Alignment
This implements the mission direction: visual clipboard, not file archive; browser-side transformation; hidden internal storage planning; no auth.

## Architecture Decision
Use a hidden share planner with three internal outcomes:

- `fragment-only` later: compressed board data in the URL fragment for text/URL/layout-only boards.
- `r2-media` now: optimized images uploaded to R2, manifest saved as today.
- `reject` now: video, PDF, Office docs, archives, executable/binary documents, oversized media.

First execution slice completed: browser-side image optimization and matching server caps.

Second execution slice: add fragment-only tiny sharing for boards with no media, while preserving the same Share button. Because URL fragments are not sent to the server, this uses a client-rendered shared route (`/s#b=...`) instead of the existing `/c/:id` server loader. Media boards continue to use `/api/share` and R2.

## Compatibility and Deletion Policy
Preserve current shared board loading and deletion. Do not add broad compatibility shims. Future manifests can add fields such as `optimizedFrom` and `size`; old manifests continue to render because image cards already use `url`, `mimeType`, and `caption`.

## Build Sequence
1. Add a small browser codec for compact JSON -> gzip `CompressionStream` -> base64url and the reverse.
2. Add a client-only `/s` route that decodes a fragment payload and renders `SharedCanvas`.
3. Update the Share action to try a fragment-only URL first for boards without images, under a conservative URL-length cap.
4. Keep mode selection hidden: the same Share button copies either `/s#b=...` or `/c/{id}`.
5. Add `Referrer-Policy: no-referrer` metadata and stop the service worker from runtime-caching shared/API routes.
6. Leave encrypted R2 manifests/chunks, in-board CAS, and WebRTC live sharing as later slices.

## Validation and QA
- `bun run build`
- `bun run lint`
- Local browser QA on `/`: create a tiny note/URL board, share it, open the copied `/s#b=...` link, and verify it renders with no server storage dependency. Also verify an image board still takes the stored-board path if R2 env is configured, or at least does not offer fragment storage for media.

## Flow Impact
The tiny-board share flow now branches before the multipart upload path. Shared route rendering gains a client-only fragment route. Server share flow remains manifest plus media objects.

## Open Questions
- Exact retention policy is not implemented in this slice.
- Audio support is intentionally deferred until the image budget path is proven.
- Fragment-only route has no delete token because nothing is stored.
- Fragment-only boards intentionally exclude images/media in this slice.
