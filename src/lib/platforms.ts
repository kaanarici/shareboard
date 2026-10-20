import type { Platform } from "./types";

const PLATFORM_HOSTS: ReadonlyArray<readonly [Platform, readonly string[]]> = [
  ["twitter", ["twitter.com", "x.com"]],
  ["linkedin", ["linkedin.com"]],
  ["instagram", ["instagram.com"]],
  ["youtube", ["youtube.com", "youtu.be"]],
  ["reddit", ["reddit.com"]],
  ["threads", ["threads.net"]],
  ["facebook", ["facebook.com", "fb.com"]],
  ["tiktok", ["tiktok.com"]],
];

export function detectPlatform(url: string): Platform {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "website";
  }
  const match = PLATFORM_HOSTS.find(([, hosts]) => hosts.some((name) => host === name || host.endsWith(`.${name}`)));
  return match?.[0] ?? "website";
}

export function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
