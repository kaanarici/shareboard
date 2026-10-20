import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import type { LayoutItem } from "react-grid-layout";
import { withIdbStore } from "./idb";
import { listBoards, recordShare } from "./boards";
import {
  SHAREBOARD_DB,
  createStoredDraft,
  loadLocalDraft,
  restoreStoredDraft,
  saveLocalDraft,
  type DraftSnapshot,
} from "./local-draft";
import type { BoardPage } from "./types";

const realIndexedDb = globalThis.indexedDB;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  globalThis.indexedDB = realIndexedDb;
});

const note = (id: string, html = "hello"): BoardPage["items"][number] => ({ id, type: "note", html });

function draft(pages: BoardPage[], extra: Partial<DraftSnapshot> = {}): DraftSnapshot {
  return { pages, boardOrigin: { kind: "draft" }, boardId: null, ...extra };
}

function page(items: BoardPage["items"], layouts: BoardPage["layouts"] = { lg: [], sm: [] }): BoardPage {
  return { id: "p1", items, layouts };
}

async function rawDraft(key: string) {
  return withIdbStore<unknown>(SHAREBOARD_DB, "drafts", "readonly", (store) => store.get(key));
}

describe("draft serialization", () => {
  test("persists files but never blob URLs, and remints previews on restore", () => {
    const file = new File(["x"], "a.png", { type: "image/png" });
    const stored = createStoredDraft(draft([page([{ id: "img", type: "image", file, previewUrl: "blob:old", caption: "c" }])]));
    expect(JSON.stringify(stored)).not.toContain("blob:old");

    const restored = restoreStoredDraft(stored, () => "blob:new");
    expect(restored?.pages[0]?.items[0]).toEqual({ id: "img", type: "image", file, previewUrl: "blob:new", caption: "c" });
  });

  test("keeps only the persisted layout fields for items that still exist", () => {
    const runtime: LayoutItem & { moved: boolean } = { i: "note", x: 1, y: 2, w: 3, h: 4, minW: 2, moved: true };
    const stored = createStoredDraft(draft([page([note("note")], { lg: [runtime, { i: "gone", x: 0, y: 0, w: 1, h: 1 }], sm: [] })]));
    expect(stored.pages[0]?.layouts).toEqual({ lg: [{ i: "note", x: 1, y: 2, w: 3, h: 4 }], sm: [] });
  });

  test("drops junk beside valid items and refuses snapshots that lost every item", () => {
    const file = new File(["x"], "a.png", { type: "image/png" });
    const restored = restoreStoredDraft(
      { v: 2, pages: [{ id: "p1", items: [{ type: "nope" }, { id: "img", type: "image", file }, note("n")] }] },
      () => "blob:new",
    );
    expect(restored?.pages[0]?.items.map((item) => item.id)).toEqual(["img", "n"]);
    expect(restoreStoredDraft({ v: 2, pages: [{ id: "p1", items: [{ type: "bogus" }, null] }] })).toBeNull();
    expect(restoreStoredDraft({ v: 3, pages: [] })).toBeNull();
  });

  test("round-trips the share origin and the Boards entry id", () => {
    const origin = { kind: "locked" as const, id: "board-id" };
    const restored = restoreStoredDraft(createStoredDraft(draft([page([note("n")])], { boardOrigin: origin, boardId: "board-id" })));
    expect(restored?.boardOrigin).toEqual(origin);
    expect(restored?.boardId).toBe("board-id");
    const legacy = restoreStoredDraft({ v: 2, pages: [page([note("n")])], boardOrigin: origin });
    expect(legacy?.boardId).toBe("board-id");
    expect(restoreStoredDraft({ v: 2, pages: [page([note("n")])], boardOrigin: { kind: "stored" } })?.boardOrigin).toEqual({
      kind: "draft",
    });
  });
});

describe("draft storage", () => {
  test("saves land in call order even when issued back to back", async () => {
    const saves = ["one", "two", "three"].map((html) => saveLocalDraft(draft([page([note("n", html)])])));
    await Promise.all(saves);
    const loaded = await loadLocalDraft();
    expect(loaded.status === "loaded" && loaded.draft.pages[0]?.items[0]).toEqual(note("n", "three"));
  });

  test("an unreadable draft is set aside instead of being overwritten by the next autosave", async () => {
    const corrupt = { v: 2, pages: [{ id: "p1", items: [{ id: "x", type: "future-type" }] }] };
    await withIdbStore(SHAREBOARD_DB, "drafts", "readwrite", (store) => {
      store.put(corrupt, "current");
    });
    expect(await loadLocalDraft()).toEqual({ status: "empty" });
    await saveLocalDraft(draft([page([note("fresh")])]));
    expect(await rawDraft("unreadable")).toEqual(corrupt);
  });

  test("a failing IndexedDB reports unavailable so the editor does not autosave over it", async () => {
    globalThis.indexedDB = Object.assign(new IDBFactory(), {
      open: () => {
        throw new DOMException("blocked", "UnknownError");
      },
    });
    expect(await loadLocalDraft()).toEqual({ status: "unavailable" });
  });

  test("a failed save does not poison later saves", async () => {
    const working = globalThis.indexedDB;
    globalThis.indexedDB = Object.assign(new IDBFactory(), {
      open: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    });
    await expect(saveLocalDraft(draft([page([note("lost")])]))).rejects.toThrow();
    globalThis.indexedDB = working;
    await saveLocalDraft(draft([page([note("kept")])]));
    const loaded = await loadLocalDraft();
    expect(loaded.status === "loaded" && loaded.draft.pages[0]?.items[0]).toEqual(note("kept"));
  });
});

describe("boards store", () => {
  test("recording a locked share after a public one keeps both entries", async () => {
    const publicEntry = await recordShare({
      kind: "stored",
      title: "Board",
      shareUrl: "https://share.test/c/public",
      currentId: null,
      id: "public",
    });
    await recordShare({
      kind: "locked",
      title: "Board",
      shareUrl: "https://share.test/c/locked",
      currentId: publicEntry.id,
      id: "locked",
    });
    const kinds = (await listBoards()).map((entry) => [entry.id, entry.kind]);
    expect(kinds.sort()).toEqual([
      ["locked", "locked"],
      ["public", "stored"],
    ]);
  });
});
