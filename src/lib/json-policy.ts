import { formatBytes } from "@/lib/image-policy";
import { LIMITS } from "@/lib/limits";
import type { JsonItem } from "@/lib/types";

const encoder = new TextEncoder();

export function isJsonFile(file: File) {
  return file.type === "application/json" || /\.json$/i.test(file.name);
}

export async function jsonItemFromFile(file: File, id: string): Promise<JsonItem> {
  if (!isJsonFile(file)) throw new Error("Only .json files can be added as JSON");
  if (file.size > LIMITS.maxJsonFileBytes) {
    throw new Error(`JSON files must be under ${formatBytes(LIMITS.maxJsonFileBytes)}`);
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
  if (size > LIMITS.maxJsonFileBytes) {
    throw new Error(`JSON files must be under ${formatBytes(LIMITS.maxJsonFileBytes)} after formatting`);
  }

  const name = (file.name || "data.json").trim().slice(0, LIMITS.maxLabelChars) || "data.json";
  return { id, type: "json", name, text, size };
}
