import { createFileRoute } from "@tanstack/react-router";
import { base64UrlToBytes } from "@/lib/encrypted-share";
import { isHandoffStorageId } from "@/lib/handoff";
import {
  deleteObject,
  getObjectResponse,
  isSafeObjectKey,
  putBuffer,
  storedObjectHeaders,
} from "@/lib/r2";
import { takeRateLimit } from "@/lib/rate-limit";
import { getClientIp, isSameOrigin } from "@/lib/server/request";

export const HANDOFF_MAX_CIPHERTEXT_BYTES = 1.5 * 1024 * 1024;
export const HANDOFF_MAX_TTL_MS = 60 * 60 * 1000;

const HANDOFF_CREATE_LIMIT = { count: 10, windowMs: 10 * 60 * 1000 };
const HANDOFF_READ_LIMIT = { count: 60, windowMs: 10 * 60 * 1000 };
const HANDOFF_MAX_BODY_BYTES = Math.ceil(HANDOFF_MAX_CIPHERTEXT_BYTES * 4 / 3) + 2048;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

type StoredHandoff = {
  v: 1;
  ciphertext: string;
  iv: string;
  salt: string;
  expiresAt: number;
};

type ParsedCreateBody = {
  storageId: string;
  handoff: StoredHandoff;
};

class HandoffError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "HandoffError";
  }
}

function json(body: unknown, init: ResponseInit = {}) {
  const headers = storedObjectHeaders({ "Cache-Control": "no-store" });
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  return Response.json(body, { ...init, headers });
}

function handoffKey(storageId: string) {
  return `handoff/${storageId}.json`;
}

function readBase64Url(value: unknown) {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value)) return null;
  try {
    return base64UrlToBytes(value);
  } catch {
    return null;
  }
}

function decodeBase64Url(value: unknown, field: string) {
  const bytes = readBase64Url(value);
  if (!bytes) throw new HandoffError(`Invalid ${field}`, 400);
  return bytes;
}

function parseStoredHandoff(raw: string | null): StoredHandoff | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredHandoff>;
    const ciphertextBytes = readBase64Url(parsed.ciphertext);
    const ivBytes = readBase64Url(parsed.iv);
    const saltBytes = readBase64Url(parsed.salt);
    const expiresAt = Number(parsed.expiresAt);
    if (
      parsed.v !== 1 ||
      typeof parsed.ciphertext !== "string" ||
      typeof parsed.iv !== "string" ||
      typeof parsed.salt !== "string" ||
      !Number.isFinite(expiresAt) ||
      !ciphertextBytes ||
      ciphertextBytes.byteLength > HANDOFF_MAX_CIPHERTEXT_BYTES ||
      ivBytes?.byteLength !== 12 ||
      saltBytes?.byteLength !== 16
    ) {
      return null;
    }
    return {
      v: 1,
      ciphertext: parsed.ciphertext,
      iv: parsed.iv,
      salt: parsed.salt,
      expiresAt: Math.floor(expiresAt),
    };
  } catch {
    return null;
  }
}

async function readStoredHandoff(storageId: string) {
  if (!isHandoffStorageId(storageId)) return null;
  const object = await getObjectResponse(handoffKey(storageId));
  return parseStoredHandoff(object ? await object.text() : null);
}

function parseStorageId(request: Request) {
  const storageId = new URL(request.url).searchParams.get("id");
  return isHandoffStorageId(storageId) ? storageId : null;
}

