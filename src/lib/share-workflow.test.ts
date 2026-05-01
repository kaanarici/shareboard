import { describe, expect, test } from "bun:test";
import { createHistoryEntry, preparePublicShare } from "./share-workflow";
import type { BoardPage } from "./types";

const layouts = { lg: [], sm: [] };

describe("share-workflow", () => {
  test("creates consistent board history entries from share metadata", () => {
    expect(
      createHistoryEntry({
        id: "board",
        kind: "stored",
        shareUrl: "https://example.com/c/board",
        deleteToken: "token",
        metadata: {
          title: "Roadmap",
          itemCount: 2,
          pageCount: 1,
          createdAt: "2026-05-01T00:00:00.000Z",
        },
      }),
    ).toEqual({
      id: "board",
      kind: "stored",
      title: "Roadmap",
      subtitle: "Public share · 2 items · 1 page",
      shareUrl: "https://example.com/c/board",
      createdAt: "2026-05-01T00:00:00.000Z",
      itemCount: 2,
      pageCount: 1,
      deleteToken: "token",
    });
  });

  test("prepares stored share form data and replace credentials behind one interface", async () => {
    const pages: BoardPage[] = [
      {
        id: "page",
        layouts,
        items: [
          {
            id: "image",
            type: "image",
            previewUrl: "blob:http://localhost/image",
            file: new File(["image"], "image.png", { type: "image/png" }),
            mimeType: "image/png",
            size: 5,
          },
        ],
      },
    ];

    const draft = await preparePublicShare({
      pages,
      generation: null,
      boardOrigin: { kind: "stored", id: "same-board", deleteToken: "replace-token" },
      author: "Ada",
      authorProfile: {},
      baseUrl: "https://share.example",
      isMobile: true,
      now: new Date("2026-05-01T00:00:00.000Z"),
    });

    expect(draft.kind).toBe("stored");
    if (draft.kind !== "stored") return;
    expect(draft.isReplace).toBe(true);
    expect(draft.form.get("replaceId")).toBe("same-board");
    expect(draft.form.get("replaceToken")).toBe("replace-token");
    expect(draft.form.get("image:image")).toBeInstanceOf(File);
    expect(draft.metadata).toEqual({
      title: "Image board",
      itemCount: 1,
      pageCount: 1,
      createdAt: "2026-05-01T00:00:00.000Z",
    });
  });
});
