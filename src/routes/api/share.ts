import { randomBytes, createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import {
  getObjectResponse,
  isSafeObjectKey,
  putBuffer,
  storedObjectHeaders,
} from "@/lib/r2";
import {
  commitLockedCanvas,
  commitPublicCanvas,
  deleteStoredCanvas,
  getLockedReplaceState,
  getPublicReplaceState,
  readLockedCanvasRaw,
  readPublicCanvasRaw,
  readShareRawForDelete,
  rollbackUploadedObjects,
} from "@/lib/server/share-storage";
import { RATE_LIMIT_BINDINGS, takeRateLimit } from "@/lib/rate-limit";
import { getClientIp, isSameOrigin } from "@/lib/server/request";
import { createPinVerifier, lockedCanvasKey, verifyPin } from "@/lib/server/locked-share";
import { cleanPin, LOCKED_SHARE_PIN_LENGTH } from "@/lib/locked-share-pin";
import {
  SANITIZE_LIMITS,
  sanitizeAuthorProfile,
  sanitizePublicCanvasManifest,
  sanitizeShareRequestPayload,
  trimText,
} from "@/lib/canvas-sanitize";
import type {
  Canvas,
  EncryptedCanvasEnvelope,
  EncryptedShareImage,
  ShareCreateResponse,
  ShareRequestImageItem,
  ShareRequestItem,
  ShareRequestPayload,
  StoredCanvas,
  SharedBoardPage,
  SharedCanvasItem,
} from "@/lib/types";
import { isEncryptedCanvas } from "@/lib/types";

const SHARE_LIMITS = {
  maxPages: 12,
  maxItemsPerPage: 60,
  maxImages: 32,
  maxImageBytes: 4 * 1024 * 1024,
  maxTotalImageBytes: 75 * 1024 * 1024,
  maxTotalJsonBytes: 2 * 1024 * 1024,
  maxPreviewBytes: 768 * 1024,
  // Upper bound on the (non-image) manifest JSON string. Comfortably above the
  // structural max of a real board (12 pages x 60 items of notes/json/urls) so
  // it never rejects legit input, but caps JSON.parse + sanitize work per POST.
  maxPayloadChars: 24 * 1024 * 1024,
} as const;

type EncryptedSharePayload = Omit<EncryptedCanvasEnvelope, "deleteTokenHash">;

const IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const MANIFEST_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";

class ShareError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ShareError";
  }
}

function badRequest(message: string): never {
  throw new ShareError(message, 400);
}

function createShareId() {
  return randomBytes(18).toString("base64url");
}

function isSocialHost(url: string, kind: "x" | "instagram" | "linkedin"): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  if (kind === "x") {
    return host === "x.com" || host === "twitter.com" || host.endsWith(".twitter.com");
  }
  if (kind === "instagram") {
    return host === "instagram.com" || host.endsWith(".instagram.com");
  }
  if (kind === "linkedin") {
    return host === "linkedin.com" || host.endsWith(".linkedin.com");
  }
  return false;
}

/** Server-side wrapper adding host validation on top of the shared sanitizer. */
function sanitizeStrictAuthorProfile(value: unknown) {
  const profile = sanitizeAuthorProfile(value);
  if (!profile) return undefined;
  if (profile.xUrl && !isSocialHost(profile.xUrl, "x")) delete profile.xUrl;
  if (profile.instagramUrl && !isSocialHost(profile.instagramUrl, "instagram")) delete profile.instagramUrl;
  if (profile.linkedinUrl && !isSocialHost(profile.linkedinUrl, "linkedin")) delete profile.linkedinUrl;
  return Object.keys(profile).length ? profile : undefined;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function sha256Hex(bytes: Uint8Array) {
  // Node's Buffer is Uint8Array<ArrayBufferLike>; WebCrypto's digest wants a
  // BufferSource backed by ArrayBuffer. These bytes are always ArrayBuffer-backed
  // (Buffer.from(arrayBuffer)); the cast bridges the @types/node vs DOM generic gap.
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Buffer.from(digest).toString("hex");
}

function manifestEtag(raw: string) {
  return `"${createHash("sha256").update(raw).digest("base64url")}"`;
}

function matchesIfNoneMatch(request: Request, etag: string) {
  const header = request.headers.get("if-none-match");
  if (!header) return false;
  return header.split(",").some((part) => {
    const candidate = part.trim();
    return candidate === "*" || candidate === etag || candidate === `W/${etag}`;
  });
}

function manifestHeaders(etag: string) {
  return storedObjectHeaders({
    "Content-Type": "application/json",
    "Cache-Control": MANIFEST_CACHE_CONTROL,
    ETag: etag,
  });
}

function keepToken(value: unknown, max: number) {
  return typeof value === "string" && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value) ? value : "";
}

