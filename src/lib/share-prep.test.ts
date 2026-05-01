import { describe, expect, test } from "bun:test";
import {
  canvasFromTextOnlyPayload,
  collectSharePayload,
  countPayloadItems,
  getBoardTitle,
  getHistorySubtitle,
  hasImageItems,
  resolveTinyHistoryEntryId,
} from "./share-prep";
import type { AuthorProfile, BoardPage, ShareRequestPayload } from "./types";

const EMPTY_LAYOUTS = { lg: [], sm: [] };

describe("share-prep", () => {
  test("collectSharePayload drops board summary and strips draft image file state", () => {
    const pages: BoardPage[] = [
      {
        id: "page-1",
        layouts: EMPTY_LAYOUTS,
        items: [
          { id: "__summary__", type: "board_summary" },
          { id: "note-1", type: "note", text: "hello" },
          {
            id: "img-1",
            type: "image",
            previewUrl: "blob:http://localhost/draft",
            file: new File(["x"], "draft.png", { type: "image/png" }),
            mimeType: "image/png",
            size: 1,
            caption: "Cover",
          },
        ],
      },
    ];
    const authorProfile: AuthorProfile = { xUrl: "https://x.com/ada" };

    const payload = collectSharePayload({
      pages,
      generation: null,
      author: "Ada",
      authorProfile,
    });

    expect(payload).toEqual({
      author: "Ada",
      authorProfile: { xUrl: "https://x.com/ada" },
      generation: null,
      pages: [
        {
          id: "page-1",
          layouts: EMPTY_LAYOUTS,
          items: [
            { id: "note-1", type: "note", text: "hello" },
            {
              id: "img-1",
              type: "image",
              mimeType: "image/png",
              size: 1,
              caption: "Cover",
            },
          ],
        },
      ],
    });
    expect(countPayloadItems(payload)).toBe(2);
  });

  test("canvasFromTextOnlyPayload keeps only note/url and preserves authored metadata", () => {
    const payload: ShareRequestPayload = {
      author: "Ada",
      pages: [
        {
          id: "page-1",
          layouts: EMPTY_LAYOUTS,
          items: [
            { id: "note-1", type: "note", text: "hello" },
            { id: "url-1", type: "url", url: "https://example.com", platform: "website" },
            { id: "img-1", type: "image", caption: "Cover" },
          ],
        },
      ],
    };

    const canvas = canvasFromTextOnlyPayload({
      payload,
      generation: null,
      authorProfile: { linkedinUrl: "https://linkedin.com/in/ada" },
      createdAt: "2026-05-01T00:00:00.000Z",
    });

    expect(canvas).toEqual({
      id: "tiny",
      author: "Ada",
      authorProfile: { linkedinUrl: "https://linkedin.com/in/ada" },
      pages: [
        {
          id: "page-1",
          layouts: EMPTY_LAYOUTS,
          items: [
            { id: "note-1", type: "note", text: "hello" },
            { id: "url-1", type: "url", url: "https://example.com", platform: "website" },
          ],
        },
      ],
      createdAt: "2026-05-01T00:00:00.000Z",
    });
  });

  test("title/subtitle helpers preserve existing share labels", () => {
    expect(
      getBoardTitle([
        {
          items: [{ type: "note", text: "  First line\nsecond   line  " }],
        },
      ]),
    ).toBe("First line second line");
    expect(getHistorySubtitle("locked", 2, 3)).toBe("Locked share · 3 items · 2 pages");
  });

  test("tiny entry id resolves replace id for drafts and timestamp id otherwise", () => {
    expect(resolveTinyHistoryEntryId({ kind: "draft", replaceHistoryId: "tiny:existing" }, 10)).toBe(
      "tiny:existing",
    );
    expect(resolveTinyHistoryEntryId({ kind: "stored" }, 42)).toBe("tiny:42");
  });

  test("hasImageItems detects image presence across pages", () => {
    expect(
      hasImageItems([
        { id: "a", layouts: EMPTY_LAYOUTS, items: [{ id: "n", type: "note", text: "x" }] },
      ]),
    ).toBe(false);
    expect(
      hasImageItems([
        {
          id: "a",
          layouts: EMPTY_LAYOUTS,
          items: [{ id: "i", type: "image", url: "https://example.com/a.png" }],
        },
      ]),
    ).toBe(true);
  });
});
