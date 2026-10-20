import { createFileRoute } from "@tanstack/react-router";
import { base64UrlToBytes } from "@/lib/crypto";
import { isHandoffStorageId } from "@/lib/handoff";
import { isRecord, parseJson, readRequestJson, readString } from "@/lib/json";
import { rateLimitResponse } from "@/lib/server/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/server/request";
import { errorResponse, HttpError, jsonResponse } from "@/lib/server/http";
import { deleteObjectsQuietly, getObjectText, putObject, type WriteCondition } from "@/lib/server/storage";
import { requireOwner } from "@/lib/server/owner";

export const HANDOFF_MAX_CIPHERTEXT_BYTES = 1.5 * 1024 * 1024;
const HANDOFF_TTL_MS = 60 * 60 * 1000;

const MAX_BODY_BYTES = Math.ceil((HANDOFF_MAX_CIPHERTEXT_BYTES * 4) / 3) + 2048;
const TOO_MANY = "Too many handoff attempts. Try again shortly.";

type Sealed = { ciphertext: string; iv: string; salt: string };
type StoredHandoff = { sealed: Sealed | null; expiresAt: number; etag: string };

export function handoffKey(storageId: string) {
  return `handoff/${storageId}.json`;
}

function base64UrlLength(value: unknown): number | null {
  const text = readString(value);
  if (!text || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    return base64UrlToBytes(text).byteLength;
  } catch {
    return null;
  }
}

function readSealed(value: Record<string, unknown>): Sealed | null {
  const { ciphertext, iv, salt } = value;
  if (typeof ciphertext !== "string" || typeof iv !== "string" || typeof salt !== "string") return null;
  const size = base64UrlLength(ciphertext);
  if (size === null || size > HANDOFF_MAX_CIPHERTEXT_BYTES) return null;
  if (base64UrlLength(iv) !== 12 || base64UrlLength(salt) !== 16) return null;
  return { ciphertext, iv, salt };
}

async function readStoredHandoff(storageId: string): Promise<StoredHandoff | null> {
  const stored = await getObjectText(handoffKey(storageId));
  if (!stored) return null;
  const value = parseJson(stored.text);
  if (!isRecord(value) || typeof value.expiresAt !== "number") return null;
  const sealed = value.tombstone === true ? null : readSealed(value);
  return { sealed, expiresAt: value.expiresAt, etag: stored.etag };
}

async function parseCreateBody(request: Request): Promise<{ storageId: string; sealed: Sealed }> {
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    throw new HttpError("Handoff is too large", 413);
  }
  const body = await readRequestJson(request, MAX_BODY_BYTES + 64 * 1024);
  if (!isRecord(body)) throw new HttpError("Invalid handoff payload", 400);
  const storageId = readString(body.storageId);
  if (!isHandoffStorageId(storageId)) throw new HttpError("Invalid storage id", 400);
  const size = base64UrlLength(body.ciphertext);
  if (size === null) throw new HttpError("Invalid ciphertext", 400);
  if (size > HANDOFF_MAX_CIPHERTEXT_BYTES) throw new HttpError("Handoff is too large", 413);
  const sealed = readSealed(body);
  if (base64UrlLength(body.iv) !== 12) throw new HttpError("Invalid iv", 400);
  if (!sealed) throw new HttpError("Invalid salt", 400);
  return { storageId, sealed };
}

export async function handleHandoffCreate(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonResponse({ error: "Forbidden" }, { status: 403 });
  const limited = await rateLimitResponse("handoff", `create:${clientIp(request)}`, TOO_MANY);
  if (limited) return limited;
  try {
    await requireOwner(request);
    const { storageId, sealed } = await parseCreateBody(request);
    const existing = await readStoredHandoff(storageId);
    if (existing?.sealed && existing.expiresAt > Date.now()) throw new HttpError("Handoff already exists", 409);
    const condition: WriteCondition = existing ? { kind: "etag", etag: existing.etag } : { kind: "absent" };
    const record = JSON.stringify({ v: 1, ...sealed, expiresAt: Date.now() + HANDOFF_TTL_MS });
    if (!(await putObject(handoffKey(storageId), record, "application/json", condition))) {
      throw new HttpError("Handoff already exists", 409);
    }
    return jsonResponse({}, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Failed to create handoff");
  }
}

export async function handleHandoffRead(request: Request): Promise<Response> {
  const limited = await rateLimitResponse("handoff", `read:${clientIp(request)}`, TOO_MANY);
  if (limited) return limited;
  const storageId = new URL(request.url).searchParams.get("id");
  if (!isHandoffStorageId(storageId)) return jsonResponse({ error: "Invalid handoff id" }, { status: 400 });
  const notFound = jsonResponse({ error: "Handoff not found" }, { status: 404 });
  try {
    const stored = await readStoredHandoff(storageId);
    if (!stored?.sealed) return notFound;
    if (stored.expiresAt <= Date.now()) {
      await deleteObjectsQuietly([handoffKey(storageId)]);
      return notFound;
    }
    const tombstone = JSON.stringify({ v: 1, tombstone: true, expiresAt: Date.now() + HANDOFF_TTL_MS });
    const claimed = await putObject(handoffKey(storageId), tombstone, "application/json", {
      kind: "etag",
      etag: stored.etag,
    });
    return claimed ? jsonResponse(stored.sealed) : notFound;
  } catch (error) {
    return errorResponse(error, "Failed to read handoff");
  }
}

export const Route = createFileRoute("/api/handoff")({
  server: {
    handlers: {
      POST: ({ request }) => handleHandoffCreate(request),
      GET: ({ request }) => handleHandoffRead(request),
    },
  },
});
