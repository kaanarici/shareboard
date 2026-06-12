import { describe, expect, test } from "bun:test";
import {
  __draftPolicyForTests,
  __libraryPolicyForTests,
  draftLayoutSignature,
  draftSignature,
} from "./local-draft";
import type { BoardPage } from "./types";

// In-memory stand-in for the IndexedDB library store. Holds records by id
// without structured-cloning, which is enough to exercise the policy layer.
function createMemoryLibraryStore() {
  const records = new Map();
  return {
    available: true,
    list: async () => [...records.values()],
    get: async (id: string) => records.get(id),
    put: async (record: { id: string }) => {
      records.set(record.id, record);
    },
    delete: async (id: string) => {
      records.delete(id);
    },
  };
}

function noteBoard(text: string): BoardPage[] {
  return [{ id: "p1", layouts: { lg: [], sm: [] }, items: [{ id: "n1", type: "note", text }] }];
}

describe("local draft policy", () => {
  test("strips transient previewUrl fields before persistence", () => {
    const pages: BoardPage[] = [
      {
        id: "p1",
        layouts: { lg: [], sm: [] },
        items: [
          {
            id: "img",
            type: "image",
            file: new File(["x"], "a.png", { type: "image/png" }),
            previewUrl: "blob:old",
            caption: "caption",
          },
        ],
      },
    ];

    const snapshot = __draftPolicyForTests.createStoredDraftSnapshot(pages, null, { kind: "draft" });
    const storedItem = snapshot.pages[0]?.items[0] as Record<string, unknown>;

    expect(storedItem.previewUrl).toBeUndefined();
    expect(storedItem.file).toBeInstanceOf(File);
  });

  test("rehydrates draft image preview URLs from persisted files", () => {
    const pages: BoardPage[] = [
      {
        id: "p1",
        layouts: { lg: [], sm: [] },
        items: [
          {
            id: "img",
            type: "image",
            file: new File(["x"], "a.png", { type: "image/png" }),
            previewUrl: "blob:old",
          },
        ],
      },
    ];
    const snapshot = __draftPolicyForTests.createStoredDraftSnapshot(pages, null, { kind: "draft" });

    const restored = __draftPolicyForTests.restoreStoredDraftSnapshot(snapshot, {
      createPreviewUrl() {
        return "blob:new";
      },
      isFile(value): value is File {
        return value instanceof File;
      },
    });

    expect(restored).not.toBeNull();
    expect(restored?.pages[0]?.items[0]).toMatchObject({ type: "image", previewUrl: "blob:new" });
  });

  test("strips runtime layout fields before persistence", () => {
    const pages: BoardPage[] = [
      {
        id: "p1",
        items: [{ id: "note", type: "note", text: "hello" }],
        layouts: {
          lg: [
            {
              i: "note",
              x: 1,
              y: 2,
              w: 3,
              h: 4,
              minW: 2,
              constrainPosition() {
                return { x: 0, y: 0 };
              },
            } as never,
          ],
          sm: [],
        },
      },
    ];

    const storedLayout = __draftPolicyForTests.createStoredDraftSnapshot(pages, null).pages[0]?.layouts.lg[0] as
      | Record<string, unknown>
      | undefined;

    expect(storedLayout).toEqual({ i: "note", x: 1, y: 2, w: 3, h: 4, minW: 2 });
    expect(storedLayout?.constrainPosition).toBeUndefined();
  });

  test("draft signature stays stable across layout-only changes", () => {
    const base: BoardPage[] = [
      {
        id: "p1",
        items: [{ id: "note", type: "note", text: "hello" }],
        layouts: { lg: [{ i: "note", x: 0, y: 0, w: 4, h: 2 }], sm: [] },
      },
    ];
    const moved: BoardPage[] = [
      {
        id: "p1",
        items: [{ id: "note", type: "note", text: "hello" }],
        layouts: { lg: [{ i: "note", x: 6, y: 8, w: 4, h: 2 }], sm: [{ i: "note", x: 0, y: 3, w: 1, h: 2 }] },
      },
    ];

    expect(draftSignature(base, null, { kind: "draft" })).toBe(
      draftSignature(moved, null, { kind: "draft" }),
    );
    expect(draftLayoutSignature(base)).not.toBe(draftLayoutSignature(moved));
  });
});

