import { LIMITS } from "@/lib/limits";
import { isRecord, parseJson, readString } from "@/lib/json";
import { verifiedRasterMime } from "@/lib/image-mime";
import { isSafeObjectKey } from "@/lib/storage-keys";
import { deleteObjectsQuietly, getObject, getObjectText, putObject } from "@/lib/server/storage";

const INTAKE_TTL_MS = 60 * 60 * 1000;
const INTAKE_FILE_FIELD = "media";

type IntakeFile = { name: string; type: string; key: string };
export type IntakeManifest = { expiresAt: number; files: IntakeFile[] };

export function keepIntakeId(id: string): string | null {
  return /^[A-Za-z0-9_-]{16,80}$/.test(id) ? id : null;
}

const INTAKE_COOKIE = "shareboard_intake";

export function intakeCookie(id: string, maxAgeSeconds: number): string {
  return `${INTAKE_COOKIE}=${id}; Path=/api/intake; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function intakeOwnedBy(request: Request, id: string): boolean {
  const cookies = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim());
  return cookies.includes(`${INTAKE_COOKIE}=${id}`);
}

export function intakeManifestKey(id: string) {
  return `intake/${id}.json`;
}

export async function storeIntakeFiles(id: string, files: File[]): Promise<IntakeManifest> {
  if (files.length > LIMITS.maxImages) throw new Error("Too many intake files");
  const records: IntakeFile[] = [];
  let totalBytes = 0;
  try {
    for (const [index, file] of files.entries()) {
      if (file.size === 0 || file.size > LIMITS.maxImageBytes) continue;
      totalBytes += file.size;
      if (totalBytes > LIMITS.maxBoardImageBytes) throw new Error("Intake files are too large");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const type = verifiedRasterMime(bytes, file.type);
      if (!type) continue;
      const record = { name: file.name || `shared-image-${index + 1}`, type, key: `intake/${id}/${records.length}` };
      records.push(record);
      await putObject(record.key, bytes, type);
    }
    const manifest: IntakeManifest = { expiresAt: Date.now() + INTAKE_TTL_MS, files: records };
    if (records.length > 0) {
      await putObject(intakeManifestKey(id), JSON.stringify(manifest), "application/json", { kind: "absent" });
    }
    return manifest;
  } catch (error) {
    await deleteObjectsQuietly(records.map((record) => record.key));
    throw error;
  }
}

async function readIntake(id: string): Promise<(IntakeManifest & { etag: string }) | null> {
  const stored = await getObjectText(intakeManifestKey(id));
  const value = stored ? parseJson(stored.text) : null;
  if (!stored || !isRecord(value) || typeof value.expiresAt !== "number" || !Array.isArray(value.files)) return null;
  const files = value.files.flatMap((file): IntakeFile[] => {
    if (!isRecord(file)) return [];
    const key = readString(file.key);
    if (!key || !isSafeObjectKey(key) || !key.startsWith(`intake/${id}/`)) return [];
    return [{ name: readString(file.name) || "shared-image", type: readString(file.type) || "image/png", key }];
  });
  return { expiresAt: value.expiresAt, files, etag: stored.etag };
}

export async function consumeIntake(id: string): Promise<FormData | null> {
  const stored = await readIntake(id);
  if (!stored) return null;
  const claimed = await putObject(intakeManifestKey(id), JSON.stringify({ claimed: true }), "application/json", {
    kind: "etag",
    etag: stored.etag,
  });
  if (!claimed) return null;
  try {
    if (stored.expiresAt <= Date.now()) return null;
    const form = new FormData();
    for (const file of stored.files) {
      const object = await getObject(file.key);
      if (object) form.append(INTAKE_FILE_FIELD, new File([object.bytes], file.name, { type: file.type }));
    }
    return form.has(INTAKE_FILE_FIELD) ? form : null;
  } finally {
    await deleteObjectsQuietly([intakeManifestKey(id), ...stored.files.map((file) => file.key)]);
  }
}

export async function deleteIntake(id: string): Promise<void> {
  const stored = await readIntake(id);
  await deleteObjectsQuietly([intakeManifestKey(id), ...(stored?.files.map((file) => file.key) ?? [])]);
}
