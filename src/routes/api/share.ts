import { createFileRoute } from "@tanstack/react-router";
import { readTrimmed } from "@/lib/json";
import { keepShareId } from "@/lib/locked-envelope";
import { LIMITS } from "@/lib/limits";
import { rateLimitResponse } from "@/lib/server/rate-limit";
import { clientIp, isSameOrigin, readBoundedFormData } from "@/lib/server/request";
import { badRequest, errorResponse, HttpError, jsonResponse } from "@/lib/server/http";
import { deleteObjectsQuietly } from "@/lib/server/storage";
import { requireOwner } from "@/lib/server/owner";
import { createPinVerifier, lockedManifestKey } from "@/lib/server/locked-share";
import {
  buildSharedPages,
  createShareId,
  filesWithPrefix,
  parseEncryptedPayload,
  parseSharePayload,
  readPin,
  reusableImages,
  uploadLockedImages,
  uploadPreview,
} from "@/lib/server/share-build";
import {
  boardObjectKeys,
  commitShare,
  deleteShare,
  lockedManifestJson,
  publicManifestJson,
  publicManifestKey,
  readLockedShare,
  readPublicShare,
  readShare,
  type ShareRecord,
} from "@/lib/server/share-store";
import type { Board, ShareCreateResponse } from "@/lib/types";

const MAX_SHARE_REQUEST_BYTES = LIMITS.maxBoardImageBytes + 4 * 1024 * 1024;

function readReplaceId(form: FormData): string | null {
  return keepShareId(form.get("replaceId")) || null;
}

function existing<T extends ShareRecord>(record: T | null): T {
  if (!record) throw new HttpError("Share not found", 404);
  return record;
}

async function createLockedShare(form: FormData, replaceId: string | null, uploadedKeys: string[]): Promise<ShareCreateResponse> {
  const envelope = parseEncryptedPayload(form.get("encryptedPayload")?.toString());
  const pin = readPin(form.get("pin"));
  if (!pin) badRequest("Invalid PIN");
  if (replaceId && replaceId !== envelope.id) badRequest("Replace id mismatch");

  const prior = replaceId ? existing(await readLockedShare(replaceId)) : undefined;
  if (!prior && (await readPublicShare(envelope.id))) throw new HttpError("Share id already exists", 409);
  const images = await uploadLockedImages(envelope, filesWithPrefix(form, "encrypted-image:"), uploadedKeys);
  const next = { ...envelope, images };
  await commitShare({
    key: prior?.key ?? (await lockedManifestKey(envelope.id)),
    json: lockedManifestJson(next, await createPinVerifier(pin)),
    nextObjectKeys: new Set(images.map((image) => image.key)),
    prior,
  });
  return { id: envelope.id };
}

async function createPublicShare(form: FormData, replaceId: string | null, uploadedKeys: string[]): Promise<ShareCreateResponse> {
  const payload = parseSharePayload(form.get("payload")?.toString());
  const prior = replaceId ? existing(await readPublicShare(replaceId)) : undefined;
  const id = prior?.id ?? createShareId();
  const reusable = prior ? reusableImages(prior.board, form) : new Map();
  const pages = await buildSharedPages(id, payload, filesWithPrefix(form, "image:"), reusable, uploadedKeys);
  const previewUrl = (await uploadPreview(id, form.get("preview"), uploadedKeys)) ?? prior?.board.previewUrl;
  const board: Board = {
    id,
    author: readTrimmed(payload.author, LIMITS.maxAuthorChars) || "Anonymous",
    pages,
    createdAt: new Date().toISOString(),
  };
  if (payload.authorProfile) board.authorProfile = payload.authorProfile;
  if (previewUrl) board.previewUrl = previewUrl;

  await commitShare({
    key: publicManifestKey(id),
    json: publicManifestJson(board),
    nextObjectKeys: boardObjectKeys(board),
    prior,
  });
  return { id };
}

export async function handleShareCreate(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonResponse({ error: "Forbidden" }, { status: 403 });
  if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    return jsonResponse({ error: "Invalid request" }, { status: 400 });
  }
  const limited = await rateLimitResponse("shareCreate", clientIp(request), "Too many share attempts. Try again shortly.");
  if (limited) return limited;

  const uploadedKeys: string[] = [];
  try {
    await requireOwner(request);
    const form = await readBoundedFormData(request, MAX_SHARE_REQUEST_BYTES);
    const replaceId = readReplaceId(form);
    const created = form.has("encryptedPayload")
      ? await createLockedShare(form, replaceId, uploadedKeys)
      : await createPublicShare(form, replaceId, uploadedKeys);
    return jsonResponse(created);
  } catch (error) {
    await deleteObjectsQuietly(uploadedKeys);
    return errorResponse(error, "Failed to share board");
  }
}

export async function handleShareDelete(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonResponse({ error: "Forbidden" }, { status: 403 });
  const limited = await rateLimitResponse("shareDelete", clientIp(request), "Too many delete attempts. Try again shortly.");
  if (limited) return limited;

  const id = keepShareId(new URL(request.url).searchParams.get("id"));
  if (!id) return jsonResponse({ error: "Missing board id" }, { status: 400 });

  try {
    await requireOwner(request);
    const record = await readShare(id);
    if (!record) return jsonResponse({ error: "Board not found" }, { status: 404 });
    await deleteShare(record);
    return jsonResponse({ ok: true });
  } catch (error) {
    return errorResponse(error, "Failed to delete board");
  }
}

export const Route = createFileRoute("/api/share")({
  server: {
    handlers: {
      POST: ({ request }) => handleShareCreate(request),
      DELETE: ({ request }) => handleShareDelete(request),
    },
  },
});
