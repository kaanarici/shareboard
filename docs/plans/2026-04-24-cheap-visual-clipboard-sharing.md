Status: Blueprint draft
Plan Depth: standard
Revision Pass Count: 0
Execution Ready: no
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

First execution slice: add browser-side image optimization and policy metadata while preserving the existing `/api/share` contract. Convert large raster images to WebP before they enter board state, strip metadata by canvas re-encoding, and keep SVG as-is under a small cap.

## Compatibility and Deletion Policy
Preserve current shared board loading and deletion. Do not add broad compatibility shims. Future manifests can add fields such as `optimizedFrom` and `size`; old manifests continue to render because image cards already use `url`, `mimeType`, and `caption`.

## Build Sequence
1. Add a small client utility for image policy and optimization.
2. Wire paste/drop/upload image additions through that utility.
3. Add client caps: generous input image cap, strict optimized output cap, total board media cap.
4. Add matching server caps so bypassed clients cannot upload oversized optimized images.
5. Add concise user-facing errors for rejected file types and images that cannot be optimized enough.
6. Keep mode selection hidden; current Share button still returns `/c/{id}`.
7. Leave fragment-only boards and client-side encryption as the next slice.

## Validation and QA
- `bun run build`
- `bun run lint`
- Local browser QA on `/`: add a large image, verify it optimizes, shares, and renders in `/c/{id}` if R2 env is available. If R2 env is absent, verify local optimized preview and share validation behavior only.

## Flow Impact
The upload flow changes before board state is mutated: selected/dropped/pasted images are normalized to shareable files first. Server share flow remains manifest plus media objects.

## Open Questions
- Exact retention policy is not implemented in this slice.
- Fragment-only URL format is not implemented in this slice.
- Audio support is intentionally deferred until the image budget path is proven.
