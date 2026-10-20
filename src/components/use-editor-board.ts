import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { notify, notifyWithUndo } from "@/lib/toast";
import {
  copyBoardItem,
  duplicateItemWithSpillToPages,
  emptyBoardPage,
  pagesFromBoard,
  placeItemsWithSpill,
  pruneEmptyPages,
  removeItemsFromPage,
  revokeItemPreviews,
  revokeRemovedPreviews,
  withFreshPreviews,
} from "@/lib/board-lifecycle";
import { boardBudgetError, fileFingerprint, handleEditorKeyDown } from "@/lib/board-editor";
import { listBoards, type BoardListEntry } from "@/lib/boards";
import type { DraftSnapshot } from "@/lib/local-draft";
import { isSetup } from "@/lib/store";
import type { Board, BoardItem, BoardOrigin, BoardPage, DraftImageItem, SelectionEvent } from "@/lib/types";
import { formatBytes, optimizeImageForShare, type OptimizedImage } from "@/lib/image-policy";
import { isJsonFile, jsonItemFromFile } from "@/lib/json-policy";
import { sanitizeOgData } from "@/lib/canvas-sanitize";
import { readResponseJson } from "@/lib/json";
import { detectPlatform, isValidUrl } from "@/lib/platforms";
import { estimateMaxRowsFromViewport } from "@/lib/tile-specs";
import { clampPageIndex } from "@/lib/pagination";
import { noteHtmlFromIntake } from "@/lib/note-html";
import { useEditorPersistence } from "@/components/use-editor-persistence";
import { demoBoardPage } from "@/lib/demo-board";
import { isDemo, loadOwner } from "@/lib/owner-client";

type Selection = { pageId: string | null; ids: string[] };

const NO_SELECTION: Selection = { pageId: null, ids: [] };

function pageSearch(index: number) {
  return index === 0 ? {} : { page: index + 1 };
}

function noteSkippedDuplicates(duplicates: number) {
  if (duplicates > 0) notify.success(`Skipped ${duplicates} duplicate${duplicates === 1 ? "" : "s"}`);
}

function draftImage(optimized: OptimizedImage, caption?: string): DraftImageItem {
  const item: DraftImageItem = {
    id: nanoid(10),
    type: "image",
    file: optimized.file,
    previewUrl: URL.createObjectURL(optimized.file),
    size: optimized.file.size,
  };
  if (optimized.file.type) item.mimeType = optimized.file.type;
  if (caption) item.caption = caption;
  if (optimized.aspect) item.aspect = optimized.aspect;
  return item;
}