describe("local library store", () => {
  test("migration adds the library store and leaves an existing draft store untouched", () => {
    // Fresh database: both stores are created.
    const fresh: string[] = [];
    __libraryPolicyForTests.ensureObjectStores({
      has: () => false,
      create: (name) => fresh.push(name),
    });
    expect(fresh).toEqual(["drafts", "library"]);

    // Upgrade from v1: the draft store already exists, so only the library
    // store is created — the existing "current" draft is preserved.
    const upgraded: string[] = [];
    __libraryPolicyForTests.ensureObjectStores({
      has: (name) => name === "drafts",
      create: (name) => upgraded.push(name),
    });
    expect(upgraded).toEqual(["library"]);
  });

  test("saves, lists, and opens a board snapshot", async () => {
    const store = createMemoryLibraryStore();
    const { saved, evicted } = await __libraryPolicyForTests.putLibraryBoard(store, {
      id: "b1",
      name: "My board",
      savedAt: 1000,
      pages: noteBoard("hello"),
      generation: null,
    });
    expect(evicted).toEqual([]);
    expect(saved).toEqual({ id: "b1", name: "My board", savedAt: 1000 });

    expect(await __libraryPolicyForTests.listLibrary(store)).toEqual([
      { id: "b1", name: "My board", savedAt: 1000 },
    ]);

    const restored = await __libraryPolicyForTests.openLibrary(store, "b1");
    expect(restored?.pages[0]?.items[0]).toMatchObject({ type: "note", text: "hello" });
    expect(restored?.boardOrigin).toEqual({ kind: "draft" });
  });

  test("opening a missing board returns null", async () => {
    const store = createMemoryLibraryStore();
    expect(await __libraryPolicyForTests.openLibrary(store, "nope")).toBeNull();
  });

  test("lists newest first regardless of insertion order", async () => {
    const store = createMemoryLibraryStore();
    await __libraryPolicyForTests.putLibraryBoard(store, {
      id: "old",
      name: "old",
      savedAt: 1,
      pages: noteBoard("a"),
      generation: null,
    });
    await __libraryPolicyForTests.putLibraryBoard(store, {
      id: "new",
      name: "new",
      savedAt: 2,
      pages: noteBoard("b"),
      generation: null,
    });
    const list = await __libraryPolicyForTests.listLibrary(store);
    expect(list.map((board) => board.id)).toEqual(["new", "old"]);
  });

  test("persists draft image files and rehydrates preview urls on open", async () => {
    const store = createMemoryLibraryStore();
    const pages: BoardPage[] = [
      {
        id: "p1",
        layouts: { lg: [], sm: [] },
        items: [
          {
            id: "img",
            type: "image",
            file: new File(["x"], "a.png", { type: "image/png" }),
            previewUrl: "blob:old",
          },
        ],
      },
    ];
    await __libraryPolicyForTests.putLibraryBoard(store, {
      id: "b1",
      name: "img board",
      savedAt: 1,
      pages,
      generation: null,
    });

    const storedItem = (await store.get("b1")).snapshot.pages[0].items[0] as Record<string, unknown>;
    expect(storedItem.previewUrl).toBeUndefined();
    expect(storedItem.file).toBeInstanceOf(File);

    const restored = await __libraryPolicyForTests.openLibrary(store, "b1", {
      createPreviewUrl() {
        return "blob:new";
      },
      isFile(value): value is File {
        return value instanceof File;
      },
    });
    expect(restored?.pages[0]?.items[0]).toMatchObject({ type: "image", previewUrl: "blob:new" });
  });

  test("evicts the oldest entries past the cap and reports them", async () => {
    const store = createMemoryLibraryStore();
    const cap = __libraryPolicyForTests.MAX_LIBRARY_BOARDS;
    for (let i = 0; i < cap; i++) {
      await __libraryPolicyForTests.putLibraryBoard(store, {
        id: `b${i}`,
        name: `b${i}`,
        savedAt: i,
        pages: noteBoard(`n${i}`),
        generation: null,
      });
    }

    const { evicted } = await __libraryPolicyForTests.putLibraryBoard(store, {
      id: "newest",
      name: "newest",
      savedAt: cap,
      pages: noteBoard("newest"),
      generation: null,
    });

    expect(evicted).toEqual([{ id: "b0", name: "b0", savedAt: 0 }]);
    const list = await __libraryPolicyForTests.listLibrary(store);
    expect(list.length).toBe(cap);
    expect(list.find((board) => board.id === "b0")).toBeUndefined();
    expect(list.find((board) => board.id === "newest")).toBeDefined();
  });

  test("deleting a board removes it from the list", async () => {
    const store = createMemoryLibraryStore();
    await __libraryPolicyForTests.putLibraryBoard(store, {
      id: "b1",
      name: "b1",
      savedAt: 1,
      pages: noteBoard("a"),
      generation: null,
    });
    await store.delete("b1");
    expect(await __libraryPolicyForTests.listLibrary(store)).toEqual([]);
  });
});
