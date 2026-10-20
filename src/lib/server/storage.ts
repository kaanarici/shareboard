import { isSafeObjectKey, objectUrl } from "@/lib/storage-keys";
import { getServerEnv, type Bucket } from "@/lib/server/env";
import { HttpError } from "@/lib/server/http";

type StorageBody = string | ArrayBuffer | ArrayBufferView;

export type WriteCondition = { kind: "absent" } | { kind: "etag"; etag: string };

class StorageUnavailableError extends HttpError {
  constructor() {
    super("Sharing storage is not configured", 503);
    this.name = "StorageUnavailableError";
  }
}

export interface StoredObject {
  bytes: ArrayBuffer;
  contentType: string;
  etag: string;
}

async function requireBucket(): Promise<Bucket> {
  const bucket = (await getServerEnv()).SHAREBOARD_R2;
  if (!bucket) throw new StorageUnavailableError();
  return bucket;
}

function assertSafeKey(key: string) {
  if (!isSafeObjectKey(key)) throw new Error("Invalid storage key");
}

export async function putObject(
  key: string,
  body: StorageBody,
  contentType: string,
  condition?: WriteCondition,
): Promise<boolean> {
  assertSafeKey(key);
  const bucket = await requireBucket();
  const onlyIf =
    condition?.kind === "absent"
      ? { etagDoesNotMatch: "*" }
      : condition?.kind === "etag"
        ? { etagMatches: condition.etag }
        : undefined;
  const written = await bucket.put(key, body, { httpMetadata: { contentType }, onlyIf });
  return written !== null;
}

export async function putPublicObject(key: string, body: StorageBody, contentType: string): Promise<string> {
  await putObject(key, body, contentType);
  return objectUrl(key);
}

export async function getObject(key: string): Promise<StoredObject | null> {
  assertSafeKey(key);
  const object = await (await requireBucket()).get(key);
  if (!object) return null;
  return {
    bytes: await object.arrayBuffer(),
    contentType: object.httpMetadata?.contentType || "application/octet-stream",
    etag: object.etag,
  };
}

export async function getObjectText(key: string): Promise<{ text: string; etag: string } | null> {
  const object = await getObject(key);
  return object ? { text: new TextDecoder().decode(object.bytes), etag: object.etag } : null;
}

export async function deleteObjects(keys: Iterable<string>): Promise<void> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return;
  unique.forEach(assertSafeKey);
  await (await requireBucket()).delete(unique);
}

export async function deleteObjectsQuietly(keys: Iterable<string>): Promise<void> {
  await deleteObjects(keys).catch(() => undefined);
}

export async function readJsonRecord<T>(key: string, parse: (text: string) => T | null): Promise<{ value: T; etag: string } | null> {
  const stored = await getObjectText(key);
  if (!stored) return null;
  const value = parse(stored.text);
  if (value === null) throw new HttpError("A stored record is unreadable", 500);
  return { value, etag: stored.etag };
}

export async function updateJsonRecord<T>(
  key: string,
  parse: (text: string) => T | null,
  change: (current: T | null) => T,
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await readJsonRecord(key, parse);
    const next = change(current?.value ?? null);
    const condition: WriteCondition = current ? { kind: "etag", etag: current.etag } : { kind: "absent" };
    if (await putObject(key, JSON.stringify(next), "application/json", condition)) return next;
  }
  throw new HttpError("Storage is busy. Try again.", 409);
}
