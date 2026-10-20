import { describe, expect, test } from "bun:test";
import { MAX_BOARDS, originFromBoardEntry, planShareRecord, readBoardEntry, type BoardListEntry } from "./boards";

const NOW = 1_800_000_000_000;

function entry(overrides: Partial<BoardListEntry> & Pick<BoardListEntry, "id" | "kind">): BoardListEntry {
  return { title: "Board", savedAt: NOW - 1000, shareUrl: `https://share.test/c/${overrides.id}`, ...overrides };
}

describe("boards list", () => {
  test("reads only well-formed rows and keeps their delete tokens", () => {
    expect(readBoardEntry({ id: "a", title: "A", savedAt: 1, kind: "stored", shareUrl: "u" })).toEqual({
      id: "a",
      title: "A",
      savedAt: 1,
      kind: "stored",
      shareUrl: "u",
    });
    expect(readBoardEntry({ id: "a", title: "A", savedAt: 1, kind: "local", shareUrl: "u" })).toBeNull();
    expect(readBoardEntry({ id: "a", title: "A", savedAt: "1", kind: "tiny", shareUrl: "u" })).toBeNull();
    expect(readBoardEntry(null)).toBeNull();
  });

  test("re-sharing a tiny board updates its entry in place", () => {
    const tiny = entry({ id: "tiny:1", kind: "tiny", shareUrl: "https://share.test/s#b=old" });
    const plan = planShareRecord([tiny], { kind: "tiny", title: "New", shareUrl: "https://share.test/s#b=new", currentId: "tiny:1" }, NOW);
    expect(plan.put).toEqual({ id: "tiny:1", title: "New", savedAt: NOW, kind: "tiny", shareUrl: "https://share.test/s#b=new" });
    expect(plan.remove).toEqual([]);
  });

  test("a tiny board that becomes a stored share replaces its token-less entry", () => {
    const tiny = entry({ id: "tiny:1", kind: "tiny" });
    const plan = planShareRecord(
      [tiny],
      { kind: "stored", title: "T", shareUrl: "https://share.test/c/new", currentId: "tiny:1", id: "new" },
      NOW,
    );
    expect(plan.put).toMatchObject({ id: "new", kind: "stored" });
    expect(plan.remove).toEqual(["tiny:1"]);
  });

  test("never drops the delete token of a live share that a different share supersedes", () => {
    const publicShare = entry({ id: "public", kind: "stored" });
    const toLocked = planShareRecord(
      [publicShare],
      { kind: "locked", title: "T", shareUrl: "https://share.test/c/locked", currentId: "public", id: "locked" },
      NOW,
    );
    expect(toLocked.remove).toEqual([]);
    expect(toLocked.put.id).toBe("locked");

    const toTiny = planShareRecord([publicShare], { kind: "tiny", title: "T", shareUrl: "https://share.test/s#b=x", currentId: "public" }, NOW);
    expect(toTiny.remove).toEqual([]);
    expect(toTiny.put.id).toBe(`tiny:${NOW}`);
  });

  test("replacing the same stored share updates one entry", () => {
    const stored = entry({ id: "same", kind: "stored" });
    const plan = planShareRecord(
      [stored],
      { kind: "stored", title: "Updated", shareUrl: stored.shareUrl, currentId: "same", id: "same" },
      NOW,
    );
    expect(plan.put).toMatchObject({ id: "same", title: "Updated" });
    expect(plan.remove).toEqual([]);
  });

  test("trims old link-only entries past the cap but keeps every live share", () => {
    const live = Array.from({ length: MAX_BOARDS }, (_, i) => entry({ id: `live-${i}`, kind: "stored", savedAt: i }));
    const tiny = Array.from({ length: 3 }, (_, i) => entry({ id: `tiny:${i}`, kind: "tiny", savedAt: 100 + i }));
    const plan = planShareRecord(
      [...live, ...tiny],
      { kind: "tiny", title: "New", shareUrl: "https://share.test/s#b=new", currentId: null },
      NOW,
    );
    expect(plan.remove.sort()).toEqual(["tiny:0", "tiny:1", "tiny:2"]);
  });

  test("stored and locked entries reopen as editable shares; link-only ones as drafts", () => {
    expect(originFromBoardEntry(entry({ id: "a", kind: "locked" }))).toEqual({ kind: "locked", id: "a" });
    expect(originFromBoardEntry(entry({ id: "b", kind: "stored" }))).toEqual({ kind: "stored", id: "b" });
    expect(originFromBoardEntry(entry({ id: "c", kind: "tiny" }))).toEqual({ kind: "draft" });
  });
});