function readPin(value: unknown) {
  return typeof value === "string" ? cleanPin(value) : "";
}

function parsePayload(raw: string | undefined): ShareRequestPayload {
  if (!raw) badRequest("Missing payload");
  if (raw.length > SHARE_LIMITS.maxPayloadChars) badRequest("Board payload is too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    badRequest("Invalid payload JSON");
  }
  const payload = sanitizeShareRequestPayload(parsed);
  if (!payload) {
    badRequest("Board must include at least one page");
  }
  if (payload.pages.length > SHARE_LIMITS.maxPages) {
    badRequest(`Board is too large (max ${SHARE_LIMITS.maxPages} pages)`);
  }
  return payload;
}

function parseUnlockRequest(value: unknown): { id: string; pin: string } | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (body.action !== "unlock") return null;
  const id = keepToken(body.id, 80);
  const pin = readPin(body.pin);
  return id && pin.length === LOCKED_SHARE_PIN_LENGTH ? { id, pin } : null;
}

function parseStoredJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseEncryptedPayload(raw: string | undefined): EncryptedSharePayload {
  if (!raw) badRequest("Missing encrypted payload");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    badRequest("Invalid encrypted payload JSON");
  }
  if (!parsed || typeof parsed !== "object") badRequest("Invalid encrypted payload");
  const payload = parsed as Record<string, unknown>;
  const id = keepToken(payload.id, 80);
  if (!id || id.length < 16) badRequest("Invalid encrypted board id");
  if (payload.encrypted !== true || payload.v !== 1 || payload.kdf !== "PBKDF2-SHA-256") {
    badRequest("Invalid encrypted board");
  }

  const iterations = Number(payload.iterations);
  if (!Number.isFinite(iterations) || iterations < 100_000 || iterations > 1_000_000) {
    badRequest("Invalid encryption settings");
  }

  const salt = keepToken(payload.salt, 128);
  const iv = keepToken(payload.iv, 128);
  const data = keepToken(payload.data, 25_000_000);
  if (!salt || !iv || !data) badRequest("Invalid encrypted board");

  const images = Array.isArray(payload.images)
    ? payload.images.map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const image = entry as Record<string, unknown>;
        const imageId = trimText(image.id, 80);
        const pageId = trimText(image.pageId, 80);
        const key = trimText(image.key, 180);
        const imageIv = keepToken(image.iv, 128);
        const size = Number(image.size);
        if (
          !imageId ||
          !pageId ||
          !imageIv ||
          !Number.isFinite(size) ||
          size <= 0
        ) {
          return null;
        }
        return {
          id: imageId,
          pageId,
          key,
          url: "",
          iv: imageIv,
          size: Math.floor(size),
        } satisfies EncryptedShareImage;
      })
    : [];

  if (images.some((image) => !image)) badRequest("Invalid encrypted image");
  if (images.length > SHARE_LIMITS.maxImages) {
    badRequest(`Too many images (max ${SHARE_LIMITS.maxImages})`);
  }
  const totalBytes = images.reduce((sum, image) => sum + (image?.size ?? 0), 0);
  if (totalBytes > SHARE_LIMITS.maxTotalImageBytes) {
    badRequest(`Images exceed ${Math.floor(SHARE_LIMITS.maxTotalImageBytes / 1024 / 1024)} MB total`);
  }

  return {
    id,
    encrypted: true,
    v: 1,
    kdf: "PBKDF2-SHA-256",
    iterations: Math.floor(iterations),
    salt,
    iv,
    data,
    images: images.filter((image): image is EncryptedShareImage => !!image),
    createdAt: trimText(payload.createdAt, 40) || new Date().toISOString(),
  };
}

/** Counters shared across pages to enforce board-wide file caps. */
type FileCounters = { imageCount: number; imageBytes: number; jsonBytes: number };

type StoredImageItem = Extract<SharedCanvasItem, { type: "image" }>;
type UploadedImageObject = {
  key: string;
  url: string;
  mimeType: string;
  size: number;
};
type ImageUploadCache = Map<string, UploadedImageObject>;

