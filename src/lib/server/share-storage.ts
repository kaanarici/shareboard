import { deleteObject, getObjectKeyFromPublicUrlAsync, getObjectText, putObject } from "@/lib/r2";
import type { Canvas, EncryptedCanvasEnvelope, SharedCanvasItem } from "@/lib/types";

export function publicCanvasKey(id: string) {
  return `canvases/${id}.json`;
}

export function previewKey(id: string) {
  return `previews/${id}.png`;
}

export async function readPublicCanvasRaw(id: string): Promise<string | null> {
  return getObjectText(publicCanvasKey(id));
}

export async function readLockedCanvasRaw(
  id: string,
  getLockedKey: (id: string) => Promise<string>
): Promise<{ key: string; raw: string | null }> {
  const key = await getLockedKey(id);
  return { key, raw: await getObjectText(key) };
}

export async function readShareRawForDelete(
  id: string,
  getLockedKey: (id: string) => Promise<string>
): Promise<{ key: string; raw: string | null }> {
  const publicRaw = await readPublicCanvasRaw(id);
  if (publicRaw) {
    return { key: publicCanvasKey(id), raw: publicRaw };
  }
  return readLockedCanvasRaw(id, getLockedKey);
}

export async function writePublicCanvas(id: string, json: string, cacheControl: string) {
  return putObject(publicCanvasKey(id), json, cacheControl);
}

export async function writeLockedCanvas(lockedKey: string, json: string) {
  return putObject(lockedKey, json, "no-store");
}

export async function rollbackUploadedObjects(uploadedKeys: readonly string[]) {
  await Promise.all(uploadedKeys.map((key) => deleteObject(key).catch(() => undefined)));
}

export function computeReplaceCleanupKeys(priorKeys: readonly string[], nextKeys: ReadonlySet<string>): string[] {
  return priorKeys.filter((key) => !nextKeys.has(key));
}

export async function cleanupReplacedObjects(priorKeys: readonly string[], nextKeys: Iterable<string>) {
  const stale = computeReplaceCleanupKeys(priorKeys, new Set(nextKeys));
  await Promise.all(stale.map((key) => deleteObject(key).catch(() => undefined)));
}

export async function deleteObjectsStrict(keys: readonly string[]) {
  await Promise.all(keys.map((key) => deleteObject(key)));
}

export async function deletePreviewBestEffort(id: string) {
  await deleteObject(previewKey(id)).catch(() => undefined);
}

export async function collectPublicCanvasImageKeys(canvas: Canvas): Promise<string[]> {
  return (
    await Promise.all(
      canvas.pages
        .flatMap((page) => page.items)
        .filter((item): item is Extract<SharedCanvasItem, { type: "image" }> => item.type === "image")
        .map((item) => item.objectKey ?? getObjectKeyFromPublicUrlAsync(item.url))
    )
  ).filter((key): key is string => !!key);
}

export function collectLockedCanvasImageKeys(canvas: EncryptedCanvasEnvelope): string[] {
  return canvas.images.map((image) => image.key);
}
