import { isValidUrl } from "./platforms";

export type ShareParams = { title?: string; text?: string; url?: string };

export type ShareIntake =
  | { kind: "url"; url: string }
  | { kind: "note"; text: string }
  | null;

// Android share sheets frequently bury the link inside the text payload rather
// than the dedicated url field, so fall back to scanning text for one.
function firstHttpUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match && isValidUrl(match[0]) ? match[0] : null;
}

// Decide what a PWA share-target payload becomes on the canvas: a URL card when
// an http(s) link is supplied (explicitly or inside text), otherwise a note.
export function resolveShareIntake({ title, text, url }: ShareParams): ShareIntake {
  const target = url && isValidUrl(url) ? url : text ? firstHttpUrl(text) : null;
  if (target) return { kind: "url", url: target };
  const note = text || title;
  return note ? { kind: "note", text: note } : null;
}