async function buildSharedItems(
  canvasId: string,
  pageId: string,
  rawItems: ShareRequestItem[],
  files: Map<string, File>,
  uploadedKeys: string[],
  counters: FileCounters,
  imageUploadsByHash: ImageUploadCache,
  /** When provided (replace flow), image items with no uploaded bytes reuse the existing object. */
  reuseImagesById?: Map<string, StoredImageItem>,
): Promise<SharedCanvasItem[]> {
  if (rawItems.length > SHARE_LIMITS.maxItemsPerPage) {
    badRequest(`A page can hold at most ${SHARE_LIMITS.maxItemsPerPage} items`);
  }
  const items: SharedCanvasItem[] = [];

  for (const item of rawItems) {
    if (item.type === "url" || item.type === "note") {
      items.push(item);
      continue;
    }

    if (item.type === "json") {
      counters.jsonBytes += item.size;
      if (counters.jsonBytes > SHARE_LIMITS.maxTotalJsonBytes) {
        badRequest(`JSON files exceed ${Math.floor(SHARE_LIMITS.maxTotalJsonBytes / 1024 / 1024)} MB total`);
      }
      items.push(item);
      continue;
    }

    if (item.type === "image") {
      counters.imageCount += 1;
      if (counters.imageCount > SHARE_LIMITS.maxImages) {
        badRequest(`Too many images (max ${SHARE_LIMITS.maxImages})`);
      }

      const sanitized: ShareRequestImageItem = item;
      const file = files.get(sanitized.id);

      if (!file && reuseImagesById?.has(sanitized.id)) {
        const reused = reuseImagesById.get(sanitized.id)!;
        counters.imageBytes += reused.size ?? 0;
        if (counters.imageBytes > SHARE_LIMITS.maxTotalImageBytes) {
          badRequest(`Images exceed ${Math.floor(SHARE_LIMITS.maxTotalImageBytes / 1024 / 1024)} MB total`);
        }
        items.push({
          id: sanitized.id,
          type: "image",
          url: reused.url,
          ...(reused.objectKey ? { objectKey: reused.objectKey } : {}),
          mimeType: sanitized.mimeType ?? reused.mimeType,
          size: reused.size,
          caption: sanitized.caption ?? reused.caption,
        });
        continue;
      }

      if (!file) badRequest(`Missing image upload for item ${sanitized.id}`);
      if (!file.type.startsWith("image/")) badRequest("Only image uploads are allowed");
      if (file.size > SHARE_LIMITS.maxImageBytes) {
        badRequest(`Image ${sanitized.id} exceeds ${Math.floor(SHARE_LIMITS.maxImageBytes / 1024 / 1024)} MB`);
      }

      counters.imageBytes += file.size;
      if (counters.imageBytes > SHARE_LIMITS.maxTotalImageBytes) {
        badRequest(`Images exceed ${Math.floor(SHARE_LIMITS.maxTotalImageBytes / 1024 / 1024)} MB total`);
      }

      const key = `images/${canvasId}/${pageId}/${sanitized.id}`;
      if (!isSafeObjectKey(key)) badRequest("Invalid image id");
      const bytes = Buffer.from(await file.arrayBuffer());
      const mimeType = file.type || sanitized.mimeType || "application/octet-stream";
      const hash = await sha256Hex(bytes);
      const existing = imageUploadsByHash.get(hash);
      if (existing) {
        items.push({
          id: sanitized.id,
          type: "image",
          url: existing.url,
          objectKey: existing.key,
          mimeType: existing.mimeType,
          size: existing.size,
          caption: sanitized.caption,
        });
        continue;
      }

      const url = await putBuffer(key, bytes, mimeType, IMAGE_CACHE_CONTROL);
      uploadedKeys.push(key);
      imageUploadsByHash.set(hash, { key, url, mimeType, size: file.size });
      items.push({
        id: sanitized.id,
        type: "image",
        url,
        objectKey: key,
        mimeType,
        size: file.size,
        caption: sanitized.caption,
      });
      continue;
    }
  }

  return items;
}

async function uploadPreview(
  canvasId: string,
  raw: FormDataEntryValue | null,
  uploadedKeys: string[]
): Promise<string | undefined> {
  if (!(raw instanceof File)) return undefined;
  if (raw.type !== "image/png") return undefined;
  if (raw.size === 0 || raw.size > SHARE_LIMITS.maxPreviewBytes) return undefined;
  const key = `previews/${canvasId}.png`;
  if (!isSafeObjectKey(key)) return undefined;
  const bytes = Buffer.from(await raw.arrayBuffer());
  const url = await putBuffer(key, bytes, "image/png", IMAGE_CACHE_CONTROL);
  uploadedKeys.push(key);
  return url;
}

