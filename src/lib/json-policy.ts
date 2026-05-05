import { formatBytes } from "@/lib/image-policy";
import type { JsonItem } from "@/lib/types";

export const JSON_POLICY = {
  maxFileBytes: 256 * 1024,
  maxBoardBytes: 2 * 1024 * 1024,
  maxNameChars: 120,
} as const;

const encoder = new TextEncoder();

export function isJsonFile(file: File) {
  return file.type === "application/json" || /\.json$/i.test(file.name);
}

export function jsonBytesForItems(items: readonly { type: string; size?: number }[]) {
  return items.reduce((sum, item) => sum + (item.type === "json" ? item.size ?? 0 : 0), 0);
}

export async function jsonItemFromFile(file: File, id: string): Promise<JsonItem> {
  if (!isJsonFile(file)) throw new Error("Only .json files can be added as JSON");
  if (file.size > JSON_POLICY.maxFileBytes) {
    throw new Error(`JSON files must be under ${formatBytes(JSON_POLICY.maxFileBytes)}`);
  }

  const raw = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("That file is not valid JSON");
  }

  const text = JSON.stringify(parsed, null, 2);
  const size = encoder.encode(text).byteLength;
  if (size > JSON_POLICY.maxFileBytes) {
    throw new Error(`JSON files must be under ${formatBytes(JSON_POLICY.maxFileBytes)} after formatting`);
  }

  const name = (file.name || "data.json").trim().slice(0, JSON_POLICY.maxNameChars) || "data.json";
  return { id, type: "json", name, text, size };
}