async function parseCreateBody(request: Request): Promise<ParsedCreateBody> {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > HANDOFF_MAX_BODY_BYTES) {
    throw new HandoffError("Handoff is too large", 413);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw new HandoffError("Invalid handoff payload", 400);
  }

  const payload = body as Record<string, unknown>;
  const storageId = payload.storageId;
  if (!isHandoffStorageId(storageId)) {
    throw new HandoffError("Invalid storage id", 400);
  }
  const key = handoffKey(storageId);
  if (!isSafeObjectKey(key)) {
    throw new HandoffError("Invalid storage id", 400);
  }

  const ciphertext = payload.ciphertext;
  if (typeof ciphertext !== "string" || ciphertext.length > HANDOFF_MAX_BODY_BYTES) {
    throw new HandoffError("Handoff is too large", 413);
  }
  const ciphertextBytes = decodeBase64Url(ciphertext, "ciphertext");
  if (ciphertextBytes.byteLength > HANDOFF_MAX_CIPHERTEXT_BYTES) {
    throw new HandoffError("Handoff is too large", 413);
  }

  const iv = payload.iv;
  if (decodeBase64Url(iv, "iv").byteLength !== 12) {
    throw new HandoffError("Invalid iv", 400);
  }

  const salt = payload.salt;
  if (decodeBase64Url(salt, "salt").byteLength !== 16) {
    throw new HandoffError("Invalid salt", 400);
  }

  const requestedTtl = payload.expiresInMs === undefined
    ? HANDOFF_MAX_TTL_MS
    : Number(payload.expiresInMs);
  if (!Number.isFinite(requestedTtl) || requestedTtl <= 0) {
    throw new HandoffError("Invalid expiry", 400);
  }

  return {
    storageId,
    handoff: {
      v: 1,
      ciphertext,
      iv: iv as string,
      salt: salt as string,
      expiresAt: Date.now() + Math.min(Math.floor(requestedTtl), HANDOFF_MAX_TTL_MS),
    },
  };
}

// Zero-knowledge invariant: the server receives only a hash-derived storage ID,
// ciphertext, IV, and salt. The typeable code never crosses this route.
export const Route = createFileRoute("/api/handoff")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOrigin(request)) {
          return json({ error: "Forbidden" }, { status: 403 });
        }

        const ip = getClientIp(request) ?? "unknown";
        const rate = await takeRateLimit(
          `handoff-create:${ip}`,
          HANDOFF_CREATE_LIMIT.count,
          HANDOFF_CREATE_LIMIT.windowMs
        );
        if (!rate.ok) {
          return json(
            { error: "Too many handoff attempts. Try again shortly." },
            { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
          );
        }

        try {
          const { storageId, handoff } = await parseCreateBody(request);
          const key = handoffKey(storageId);
          const existing = await readStoredHandoff(storageId);
          if (existing && existing.expiresAt > Date.now()) {
            throw new HandoffError("Handoff already exists", 409);
          }
          if (existing) await deleteObject(key).catch(() => undefined);
          await putBuffer(key, JSON.stringify(handoff), "application/json", "no-store");
          return json({}, { status: 201 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to create handoff";
          const status = error instanceof HandoffError
            ? error.status
            : message === "Sharing storage is not configured"
              ? 503
              : 500;
          return json({ error: message }, { status });
        }
      },

      GET: async ({ request }) => {
        const ip = getClientIp(request) ?? "unknown";
        const rate = await takeRateLimit(
          `handoff-read:${ip}`,
          HANDOFF_READ_LIMIT.count,
          HANDOFF_READ_LIMIT.windowMs
        );
        if (!rate.ok) {
          return json(
            { error: "Too many handoff attempts. Try again shortly." },
            { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
          );
        }

        const storageId = parseStorageId(request);
        if (!storageId) return json({ error: "Invalid handoff id" }, { status: 400 });

        try {
          const key = handoffKey(storageId);
          const handoff = await readStoredHandoff(storageId);
          if (!handoff) {
            return json({ error: "Handoff not found" }, { status: 404 });
          }
          if (handoff.expiresAt <= Date.now()) {
            await deleteObject(key).catch(() => undefined);
            return json({ error: "Handoff not found" }, { status: 404 });
          }

          await deleteObject(key);
          return json({ ciphertext: handoff.ciphertext, iv: handoff.iv, salt: handoff.salt });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to read handoff";
          const status = message === "Sharing storage is not configured" ? 503 : 500;
          return json({ error: message }, { status });
        }
      },
    },
  },
});
