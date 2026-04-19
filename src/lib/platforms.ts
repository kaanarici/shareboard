import type { Platform } from "./types";

const PLATFORM_PATTERNS: [RegExp, Platform][] = [
  [/(?:twitter\.com|x\.com)/i, "twitter"],
  [/linkedin\.com/i, "linkedin"],
  [/instagram\.com/i, "instagram"],
  [/(?:youtube\.com|youtu\.be)/i, "youtube"],
  [/reddit\.com/i, "reddit"],
  [/threads\.net/i, "threads"],
  [/facebook\.com|fb\.com/i, "facebook"],
  [/tiktok\.com/i, "tiktok"],
];

export function detectPlatform(url: string): Platform {
  for (const [pattern, platform] of PLATFORM_PATTERNS) {
    if (pattern.test(url)) return platform;
  }
  return "website";
}

export function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
