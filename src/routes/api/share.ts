import { randomBytes, createHash, pbkdf2, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createFileRoute } from "@tanstack/react-router";
import {
  deleteObject,
  getObjectKeyFromPublicUrlAsync,
  getObjectResponse,
  getObjectText,
  isSafeObjectKey,
  putBuffer,
  putObject,
} from "@/lib/r2";
import { takeRateLimit } from "@/lib/rate-limit";
import {
  SANITIZE_LIMITS,
  sanitizeAuthorProfile,
  sanitizeGeneration,
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
  maxPreviewBytes: 768 * 1024,
} as const;

type EncryptedSharePayload = Omit<EncryptedCanvasEnvelope, "deleteTokenHash">;

const MANIFEST_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";
const LOCKED_PIN_ITERATIONS = 100_000;
const pbkdf2Async = promisify(pbkdf2);

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

async function getRuntimeSecret() {
  try {
    const cf = await import(/* @vite-ignore */ "cloudflare:workers");
    const secret = String(cf.env?.SHAREBOARD_LOCKED_STORAGE_SECRET ?? "").trim();
    if (secret) return secret;
    if (!String(cf.env?.R2_PUBLIC_URL ?? "").trim()) return "shareboard-local-locked-storage";
  } catch {
    // Local preview falls back below.
  }
  const secret = String(process.env.SHAREBOARD_LOCKED_STORAGE_SECRET ?? "").trim();
  if (secret) return secret;
  if (!String(process.env.R2_PUBLIC_URL ?? "").trim()) return "shareboard-local-locked-storage";
  throw new Error("Locked share storage secret is not configured");
}

async function lockedCanvasKey(id: string) {
  const secret = await getRuntimeSecret();
  const digest = createHash("sha256").update(secret).update(":").update(id).digest("base64url");
  return `locked/${digest}.json`;
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

function getClientIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/**
 * Reject cross-origin browser requests. Same-origin browser calls always send
 * `Origin`; server-side callers (curl, scripts) usually omit it — we allow the
 * absent case so smoke tests still work. Shape: "https://shareboard.example".
 */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const expected = new URL(request.url).origin;
  return origin === expected;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function keepToken(value: unknown, max: number) {
  return typeof value === "string" && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value) ? value : "";
}

function cleanPin(value: unknown) {
  return typeof value === "string" ? value.replace(/\D/g, "").slice(0, 6) : "";
}

async function createPinVerifier(pin: string): Promise<NonNullable<EncryptedCanvasEnvelope["pinVerifier"]>> {
  const salt = randomBytes(16);
  const hash = await pbkdf2Async(pin, salt, LOCKED_PIN_ITERATIONS, 32, "sha256");
  return {
    kdf: "PBKDF2-SHA-256",
    iterations: LOCKED_PIN_ITERATIONS,
    salt: salt.toString("base64url"),
    hash: hash.toString("base64url"),
  };
}

async function verifyPin(pin: string, verifier: NonNullable<EncryptedCanvasEnvelope["pinVerifier"]>) {
  if (verifier.kdf !== "PBKDF2-SHA-256") return false;
  const expected = Buffer.from(verifier.hash, "base64url");
  const actual = await pbkdf2Async(
    pin,
    Buffer.from(verifier.salt, "base64url"),
    verifier.iterations,
    expected.byteLength,
    "sha256"
  );
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}

