export function isSafeObjectKey(key: string): boolean {
  return (
    !!key &&
    !key.includes("..") &&
    !key.startsWith("/") &&
    !key.includes("\\") &&
    key.split("/").every((part) => /^[A-Za-z0-9_.-]+$/.test(part))
  );
}

export function keepObjectKey(value: unknown, max = 240): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim().slice(0, max);
  return isSafeObjectKey(key) ? key : null;
}

export function isShareImageObjectKey(key: string): boolean {
  return key.startsWith("images/") || key.startsWith("locked-images/");
}

export function getLocalShareObjectKey(url: string): string | null {
  try {
    const parsed = new URL(url, "http://local.shareboard");
    if (parsed.origin !== "http://local.shareboard") return null;
    if (parsed.pathname !== "/api/share") return null;
    const key = parsed.searchParams.get("key");
    return key && isSafeObjectKey(key) ? key : null;
  } catch {
    return null;
  }
}
