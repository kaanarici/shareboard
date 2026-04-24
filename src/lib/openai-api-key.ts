const OPENAI_KEY_PATTERN = /sk-[a-zA-Z0-9._-]+/;

/**
 * Strips copy/paste noise: quotes, `export`, `.env` / `KEY=value` lines, and extracts
 * the first `sk-…` OpenAI-style token.
 */
export function sanitizeOpenaiApiKeyInput(raw: string): string {
  if (!raw) return "";
  const firstLine = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  let s = (firstLine ?? raw.trim()).trim();
  s = s.replace(/^\s*export\s+/i, "").trim();
  if (s.includes("=")) {
    s = s.slice(s.indexOf("=") + 1).trim();
  }
  for (let i = 0; i < 4; i++) {
    if (s.length < 2) break;
    const a = s[0]!;
    const b = s[s.length - 1]!;
    if (a === b && (a === '"' || a === "'" || a === "`")) {
      s = s.slice(1, -1).trim();
      continue;
    }
    break;
  }
  const extracted = s.match(OPENAI_KEY_PATTERN);
  if (extracted) return extracted[0]!;
  return s.trim();
}

/** Enough shape to show a "key looks set" checkmark (not cryptographic validation). */
export function isPlausibleOpenaiApiKey(s: string): boolean {
  if (!s) return false;
  return /^sk-[a-zA-Z0-9._-]{20,}$/.test(s);
}
