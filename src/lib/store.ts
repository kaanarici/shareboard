import { sanitizeAuthorProfile } from "@/lib/canvas-sanitize";
import { parseJson } from "@/lib/json";
import type { AuthorProfile } from "@/lib/types";

const KEYS = {
  name: "shareboard_name",
  profile: "shareboard_profile",
} as const;

export type ProfileDraft = { name: string; xUrl: string; instagramUrl: string; linkedinUrl: string };

export const EMPTY_PROFILE_DRAFT: ProfileDraft = { name: "", xUrl: "", instagramUrl: "", linkedinUrl: "" };

function getName(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(KEYS.name) ?? "";
}

function getProfile(): AuthorProfile {
  if (typeof window === "undefined") return {};
  const raw = localStorage.getItem(KEYS.profile);
  if (!raw) return {};
  return sanitizeAuthorProfile(parseJson(raw)) ?? {};
}

export function currentAuthor(): { author: string; authorProfile: AuthorProfile } {
  return { author: getName(), authorProfile: getProfile() };
}

export function isSetup(): boolean {
  return !!getName().trim();
}

export function readProfileDraft(): ProfileDraft {
  const profile = getProfile();
  return {
    name: getName(),
    xUrl: profile.xUrl ?? "",
    instagramUrl: profile.instagramUrl ?? "",
    linkedinUrl: profile.linkedinUrl ?? "",
  };
}

function withScheme(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, "")}`;
}

export function saveProfileDraft(draft: ProfileDraft) {
  const name = draft.name.trim();
  if (name) localStorage.setItem(KEYS.name, name);
  const profile: AuthorProfile = {};
  for (const field of ["xUrl", "instagramUrl", "linkedinUrl"] as const) {
    const url = withScheme(draft[field]);
    if (url) profile[field] = url;
  }
  if (Object.keys(profile).length === 0) {
    localStorage.removeItem(KEYS.profile);
  } else {
    localStorage.setItem(KEYS.profile, JSON.stringify(profile));
  }
}