export function useEditorBoard() {
  const navigate = useNavigate({ from: "/" });
  const search = useSearch({ from: "/" });

  const [draft, setDraft] = useState<DraftSnapshot>(() => ({
    pages: [emptyBoardPage()],
    boardOrigin: { kind: "draft" },
    boardId: null,
  }));
  const draftRef = useRef(draft);
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [deleteDialogIds, setDeleteDialogIds] = useState<string[] | null>(null);
  const [maxRows, setMaxRows] = useState(estimateMaxRowsFromViewport);
  const [boards, setBoards] = useState<BoardListEntry[]>([]);
  const canvasClipboardRef = useRef<BoardItem[]>([]);
  const boardSessionRef = useRef(0);
  const clearShareSheetRef = useRef<() => void>(() => {});

  const { pages, boardOrigin, boardId: currentBoardId } = draft;
  const activePage = clampPageIndex((search.page ?? 1) - 1, pages.length);
  const activePageId = pages[activePage]?.id ?? null;
  const selectedIds = useMemo(
    () => (selection.pageId === activePageId ? selection.ids : []),
    [selection, activePageId],
  );
  const placementRef = useRef({ activePage, maxRows });
  placementRef.current = { activePage, maxRows };

  const commit = useCallback((next: DraftSnapshot) => {
    revokeRemovedPreviews(draftRef.current.pages, next.pages);
    draftRef.current = next;
    setDraft(next);
  }, []);

  const commitPages = useCallback(
    (nextPages: BoardPage[]) => commit({ ...draftRef.current, pages: nextPages }),
    [commit],
  );

  const seed = useCallback(async (): Promise<DraftSnapshot | null> => {
    if (!isDemo(await loadOwner())) return null;
    return { pages: [demoBoardPage(window.location.origin)], boardOrigin: { kind: "draft" }, boardId: null };
  }, []);

  const { mounted } = useEditorPersistence({ draft, draftRef, restore: commit, seed });

  useEffect(() => {
    setNeedsSetup(!isSetup());
    void listBoards().then(setBoards);
  }, []);

  const goToPage = useCallback(
    (index: number) => void navigate({ search: pageSearch(index), replace: false }),
    [navigate],
  );

  const setActivePage = useCallback(
    (next: number) => goToPage(clampPageIndex(next, draftRef.current.pages.length)),
    [goToPage],
  );

  const selectOnPage = useCallback((pageIndex: number, ids: string[]) => {
    setSelection({ pageId: draftRef.current.pages[pageIndex]?.id ?? null, ids });
  }, []);

  const setSelectedIds = useCallback(
    (ids: string[]) => selectOnPage(placementRef.current.activePage, ids),
    [selectOnPage],
  );

  const settlePlacement = useCallback(
    (landedIndex: number, selectIds: string[] | null) => {
      if (selectIds) selectOnPage(landedIndex, selectIds);
      if (landedIndex !== placementRef.current.activePage) goToPage(landedIndex);
    },
    [goToPage, selectOnPage],
  );

  const placeItems = useCallback(
    (items: BoardItem[], select: boolean) => {
      const budgetError = boardBudgetError(draftRef.current.pages, items);
      if (budgetError) {
        revokeItemPreviews(items);
        notify.error(budgetError);
        return false;
      }
      const { activePage: from, maxRows: rows } = placementRef.current;
      const result = placeItemsWithSpill({ pages: draftRef.current.pages, activePage: from, items, maxRows: rows });
      commitPages(result.pages);
      settlePlacement(result.landedIndex, select ? result.selectedIds : null);
      return true;
    },
    [commitPages, settlePlacement],
  );

  const replaceBoard = useCallback(
    (next: DraftSnapshot) => {
      boardSessionRef.current += 1;
      clearShareSheetRef.current();
      commit(next);
      setSelection(NO_SELECTION);
      void navigate({ search: {}, replace: false });
    },
    [commit, navigate],
  );

  const restoreBoard = useCallback(
    (board: Board, boardOrigin: BoardOrigin, boardId: string | null = null) =>
      replaceBoard({ pages: pagesFromBoard(board), boardOrigin, boardId }),
    [replaceBoard],
  );

  const refreshBoards = useCallback(async () => setBoards(await listBoards()), []);

  const boardSession = useCallback(() => boardSessionRef.current, []);

  const attachToBoardEntry = useCallback(
    (session: number, entry: BoardListEntry, origin: BoardOrigin) => {
      if (session === boardSessionRef.current) commit({ ...draftRef.current, boardId: entry.id, boardOrigin: origin });
      void refreshBoards();
    },
    [commit, refreshBoards],
  );

  const forgetBoard = useCallback(
    async (id: string) => {
      const current = draftRef.current;
      const originMatches = current.boardOrigin.kind !== "draft" && current.boardOrigin.id === id;
      if (current.boardId === id || originMatches) {
        commit({
          ...current,
          boardId: current.boardId === id ? null : current.boardId,
          boardOrigin: originMatches ? { kind: "draft" } : current.boardOrigin,
        });
      }
      await refreshBoards();
    },
    [commit, refreshBoards],
  );

  const newBoard = useCallback(() => {
    const previous = draftRef.current;
    if (previous.pages.every((page) => page.items.length === 0)) return;
    const previousPage = placementRef.current.activePage;
    replaceBoard({ pages: [emptyBoardPage()], boardOrigin: { kind: "draft" }, boardId: null });
    notifyWithUndo("New board", () => {
      commit({ ...previous, pages: withFreshPreviews(previous.pages) });
      setSelection(NO_SELECTION);
      goToPage(previousPage);
    });
  }, [commit, goToPage, replaceBoard]);

  const patchPage = useCallback(
    (index: number, patch: Partial<BoardPage>) =>
      commitPages(draftRef.current.pages.map((page, i) => (i === index ? { ...page, ...patch } : page))),
    [commitPages],
  );

  const updateItem = useCallback(
    (id: string, update: (item: BoardItem) => BoardItem) => {
      const current = draftRef.current.pages;
      if (!current.some((page) => page.items.some((item) => item.id === id))) return;
      commitPages(
        current.map((page) =>
          page.items.some((item) => item.id === id)
            ? { ...page, items: page.items.map((item) => (item.id === id ? update(item) : item)) }
            : page,
        ),
      );
    },
    [commitPages],
  );

  const addUrl = useCallback(
    async (rawUrl: string) => {
      if (!isValidUrl(rawUrl)) {
        notify.error("Enter a valid URL");
        return;
      }
      const platform = detectPlatform(rawUrl);
      const id = nanoid(10);
      placeItems([{ id, type: "url", url: rawUrl, platform }], false);
      if (platform === "youtube" || platform === "twitter") return;

      try {
        const res = await fetch(`/api/og?url=${encodeURIComponent(rawUrl)}`);
        const ogData = res.ok ? sanitizeOgData(await readResponseJson(res)) : undefined;
        if (ogData) updateItem(id, (item) => (item.type === "url" ? { ...item, ogData } : item));
      } catch {}
    },
    [placeItems, updateItem],
  );

  const addImage = useCallback(
    async (file: File, caption?: string) => {
      let optimized: OptimizedImage;
      try {
        optimized = await optimizeImageForShare(file);
      } catch (error) {
        notify.error(error instanceof Error ? error.message : "Could not add image");
        return false;
      }
      if (!placeItems([draftImage(optimized, caption)], false)) return false;
      const saved = optimized.originalSize - optimized.file.size;
      if (saved > 512 * 1024) notify.success(`Image optimized to ${formatBytes(optimized.file.size)}`);
      return true;
    },
    [placeItems],
  );

  const addFilesOnce = useCallback(
    async (
      files: File[],
      build: (file: File) => Promise<BoardItem>,
      failure: string,
    ): Promise<{ items: BoardItem[]; duplicates: number }> => {
      const seen = new Set<string>();
      const items: BoardItem[] = [];
      let duplicates = 0;
      for (const file of files) {
        try {
          const fingerprint = await fileFingerprint(file);
          if (seen.has(fingerprint)) {
            duplicates += 1;
            continue;
          }
          seen.add(fingerprint);
          const item = await build(file);
          const budgetError = boardBudgetError(draftRef.current.pages, [...items, item]);
          if (budgetError) {
            revokeItemPreviews([item]);
            notify.error(budgetError);
            break;
          }
          items.push(item);
        } catch (error) {
          notify.error(error instanceof Error ? error.message : failure);
        }
      }
      return { items, duplicates };
    },
    [],
  );

  const addImages = useCallback(
    async (files: File[]) => {
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length === 0) return false;
      const { items, duplicates } = await addFilesOnce(
        imageFiles,
        async (file) => draftImage(await optimizeImageForShare(file)),
        "Could not add image",
      );
      if (items.length === 0 || !placeItems(items, true)) return false;
      noteSkippedDuplicates(duplicates);
      return true;
    },
    [addFilesOnce, placeItems],
  );

  const addJsonFiles = useCallback(
    async (files: File[]) => {
      const jsonFiles = files.filter(isJsonFile);
      if (jsonFiles.length === 0) return false;
      const { items, duplicates } = await addFilesOnce(
        jsonFiles,
        (file) => jsonItemFromFile(file, nanoid(10)),
        "Could not add JSON",
      );
      if (items.length === 0 || !placeItems(items, true)) return false;
      noteSkippedDuplicates(duplicates);
      return true;
    },
    [addFilesOnce, placeItems],
  );

  const addBoardFiles = useCallback(
    async (files: File[]) => {
      const addedImages = await addImages(files);
      const addedJson = await addJsonFiles(files);
      return addedImages || addedJson;
    },
    [addImages, addJsonFiles],
  );

  const addFile = useCallback(
    async (file: File) => {
      if (file.type.startsWith("image/")) return addImage(file);
      if (isJsonFile(file)) return addJsonFiles([file]);
      notify.error("Only images and JSON files can be added");
      return false;
    },
    [addImage, addJsonFiles],
  );

  const addNote = useCallback(
    (text: string) => placeItems([{ id: nanoid(10), type: "note", html: noteHtmlFromIntake(text) }], false),
    [placeItems],
  );

  const removeItems = useCallback(
    (pageIndex: number, ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      const current = draftRef.current.pages;
      const activeId = current[placementRef.current.activePage]?.id;
      const next = pruneEmptyPages(current.map((page, i) => (i === pageIndex ? removeItemsFromPage(page, idSet) : page)));
      commitPages(next);
      setSelection((prev) => ({ ...prev, ids: prev.ids.filter((id) => !idSet.has(id)) }));
      const stillThere = next.findIndex((page) => page.id === activeId);
      const target = stillThere >= 0 ? stillThere : Math.min(pageIndex, next.length - 1);
      if (target !== placementRef.current.activePage) goToPage(target);
    },
    [commitPages, goToPage],
  );

  const removeItem = useCallback((pageIndex: number, id: string) => removeItems(pageIndex, [id]), [removeItems]);

  const duplicateItem = useCallback(
    (pageIndex: number, id: string) => {
      const current = draftRef.current.pages;
      const source = current[pageIndex]?.items.find((item) => item.id === id);
      if (!source) return;
      const budgetError = boardBudgetError(current, [source]);
      if (budgetError) {
        notify.error(budgetError);
        return;
      }
      const copy = copyBoardItem(source);
      const result = duplicateItemWithSpillToPages({
        pages: current,
        activePage: pageIndex,
        sourceId: id,
        copy,
        maxRows: placementRef.current.maxRows,
      });
      commitPages(result.pages);
      settlePlacement(result.landedIndex, [copy.id]);
    },
    [commitPages, settlePlacement],
  );

  const pasteBoardItems = useCallback(
    (items: BoardItem[]) => {
      const copies = items.map(copyBoardItem);
      if (copies.length === 0) return false;
      return placeItems(copies, true);
    },
    [placeItems],
  );

  const updateNoteText = useCallback(
    (id: string, html: string) => updateItem(id, (item) => (item.type === "note" ? { ...item, html } : item)),
    [updateItem],
  );

  const handleCanvasSelect = useCallback(
    (id: string | null, e?: SelectionEvent) => {
      if (id === null) {
        setSelectedIds([]);
        return;
      }
      if (!e?.metaKey && !e?.ctrlKey) {
        setSelectedIds([id]);
        return;
      }
      setSelection((prev) => {
        const pageId = draftRef.current.pages[placementRef.current.activePage]?.id ?? null;
        const ids = prev.pageId === pageId ? prev.ids : [];
        return { pageId, ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] };
      });
    },
    [setSelectedIds],
  );

  const handleCanvasSelectMany = useCallback((ids: string[], additive: boolean) => {
    setSelection((prev) => {
      const pageId = draftRef.current.pages[placementRef.current.activePage]?.id ?? null;
      const base = additive && prev.pageId === pageId ? prev.ids : [];
      return { pageId, ids: [...new Set([...base, ...ids])] };
    });
  }, []);

  const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  handleKeyDownRef.current = (e: KeyboardEvent) => {
    handleEditorKeyDown(
      e,
      {
        needsSetup,
        deleteDialogOpen: deleteDialogIds !== null,
        activePage,
        pageCount: pages.length,
        itemsOnActive: pages[activePage]?.items ?? [],
        selectedIds,
        clipboard: canvasClipboardRef.current,
      },
      {
        setActivePage,
        setSelectedIds,
        setDeleteDialogIds,
        pasteBoardItems,
        removeItem,
        duplicateItem,
        setClipboard: (items) => {
          canvasClipboardRef.current = items;
        },
      },
    );
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => handleKeyDownRef.current(e);
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  return {
    search,
    navigate,
    pages,
    boardOrigin,
    needsSetup,
    setNeedsSetup,
    mounted,
    selectedIds,
    deleteDialogIds,
    setDeleteDialogIds,
    maxRows,
    setMaxRows,
    boards,
    currentBoardId,
    activePage,
    hasItems: pages.some((page) => page.items.length > 0),
    restoreBoard,
    newBoard,
    boardSession,
    attachToBoardEntry,
    forgetBoard,
    setActivePage,
    patchPage,
    addUrl,
    addImage,
    addBoardFiles,
    addFile,
    addNote,
    removeItems,
    removeItem,
    updateNoteText,
    handleCanvasSelect,
    handleCanvasSelectMany,
    clearShareSheetRef,
  };
}
