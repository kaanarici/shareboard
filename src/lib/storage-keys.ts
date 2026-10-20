const OBJECTS_PATH = "/api/objects";
const PUBLIC_PREFIXES = ["images/", "locked-images/", "previews/"];

export function isSafeObjectKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= 240 &&
    key.split("/").every((part) => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part) && !part.includes(".."))
  );
}

export function isPublicObjectKey(key: string): boolean {
  return isSafeObjectKey(key) && PUBLIC_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function isShareImageKey(key: string, boardId?: string): boolean {
  if (!isSafeObjectKey(key)) return false;
  return boardId === undefined ? key.startsWith("images/") : key.startsWith(`images/${boardId}/`);
}

export function isPreviewKey(key: string): boolean {
  return isSafeObjectKey(key) && key.startsWith("previews/");
}

export function objectUrl(key: string): string {
  return `${OBJECTS_PATH}?key=${encodeURIComponent(key)}`;
}

export function objectKeyFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url, "http://shareboard.local");
    if (parsed.origin !== "http://shareboard.local" || parsed.pathname !== OBJECTS_PATH) return null;
    const key = parsed.searchParams.get("key");
    return key && isSafeObjectKey(key) ? key : null;
  } catch {
    return null;
  }
}
