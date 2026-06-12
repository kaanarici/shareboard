import type {
  AuthorProfile,
  BoardPage,
  Canvas,
  JsonItem,
  NoteItem,
  ShareRequestItem,
  ShareRequestPayload,
  UrlItem,
} from "@/lib/types";

type TitleableItem =
  | { type: "note"; text: string }
  | { type: "url"; url: string }
  | { type: "json"; name: string }
  | { type: "image"; caption?: string }
  | { type: string };
type TitleablePage = { items: readonly TitleableItem[] };

export type ShareHistoryKind = "tiny" | "stored" | "locked";

export function getBoardTitle(pages: readonly TitleablePage[]) {
  for (const page of pages) {
    for (const item of page.items) {
      if (item.type === "note" && "text" in item && item.text.trim()) {
        return item.text.trim().replace(/\s+/g, " ").slice(0, 42);
      }
      if (item.type === "url" && "url" in item) {
        try {
          return new URL(item.url).hostname.replace(/^www\./, "");
        } catch {
          return item.url.slice(0, 42);
        }
      }
      if (item.type === "image") {
        const caption = "caption" in item ? item.caption?.trim() : "";
        return caption || "Image board";
      }
      if (item.type === "json" && "name" in item) {
        return item.name.trim() || "JSON board";
      }
    }
  }
  return "Untitled board";
}

export function getHistorySubtitle(kind: ShareHistoryKind, pageCount: number, itemCount: number) {
  const itemLabel = itemCount === 1 ? "item" : "items";
  const pageLabel = pageCount === 1 ? "page" : "pages";
  const prefix = kind === "tiny" ? "Stored in link" : kind === "locked" ? "Locked share" : "Public share";
  return `${prefix} · ${itemCount} ${itemLabel} · ${pageCount} ${pageLabel}`;
}

function shareItemFromEditor(item: BoardPage["items"][number]): ShareRequestItem | null {
  if ((item as { type?: unknown }).type === "board_summary") return null;
  if (item.type === "image") {
    return {
      id: item.id,
      type: "image",
      mimeType: item.mimeType,
      size: item.size,
      caption: item.caption,
    };
  }
  return item;
}

export function collectSharePayload({
  pages,
  author,
  authorProfile,
}: {
  pages: BoardPage[];
  author: string;
  authorProfile: AuthorProfile;
}): ShareRequestPayload {
  return {
    author,
    authorProfile,
    pages: pages.map((page) => ({
      id: page.id,
      layouts: page.layouts,
      items: page.items.map(shareItemFromEditor).filter((item): item is ShareRequestItem => !!item),
    })),
  };
}

export function countPayloadItems(payload: ShareRequestPayload) {
  return payload.pages.reduce((n, page) => n + page.items.length, 0);
}

export function canvasFromTextOnlyPayload({
  payload,
  authorProfile,
  createdAt,
}: {
  payload: ShareRequestPayload;
  authorProfile: AuthorProfile;
  createdAt: string;
}): Canvas {
  return {
    id: "tiny",
    author: typeof payload.author === "string" && payload.author ? payload.author : "Anonymous",
    authorProfile,
    pages: payload.pages.map((page) => ({
      id: page.id,
      layouts: page.layouts,
      items: page.items.filter((item): item is UrlItem | NoteItem | JsonItem =>
        item.type === "url" || item.type === "note" || item.type === "json",
      ),
    })),
    createdAt,
  };
}

type TinyEntryOrigin =
  | { kind: "draft"; replaceHistoryId?: string }
  | { kind: "stored" | "locked" };

export function resolveTinyHistoryEntryId(origin: TinyEntryOrigin, nowMs: number) {
  if (origin.kind === "draft" && origin.replaceHistoryId) return origin.replaceHistoryId;
  return `tiny:${nowMs}`;
}

export function hasImageItems(pages: BoardPage[]) {
  return pages.some((page) => page.items.some((item) => item.type === "image"));
}