async function buildSharedPages(
  canvasId: string,
  rawPages: ShareRequestPayload["pages"],
  files: Map<string, File>,
  uploadedKeys: string[],
  reuseImagesById?: Map<string, StoredImageItem>,
): Promise<SharedBoardPage[]> {
  const counters: FileCounters = { imageCount: 0, imageBytes: 0, jsonBytes: 0 };
  const imageUploadsByHash: ImageUploadCache = new Map();
  const pages: SharedBoardPage[] = [];

  for (const page of rawPages) {
    const items = await buildSharedItems(
      canvasId,
      page.id,
      page.items,
      files,
      uploadedKeys,
      counters,
      imageUploadsByHash,
      reuseImagesById,
    );
    pages.push({ id: page.id, items, ...(page.layouts ? { layouts: page.layouts } : {}) });
  }

  if (!pages.some((p) => p.items.length > 0)) {
    badRequest("Board must include at least one item");
  }

  return pages;
}

export const Route = createFileRoute("/api/share")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOrigin(request)) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }
        const ip = getClientIp(request) ?? "unknown";
        const contentType = request.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          try {
            const unlock = parseUnlockRequest(await request.json().catch(() => null));
            if (!unlock) {
              return Response.json({ error: "Invalid request" }, { status: 400 });
            }
            const { id, pin } = unlock;
            const [rate, globalRate] = await Promise.all([
              takeRateLimit(`share-unlock:${id}:${ip}`, 5, 10 * 60 * 1000, {
                binding: RATE_LIMIT_BINDINGS.unlock,
              }),
              takeRateLimit(`share-unlock-board:${id}`, 30, 10 * 60 * 1000, {
                binding: RATE_LIMIT_BINDINGS.unlock,
              }),
            ]);
            if (!rate.ok || !globalRate.ok) {
              const retryAfterSeconds = Math.max(
                rate.ok ? 0 : rate.retryAfterSeconds,
                globalRate.ok ? 0 : globalRate.retryAfterSeconds,
              );
              return Response.json(
                { error: "Too many unlock attempts. Try again shortly." },
                { status: 429, headers: { "Retry-After": String(retryAfterSeconds || 1) } }
              );
            }

            const { raw } = await readLockedCanvasRaw(id, lockedCanvasKey);
            if (!raw) return Response.json({ error: "Board not found" }, { status: 404 });
            const canvas = parseStoredJson(raw);
            if (!isEncryptedCanvas(canvas)) {
              return Response.json({ error: "Board not found" }, { status: 404 });
            }
            if (!canvas.pinVerifier || !(await verifyPin(pin, canvas.pinVerifier))) {
              return Response.json({ error: "Invalid PIN" }, { status: 403 });
            }
            const { pinVerifier: _pinVerifier, deleteTokenHash: _deleteTokenHash, ...unlocked } = canvas;
            return Response.json(unlocked, { headers: { "Cache-Control": "no-store" } });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to unlock board";
            const status = /secret is not configured/i.test(message) ? 503 : 500;
            return Response.json({ error: status === 500 ? "Failed to unlock board" : message }, { status });
          }
        }

        const rate = await takeRateLimit(`share:${ip}`, 20, 10 * 60 * 1000, {
          binding: RATE_LIMIT_BINDINGS.shareCreate,
        });
        if (!rate.ok) {
          return Response.json(
            { error: "Too many share attempts. Try again shortly." },
            { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
          );
        }

        const uploadedKeys: string[] = [];
        try {
          const form = await request.formData();
          const replaceId = keepToken(form.get("replaceId")?.toString(), 80);
          const replaceToken = trimText(form.get("replaceToken")?.toString(), 200);
          const isReplace = !!(replaceId && replaceToken);

          const encryptedRaw = form.get("encryptedPayload")?.toString();
          if (encryptedRaw) {
            const payload = parseEncryptedPayload(encryptedRaw);
            const pin = readPin(form.get("pin"));
            if (pin.length !== LOCKED_SHARE_PIN_LENGTH) badRequest("Invalid PIN");
            const { key: lockedKey, raw: existing } = await readLockedCanvasRaw(payload.id, lockedCanvasKey);

            let priorImageKeys: string[] = [];
            if (isReplace) {
              if (replaceId !== payload.id) badRequest("Replace id mismatch");
              if (!existing) throw new ShareError("Share not found", 404);
              const priorParsed = parseStoredJson(existing);
              if (!isEncryptedCanvas(priorParsed)) throw new ShareError("Share not found", 404);
              if (!priorParsed.deleteTokenHash || priorParsed.deleteTokenHash !== hashToken(replaceToken)) {
                throw new ShareError("Invalid replace token", 403);
              }
              priorImageKeys = getLockedReplaceState(priorParsed).priorImageKeys;
            } else if (existing) {
              throw new ShareError("Share id already exists", 409);
            }

            const files = new Map<string, File>();
            for (const [key, value] of form.entries()) {
              if (!key.startsWith("encrypted-image:") || !(value instanceof File)) continue;
              files.set(key.slice("encrypted-image:".length), value);
            }

            const images = await Promise.all(
              payload.images.map(async (image) => {
                const file = files.get(image.id);
                if (!file) badRequest(`Missing encrypted image upload for item ${image.id}`);
                if (file.size !== image.size) badRequest("Encrypted image size mismatch");
                if (file.size > SHARE_LIMITS.maxImageBytes + 1024) {
                  badRequest(`Image ${image.id} exceeds ${Math.floor(SHARE_LIMITS.maxImageBytes / 1024 / 1024)} MB`);
                }
                const bytes = Buffer.from(await file.arrayBuffer());
                const key = `locked-images/${randomBytes(24).toString("base64url")}`;
                const url = await putBuffer(
                  key,
                  bytes,
                  "application/octet-stream",
                  IMAGE_CACHE_CONTROL
                );
                uploadedKeys.push(key);
                return { ...image, key, url };
              })
            );

            const deleteToken = randomBytes(24).toString("base64url");
            const canvas: EncryptedCanvasEnvelope = {
              ...payload,
              images,
              pinVerifier: await createPinVerifier(pin),
              deleteTokenHash: hashToken(deleteToken),
            };
            await commitLockedCanvas({
              lockedKey,
              canvas,
              ...(isReplace ? { replace: { priorImageKeys } } : {}),
            });
            return Response.json({ id: payload.id, deleteToken } satisfies ShareCreateResponse);
          }

          const payload = parsePayload(form.get("payload")?.toString());

          const files = new Map<string, File>();
          for (const [key, value] of form.entries()) {
            if (!key.startsWith("image:") || !(value instanceof File)) continue;
            files.set(key.slice("image:".length), value);
          }

          let id: string;
          let reuseImages: Map<string, StoredImageItem> | undefined;
          let priorImageKeys: string[] = [];
          let priorPreviewUrl: string | undefined;

          if (isReplace) {
            const priorRaw = await readPublicCanvasRaw(replaceId);
            if (!priorRaw) throw new ShareError("Share not found", 404);
            const priorParsed = parseStoredJson(priorRaw);
            const priorCanvas = sanitizePublicCanvasManifest(priorParsed);
            if (!priorCanvas) throw new ShareError("Share not found", 404);
            if (!priorCanvas.deleteTokenHash || priorCanvas.deleteTokenHash !== hashToken(replaceToken)) {
              throw new ShareError("Invalid replace token", 403);
            }
            id = replaceId;
            const replaceState = getPublicReplaceState(priorCanvas);
            reuseImages = replaceState.reuseImagesById;
            priorImageKeys = replaceState.priorImageKeys;
            priorPreviewUrl = replaceState.priorPreviewUrl;
          } else {
            id = createShareId();
          }

          const deleteToken = randomBytes(24).toString("base64url");
          const pages = await buildSharedPages(id, payload.pages, files, uploadedKeys, reuseImages);

          const authorProfile = sanitizeStrictAuthorProfile(payload.authorProfile);
          // On replace: a fresh preview overwrites the prior one; if no preview
          // was uploaded (e.g. mobile share, where the live DOM is not desktop-
          // shaped) we preserve the prior previewUrl so iMessage / Slack / etc.
          // keep their cards.
          const newPreviewUrl = await uploadPreview(id, form.get("preview"), uploadedKeys);
          const previewUrl = newPreviewUrl ?? (isReplace ? priorPreviewUrl : undefined);

          const canvas: Canvas = {
            id,
            author: trimText(payload.author, SANITIZE_LIMITS.maxAuthorChars) || "Anonymous",
            ...(authorProfile ? { authorProfile } : {}),
            pages,
            createdAt: new Date().toISOString(),
            deleteTokenHash: hashToken(deleteToken),
            ...(previewUrl ? { previewUrl } : {}),
          };

          await commitPublicCanvas({
            id,
            canvas,
            cacheControl: MANIFEST_CACHE_CONTROL,
            ...(isReplace ? { replace: { priorImageKeys } } : {}),
          });

          return Response.json({ id, deleteToken } satisfies ShareCreateResponse);
        } catch (error) {
          await rollbackUploadedObjects(uploadedKeys);
          const message = error instanceof Error ? error.message : "Failed to share board";
          let status = 500;
          if (error instanceof ShareError) {
            status = error.status;
          } else if (message === "Sharing storage is not configured") {
            status = 503;
          }
          return Response.json({ error: message }, { status });
        }
      },

      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const key = trimText(url.searchParams.get("key"), 4096);
          const canvasId = key.match(/^canvases\/([A-Za-z0-9_-]+)\.json$/)?.[1];
          if (canvasId) {
            const publicRaw = await readPublicCanvasRaw(canvasId);
            if (publicRaw) {
              const canvas = parseStoredJson(publicRaw);
              if (isEncryptedCanvas(canvas)) {
                return Response.json(
                  { id: canvasId, encrypted: true, locked: true },
                  { headers: storedObjectHeaders({ "Cache-Control": "no-store" }) }
                );
              }
              const manifest = sanitizePublicCanvasManifest(canvas);
              if (!manifest) return Response.json({ error: "Object not found" }, { status: 404 });
              const etag = manifestEtag(publicRaw);
              const headers = manifestHeaders(etag);
              if (matchesIfNoneMatch(request, etag)) {
                return new Response(null, { status: 304, headers });
              }
              return Response.json(manifest, {
                headers,
              });
            }
            const { raw: lockedRaw } = await readLockedCanvasRaw(canvasId, lockedCanvasKey);
            if (!lockedRaw) return Response.json({ error: "Object not found" }, { status: 404 });
            return Response.json(
              { id: canvasId, encrypted: true, locked: true },
              { headers: storedObjectHeaders({ "Cache-Control": "no-store" }) }
            );
          }

          if (
            !key.startsWith("images/") &&
            !key.startsWith("locked-images/") &&
            !key.startsWith("canvases/") &&
            !key.startsWith("previews/")
          ) {
            return Response.json({ error: "Invalid object key" }, { status: 400 });
          }
          if (!isSafeObjectKey(key)) {
            return Response.json({ error: "Invalid object key" }, { status: 400 });
          }
          const object = await getObjectResponse(key);
          return object ?? Response.json({ error: "Object not found" }, { status: 404 });
        } catch (error) {
          // Locked-key derivation throws when the storage secret is unconfigured;
          // surface a clean status instead of an unhandled framework 500.
          const message = error instanceof Error ? error.message : "Failed to read object";
          const status = /secret is not configured/i.test(message) ? 503 : 500;
          return Response.json({ error: status === 503 ? message : "Failed to read object" }, { status });
        }
      },

      DELETE: async ({ request }) => {
        if (!isSameOrigin(request)) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }
        const ip = getClientIp(request) ?? "unknown";
        const rate = await takeRateLimit(`share-delete:${ip}`, 10, 10 * 60 * 1000, {
          binding: RATE_LIMIT_BINDINGS.shareDelete,
        });
        if (!rate.ok) {
          return Response.json(
            { error: "Too many delete attempts. Try again shortly." },
            { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
          );
        }

        const url = new URL(request.url);
        const id = trimText(url.searchParams.get("id"), 80);
        const token =
          trimText(url.searchParams.get("token"), 200) ||
          trimText(request.headers.get("x-delete-token"), 200);

        if (!id || !token) {
          return Response.json({ error: "Missing board id or delete token" }, { status: 400 });
        }

        try {
          const { key: canvasKey, raw: storedRaw } = await readShareRawForDelete(id, lockedCanvasKey);
          if (!storedRaw) {
            return Response.json({ error: "Board not found" }, { status: 404 });
          }

          const parsed = parseStoredJson(storedRaw);
          const canvas: StoredCanvas | null = isEncryptedCanvas(parsed)
            ? parsed
            : sanitizePublicCanvasManifest(parsed);
          if (!canvas) return Response.json({ error: "Board not found" }, { status: 404 });
          if (!canvas.deleteTokenHash || canvas.deleteTokenHash !== hashToken(token)) {
            return Response.json({ error: "Invalid delete token" }, { status: 403 });
          }

          await deleteStoredCanvas({ id, canvasKey, canvas });

          return Response.json({ ok: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to delete board";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