function parsePayload(raw: string | undefined): ShareRequestPayload {
  if (!raw) badRequest("Missing payload");
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
  const pin = cleanPin(body.pin);
  return id && pin.length === 6 ? { id, pin } : null;
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

/** Counters shared across pages to enforce board-wide image caps. */
type ImageCounters = { count: number; bytes: number };

type StoredImageItem = Extract<SharedCanvasItem, { type: "image" }>;

async function buildSharedItems(
  canvasId: string,
  pageId: string,
  rawItems: ShareRequestItem[],
  files: Map<string, File>,
  uploadedKeys: string[],
  counters: ImageCounters,
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

    if (item.type === "image") {
      counters.count += 1;
      if (counters.count > SHARE_LIMITS.maxImages) {
        badRequest(`Too many images (max ${SHARE_LIMITS.maxImages})`);
      }

      const sanitized: ShareRequestImageItem = item;
      const file = files.get(sanitized.id);

      if (!file && reuseImagesById?.has(sanitized.id)) {
        const reused = reuseImagesById.get(sanitized.id)!;
        counters.bytes += reused.size ?? 0;
        if (counters.bytes > SHARE_LIMITS.maxTotalImageBytes) {
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

      counters.bytes += file.size;
      if (counters.bytes > SHARE_LIMITS.maxTotalImageBytes) {
        badRequest(`Images exceed ${Math.floor(SHARE_LIMITS.maxTotalImageBytes / 1024 / 1024)} MB total`);
      }

      const key = `images/${canvasId}/${pageId}/${sanitized.id}`;
      if (!isSafeObjectKey(key)) badRequest("Invalid image id");
      const bytes = Buffer.from(await file.arrayBuffer());
      const mimeType = file.type || sanitized.mimeType || "application/octet-stream";
      const url = await putBuffer(key, bytes, mimeType, "public, max-age=31536000, immutable");
      uploadedKeys.push(key);
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

/** Walk a Canvas's images, indexed by item id — used by the replace flow to skip re-uploading unchanged images. */
function indexCanvasImages(canvas: Canvas): Map<string, StoredImageItem> {
  const map = new Map<string, StoredImageItem>();
  for (const page of canvas.pages) {
    for (const item of page.items) {
      if (item.type === "image") map.set(item.id, item);
    }
  }
  return map;
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
  const url = await putBuffer(key, bytes, "image/png", "public, max-age=31536000, immutable");
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
  const counters: ImageCounters = { count: 0, bytes: 0 };
  const pages: SharedBoardPage[] = [];

  for (const page of rawPages) {
    const items = await buildSharedItems(canvasId, page.id, page.items, files, uploadedKeys, counters, reuseImagesById);
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
        const ip = getClientIp(request);
        const contentType = request.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          try {
            const unlock = parseUnlockRequest(await request.json().catch(() => null));
            if (!unlock) {
              return Response.json({ error: "Invalid request" }, { status: 400 });
            }
            const { id, pin } = unlock;
            const rate = takeRateLimit(`share-unlock:${id}:${ip}`, 5, 10 * 60 * 1000);
            const globalRate = takeRateLimit(`share-unlock-board:${id}`, 30, 10 * 60 * 1000);
            if (!rate.ok || !globalRate.ok) {
              return Response.json(
                { error: "Too many unlock attempts. Try again shortly." },
                { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds || globalRate.retryAfterSeconds) } }
              );
            }

            const raw = await getObjectText(await lockedCanvasKey(id));
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

        const rate = takeRateLimit(`share:${ip}`, 20, 10 * 60 * 1000);
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
            const pin = cleanPin(form.get("pin"));
            if (pin.length !== 6) badRequest("Invalid PIN");
            const lockedKey = await lockedCanvasKey(payload.id);
            const existing = await getObjectText(lockedKey);

            let priorImageKeys: string[] = [];
            if (isReplace) {
              if (replaceId !== payload.id) badRequest("Replace id mismatch");
              if (!existing) throw new ShareError("Share not found", 404);
              const priorParsed = parseStoredJson(existing);
              if (!isEncryptedCanvas(priorParsed)) throw new ShareError("Share not found", 404);
              if (!priorParsed.deleteTokenHash || priorParsed.deleteTokenHash !== hashToken(replaceToken)) {
                throw new ShareError("Invalid replace token", 403);
              }
              priorImageKeys = priorParsed.images.map((img) => img.key);
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
                  "public, max-age=31536000, immutable"
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
            await putObject(lockedKey, JSON.stringify(canvas), "no-store");
            if (isReplace) {
              const newKeys = new Set(images.map((img) => img.key));
              await Promise.all(
                priorImageKeys
                  .filter((key) => !newKeys.has(key))
                  .map((key) => deleteObject(key).catch(() => undefined))
              );
            }
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
            const canvasKey = `canvases/${replaceId}.json`;
            const priorRaw = await getObjectText(canvasKey);
            if (!priorRaw) throw new ShareError("Share not found", 404);
            const priorParsed = parseStoredJson(priorRaw);
            const priorCanvas = sanitizePublicCanvasManifest(priorParsed);
            if (!priorCanvas) throw new ShareError("Share not found", 404);
            if (!priorCanvas.deleteTokenHash || priorCanvas.deleteTokenHash !== hashToken(replaceToken)) {
              throw new ShareError("Invalid replace token", 403);
            }
            id = replaceId;
            reuseImages = indexCanvasImages(priorCanvas);
            priorImageKeys = Array.from(reuseImages.values())
              .map((img) => img.objectKey)
              .filter((key): key is string => !!key);
            priorPreviewUrl = priorCanvas.previewUrl;
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
            generation: sanitizeGeneration(payload.generation),
            createdAt: new Date().toISOString(),
            deleteTokenHash: hashToken(deleteToken),
            ...(previewUrl ? { previewUrl } : {}),
          };

          await putObject(`canvases/${id}.json`, JSON.stringify(canvas), MANIFEST_CACHE_CONTROL);

          if (isReplace) {
            const newKeys = new Set<string>();
            for (const page of pages) {
              for (const item of page.items) {
                if (item.type === "image" && item.objectKey) newKeys.add(item.objectKey);
              }
            }
            await Promise.all(
              priorImageKeys
                .filter((key) => !newKeys.has(key))
                .map((key) => deleteObject(key).catch(() => undefined))
            );
          }

          return Response.json({ id, deleteToken } satisfies ShareCreateResponse);
        } catch (error) {
          await Promise.all(uploadedKeys.map((key) => deleteObject(key).catch(() => undefined)));
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
        const url = new URL(request.url);
        const key = trimText(url.searchParams.get("key"), 4096);
        const canvasId = key.match(/^canvases\/([A-Za-z0-9_-]+)\.json$/)?.[1];
        if (canvasId) {
          const publicRaw = await getObjectText(key);
          if (publicRaw) {
            const canvas = parseStoredJson(publicRaw);
            if (isEncryptedCanvas(canvas)) {
              return Response.json(
                { id: canvasId, encrypted: true, locked: true },
                { headers: { "Cache-Control": "no-store" } }
              );
            }
            const manifest = sanitizePublicCanvasManifest(canvas);
            if (!manifest) return Response.json({ error: "Object not found" }, { status: 404 });
            return Response.json(manifest, {
              headers: { "Content-Type": "application/json", "Cache-Control": MANIFEST_CACHE_CONTROL },
            });
          }
          const lockedRaw = await getObjectText(await lockedCanvasKey(canvasId));
          if (!lockedRaw) return Response.json({ error: "Object not found" }, { status: 404 });
          return Response.json(
            { id: canvasId, encrypted: true, locked: true },
            { headers: { "Cache-Control": "no-store" } }
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
      },

      DELETE: async ({ request }) => {
        if (!isSameOrigin(request)) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }
        const ip = getClientIp(request);
        const rate = takeRateLimit(`share-delete:${ip}`, 10, 10 * 60 * 1000);
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
          const raw = await getObjectText(`canvases/${id}.json`);
          const canvasKey = raw ? `canvases/${id}.json` : await lockedCanvasKey(id);
          const storedRaw = raw ?? (await getObjectText(canvasKey));
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

          const keys =
            "images" in canvas
              ? canvas.images.map((image) => image.key)
              : (
                  await Promise.all(
                    canvas.pages
                      .flatMap((page) => page.items)
                      .filter((item): item is Extract<SharedCanvasItem, { type: "image" }> => item.type === "image")
                      .map((item) => item.objectKey ?? getObjectKeyFromPublicUrlAsync(item.url))
                  )
                ).filter((key): key is string => !!key);

          await Promise.all(keys.map((key) => deleteObject(key)));
          await deleteObject(canvasKey);
          if (!("images" in canvas)) {
            await deleteObject(`previews/${id}.png`).catch(() => undefined);
          }

          return Response.json({ ok: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to delete board";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
