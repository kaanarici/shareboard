import { useState, useCallback, useRef, useMemo, useEffect, type MouseEvent } from "react";
import { useMountEffect } from "@/lib/use-mount-effect";
import { nanoid } from "nanoid";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { notify, notifyProgress } from "@/lib/toast";
import { Canvas } from "@/components/canvas";
import { Toolbar } from "@/components/toolbar";
import { SetupCards } from "@/components/setup-dialog";
import { LockedShareDialog } from "@/components/locked-share-dialog";
import { BoardCarousel } from "@/components/board-carousel";
import { Toaster } from "@/components/ui/sonner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Download, Loader2, Save, Share2 } from "lucide-react";
import { getApiKey, isSetup, useSyncedSetting } from "@/lib/store";
import {
  draftSignature,
  loadLocalDraft,
  saveLocalDraft,
} from "@/lib/local-draft";
import { detectPlatform, isValidUrl } from "@/lib/platforms";
import { mergeLayout } from "@/components/ui/auto-canvas";
import {
  LG_COLS,
  ROW_HEIGHT,
  MARGIN,
  buildSpecList,
  estimateContainerWidth,
  estimateMaxRowsFromViewport,
} from "@/lib/tile-specs";
import type {
  BoardPage,
  Canvas as SharedCanvasData,
  CanvasItem,
  GenerateResponse,
  GridLayouts,
  OGData,
} from "@/lib/types";
import { BOARD_SUMMARY_ITEM_ID, isDraftImageItem } from "@/lib/types";
import { IMAGE_POLICY, formatBytes, optimizeImageForShare } from "@/lib/image-policy";
import { copyText } from "@/lib/clipboard";
import { readErrorMessage } from "@/lib/fetch-helpers";
import { useShareFlows } from "@/components/use-share-flows";
import { sanitizeGeneration, sanitizePublicCanvasManifest } from "@/lib/canvas-sanitize";
import { decodeTinyShare, readStoredShareId, readTinyPayloadFromUrl } from "@/lib/tiny-share";

function emptyPage(): BoardPage {
  return { id: nanoid(8), items: [], layouts: { lg: [], sm: [] } };
}

/**
 * Seed persisted layouts for a page. Known-id positions are preserved so prior
 * user arrangement survives; new ids get packed via skyline masonry.
 *
 * This is pre-measurement (uses viewport width estimate). The mounted
 * <AutoCanvas> re-merges with its real container width on render, so the
 * seeded positions are only "scratch" until the grid measures itself — but
 * they're still useful for (a) share persistence and (b) immediate render.
 */
function packPageLayouts(items: CanvasItem[], prev: GridLayouts, maxRows: number): GridLayouts {
  const specs = buildSpecList(items);
  const lg = mergeLayout(prev.lg, specs, {
    columns: LG_COLS,
    containerWidth: estimateContainerWidth(),
    rowHeight: ROW_HEIGHT,
    gap: MARGIN,
    maxRows,
  });
  const sm = mergeLayout(prev.sm, specs, {
    columns: 1,
    containerWidth: estimateContainerWidth(),
    rowHeight: ROW_HEIGHT,
    gap: MARGIN,
  });
  return { lg, sm };
}

function findSvgSource(html: string | null, text: string | null) {
  return html?.match(/<svg[\s\S]*<\/svg>/i)?.[0] ?? (text?.startsWith("<svg") ? text : null);
}

function createSvgFile(svgSource: string) {
  const withXmlns = svgSource.includes("xmlns=")
    ? svgSource
    : svgSource.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  return new File([withXmlns], `shareboard-${Date.now()}.svg`, { type: "image/svg+xml" });
}

function pagesFromHistoryCanvas(canvas: SharedCanvasData): BoardPage[] {
  return canvas.pages.length
    ? canvas.pages.map((page) => ({
        id: page.id || nanoid(8),
        items: page.items.filter((item) => item.type !== "board_summary"),
        layouts: page.layouts ?? { lg: [], sm: [] },
      }))
    : [emptyPage()];
}

function findSharedUrl(types: readonly string[], get: (type: string) => string) {
  const uriList = get("text/uri-list")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  if (uriList && isValidUrl(uriList)) return uriList;

  const text = get("text/plain").trim();
  if (text && isValidUrl(text)) return text;

  if (!types.includes("text/html")) return null;
  const html = get("text/html");
  if (!html) return null;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const anchor = doc.querySelector("a[href]") as HTMLAnchorElement | null;
  return anchor?.href && isValidUrl(anchor.href) ? anchor.href : null;
}

export function Home() {
  const navigate = useNavigate({ from: "/" });
  const search = useSearch({ from: "/" });
  const urlPage = search.page ?? 1;

  const [pages, setPages] = useState<BoardPage[]>(() => [emptyPage()]);
  const [generation, setGeneration] = useState<GenerateResponse | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteDialogIds, setDeleteDialogIds] = useState<string[] | null>(null);
  const [maxRows, setMaxRows] = useState(estimateMaxRowsFromViewport);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importInput, setImportInput] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "save">("saved");
  const lastSavedSigRef = useRef<string>("");
  // Keep latest pages in a ref so the unmount blob-URL cleanup can walk them
  // without being a dep of the mount effect. Assignment during render is safe —
  // it doesn't trigger renders.
  const pagesRef = useRef<BoardPage[]>([]);
  pagesRef.current = pages;
  const generationRef = useRef<GenerateResponse | null>(null);
  generationRef.current = generation;

  const restoreBoard = useCallback(
    (canvas: SharedCanvasData) => {
      setPages(pagesFromHistoryCanvas(canvas));
      setGeneration(canvas.generation ?? null);
      setSelectedIds([]);
      navigate({ search: {}, replace: false });
    },
    [navigate],
  );

  const openImportDialog = useCallback(() => {
    setImportInput("");
    setImportDialogOpen(true);
  }, []);

  const importFromInput = useCallback(async () => {
    const raw = importInput.trim();
    if (!raw || isImporting) return;
    setIsImporting(true);
    try {
      const tinyPayload = readTinyPayloadFromUrl(raw);
      if (tinyPayload) {
        const canvas = await decodeTinyShare(tinyPayload).catch(() => null);
        if (!canvas) {
          notify.error("Couldn't read that shared board");
          return;
        }
        restoreBoard(canvas);
        setImportDialogOpen(false);
        notify.success("Board imported");
        return;
      }

      const storedId = readStoredShareId(raw);
      if (!storedId) {
        notify.error("Paste a Shareboard link to import");
        return;
      }
      const res = await fetch(`/api/share?key=${encodeURIComponent(`canvases/${storedId}.json`)}`);
      if (!res.ok) {
        notify.error("Couldn't fetch that board (it may be on another host)");
        return;
      }
      const body = (await res.json().catch(() => null)) as unknown;
      const canvas = sanitizePublicCanvasManifest(body);
      if (!canvas) {
        notify.error("That board is locked or not importable");
        return;
      }
      restoreBoard(canvas);
      setImportDialogOpen(false);
      notify.success("Board imported");
    } catch {
      notify.error("Couldn't import that board");
    } finally {
      setIsImporting(false);
    }
  }, [importInput, isImporting, restoreBoard]);

  const {
    shareState,
    manualShareUrl,
    setManualShareUrl,
    lockedShareOpen,
    setLockedShareOpen,
    lockedShareBusy,
    hasLastSharedBoard,
    isDeletingShare,
    history,
    share,
    shareLocked,
    deleteLastShare,
    openHistoryEntry,
    removeHistoryEntry,
    markShareCopied,
  } = useShareFlows({ pages, generation, onRestoreBoard: restoreBoard });

  const activePage = Math.max(0, Math.min(urlPage - 1, pages.length - 1));

  const setActivePage = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(next, pages.length - 1));
      navigate({
        search: clamped === 0 ? {} : { page: clamped + 1 },
        replace: false,
      });
    },
    [navigate, pages.length]
  );

  const hasApiKey = useSyncedSetting(() => !!getApiKey().trim());
  const itemsOnActive = pages[activePage]?.items ?? [];
  const totalContentItems = useMemo(
    () => pages.reduce((n, p) => n + p.items.filter((i) => i.type !== "board_summary").length, 0),
    [pages]
  );
  const totalMediaBytes = useMemo(
    () =>
      pages.reduce(
        (n, p) => n + p.items.reduce((sum, item) => sum + (item.type === "image" ? item.size ?? 0 : 0), 0),
        0
      ),
    [pages]
  );
  const hasItems = totalContentItems > 0;

  useEffect(() => {
    setSelectedIds([]);
  }, [activePage]);

  const currentDraftSig = useMemo(
    () => draftSignature(pages, generation),
    [pages, generation],
  );

  // Save current pages+generation. Reads via refs so the callback identity is
  // stable across renders — important for the auto-save effect's deps.
  const writeDraft = useCallback(async (manual: boolean) => {
    const p = pagesRef.current;
    const g = generationRef.current;
    const sig = draftSignature(p, g);
    setSaveState("saving");
    try {
      await saveLocalDraft(p, g);
      lastSavedSigRef.current = sig;
      setSaveState("saved");
      if (manual) notify.success("Saved to this browser");
    } catch (error) {
      setSaveState("save");
      if (manual) {
        notify.error(error instanceof Error ? error.message : "Couldn't save locally");
      }
    }
  }, []);

  const handleSaveClick = useCallback(() => {
    void writeDraft(true);
  }, [writeDraft]);

  // Auto-save with a short debounce. Skips when content matches what's already
  // persisted (so reflowing layouts or re-rendering doesn't spam writes).
  useEffect(() => {
    if (!mounted) return;
    if (currentDraftSig === lastSavedSigRef.current) {
      setSaveState((prev) => (prev === "saved" ? prev : "saved"));
      return;
    }
    setSaveState((prev) => (prev === "save" ? prev : "save"));
    const timer = window.setTimeout(() => {
      void writeDraft(false);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [mounted, currentDraftSig, writeDraft]);

  // Mount-only: hydrate localStorage-backed flags + IDB draft, revoke blob URLs
  // on unmount. Mount paint is delayed until the draft load resolves so the
  // user doesn't see an empty-board flash before their saved work appears.
  useMountEffect(() => {
    setNeedsSetup(!isSetup());

    let cancelled = false;
    void loadLocalDraft()
      .then((draft) => {
        if (cancelled) return;
        if (draft) {
          setPages(draft.pages);
          setGeneration(draft.generation);
          lastSavedSigRef.current = draftSignature(draft.pages, draft.generation);
        } else {
          lastSavedSigRef.current = draftSignature(pagesRef.current, null);
        }
      })
      .finally(() => {
        if (!cancelled) setMounted(true);
      });

    return () => {
      cancelled = true;
      for (const page of pagesRef.current) {
        for (const item of page.items) {
          if (isDraftImageItem(item)) URL.revokeObjectURL(item.previewUrl);
        }
      }
    };
  });

  /** Patch page at `index` with a partial update. */
  const patchPage = useCallback(
    (index: number, patch: Partial<BoardPage> | ((page: BoardPage) => BoardPage)) => {
      setPages((prev) =>
        prev.map((p, i) => {
          if (i !== index) return p;
          return typeof patch === "function" ? patch(p) : { ...p, ...patch };
        })
      );
    },
    []
  );

  const updateActivePageItems = useCallback(
    (
      mutate: (items: CanvasItem[], layouts: GridLayouts) => { items: CanvasItem[]; layouts: GridLayouts }
    ) => {
      patchPage(activePage, (page) => {
        const next = mutate(page.items, page.layouts);
        return { ...page, items: next.items, layouts: next.layouts };
      });
    },
    [patchPage, activePage]
  );

  /**
   * Add `item` to the active page, or spill to the next page (auto-creating it)
   * if the active page can't fit the new tile inside maxRows. Returns the page
   * index the item actually landed on. Empty pages always accept even oversize
   * tiles — otherwise a single tall tweet would spill forever.
   *
   * All state reads happen inside the setPages updater so rapid pastes (user
   * holding Cmd+V) see each other's work — otherwise they'd all compute
   * against the same pre-batch snapshot and later updaters would overwrite
   * earlier items.
   */
  const addItemWithSpill = useCallback(
    (item: CanvasItem): number => {
      // Written by the setPages updater below. Read AFTER setPages returns —
      // React schedules the updater synchronously for this event handler.
      let landedIndex = activePage;
      setPages((prev) => {
        const next = [...prev];
        const active = next[activePage] ?? emptyPage();
        const tentativeItems = [...active.items, item];
        const tentative = packPageLayouts(tentativeItems, active.layouts, maxRows);
        // Check the whole layout, not just the newly-added tile: the packer may
        // re-pack existing tiles on overflow, and aspect-locked tiles keep their
        // natural height at render regardless of what we store — an image, tweet,
        // or YouTube pasted onto a full page would otherwise silently overflow
        // the canvas instead of spilling onto a new page.
        const tentativeBottom = tentative.lg.reduce(
          (m, l) => Math.max(m, l.y + l.h),
          0,
        );
        const fits = tentativeBottom <= maxRows;
        const activeIsEmpty = active.items.length === 0;

        if (fits || activeIsEmpty) {
          next[activePage] = { ...active, items: tentativeItems, layouts: tentative };
          landedIndex = activePage;
          return next;
        }

        const nextIndex = activePage + 1;
        if (nextIndex >= next.length) next.push(emptyPage());
        const target = next[nextIndex];
        const items = [...target.items, item];
        next[nextIndex] = {
          ...target,
          items,
          layouts: packPageLayouts(items, target.layouts, maxRows),
        };
        landedIndex = nextIndex;
        return next;
      });
      if (landedIndex !== activePage) {
        queueMicrotask(() => navigate({ search: { page: landedIndex + 1 }, replace: false }));
      }
      return landedIndex;
    },
    [activePage, maxRows, navigate]
  );

  const addUrl = useCallback(
    async (rawUrl: string) => {
      if (!isValidUrl(rawUrl)) {
        notify.error("Enter a valid URL");
        return;
      }
      const platform = detectPlatform(rawUrl);
      const id = nanoid(10);
      const item: CanvasItem = { id, type: "url", url: rawUrl, platform };

      const landedIndex = addItemWithSpill(item);

      // YouTube/Twitter render via dedicated embeds, so OG metadata is unused.
      // Other sites that block CF Workers (e.g. LinkedIn) gracefully fall back
      // to the icon + hostname card.
      if (platform === "youtube" || platform === "twitter") return;

      try {
        const res = await fetch(`/api/og?url=${encodeURIComponent(rawUrl)}`);
        if (res.ok) {
          const ogData = (await res.json()) as OGData;
          patchPage(landedIndex, (page) => ({
            ...page,
            items: page.items.map((i) =>
              i.id === id && i.type === "url" ? { ...i, ogData } : i
            ),
          }));
        }
      } catch {
        // OG fetch is best-effort; swallow errors so the item still renders.
      }
    },
    [addItemWithSpill, patchPage]
  );

  const addImage = useCallback(
    async (file: File, caption?: string) => {
      let optimized;
      try {
        optimized = await optimizeImageForShare(file);
      } catch (error) {
        notify.error(error instanceof Error ? error.message : "Could not add image");
        return false;
      }

      if (totalMediaBytes + optimized.file.size > IMAGE_POLICY.maxBoardBytes) {
        notify.error(`Boards can hold up to ${formatBytes(IMAGE_POLICY.maxBoardBytes)} of images`);
        return false;
      }

      const id = nanoid(10);
      const item: CanvasItem = {
        id,
        type: "image",
        file: optimized.file,
        previewUrl: URL.createObjectURL(optimized.file),
        mimeType: optimized.file.type || undefined,
        size: optimized.file.size,
        caption,
        aspect: optimized.aspect,
      };
      addItemWithSpill(item);
      const saved = optimized.originalSize - optimized.file.size;
      notify.success(saved > 512 * 1024 ? `Image optimized to ${formatBytes(optimized.file.size)}` : "Image added");
      return true;
    },
    [addItemWithSpill, totalMediaBytes]
  );

  const addNote = useCallback(
    (text: string) => {
      const id = nanoid(10);
      const item: CanvasItem = { id, type: "note" as const, text };
      addItemWithSpill(item);
    },
    [addItemWithSpill]
  );

  const removeItems = useCallback(
    (pageIndex: number, ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      patchPage(pageIndex, (page) => {
        for (const item of page.items) {
          if (idSet.has(item.id) && isDraftImageItem(item)) {
            URL.revokeObjectURL(item.previewUrl);
          }
        }
        return {
          ...page,
          items: page.items.filter((item) => !idSet.has(item.id)),
          layouts: {
            lg: page.layouts.lg.filter((l) => !idSet.has(l.i)),
            sm: page.layouts.sm.filter((l) => !idSet.has(l.i)),
          },
        };
      });
      if (idSet.has(BOARD_SUMMARY_ITEM_ID)) setGeneration(null);
      setGeneration((g) =>
        g
          ? { ...g, item_summaries: g.item_summaries.filter((s) => !idSet.has(s.item_id)) }
          : g
      );
      setSelectedIds((prev) => prev.filter((x) => !idSet.has(x)));
    },
    [patchPage]
  );

  const removeItem = useCallback(
    (pageIndex: number, id: string) => {
      removeItems(pageIndex, [id]);
    },
    [removeItems]
  );

  const duplicateItem = useCallback(
    (pageIndex: number, id: string) => {
      if (id === BOARD_SUMMARY_ITEM_ID) return;
      patchPage(pageIndex, (page) => {
        const source = page.items.find((i) => i.id === id);
        if (!source || source.type === "board_summary") return page;
        const newId = nanoid(10);
        const copy = isDraftImageItem(source)
          ? { ...source, id: newId, previewUrl: URL.createObjectURL(source.file) }
          : { ...source, id: newId };
        const nextItems = [...page.items, copy];
        const nextLayouts = packPageLayouts(nextItems, page.layouts, maxRows);
        setSelectedIds([newId]);
        return { ...page, items: nextItems, layouts: nextLayouts };
      });
    },
    [patchPage, maxRows]
  );

  const updateNoteText = useCallback(
    (pageIndex: number, id: string, text: string) => {
      patchPage(pageIndex, (page) => ({
        ...page,
        items: page.items.map((i) => (i.id === id && i.type === "note" ? { ...i, text } : i)),
      }));
    },
    [patchPage]
  );

  const addPage = useCallback(() => {
    setPages((prev) => {
      const next = [...prev, emptyPage()];
      // Defer navigation until after state commits so router sees the new length.
      queueMicrotask(() => navigate({ search: { page: next.length }, replace: false }));
      return next;
    });
  }, [navigate]);

  const generate = useCallback(async () => {
    if (!getApiKey().trim()) {
      notify.error("Add an OpenAI API key in settings to summarize");
      return;
    }
    const allItems = pages.flatMap((p) => p.items.filter((i) => i.type !== "board_summary"));
    if (allItems.length === 0) return;
    setIsGenerating(true);
    const progress = notifyProgress("Summarizing");
    try {
      const generationItems = allItems.map((item) =>
        item.type === "image"
          ? { id: item.id, type: "image" as const, caption: item.caption }
          : item
      );
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": getApiKey() },
        body: JSON.stringify({ items: generationItems }),
      });
      if (!res.ok) {
        progress.error(await readErrorMessage(res, "Generation failed"));
        return;
      }
      const data = sanitizeGeneration((await res.json().catch(() => null)) as unknown);
      if (!data) {
        progress.error("Generation failed");
        return;
      }
      setGeneration(data);
      patchPage(0, (page) => {
        if (page.items.some((i) => i.id === BOARD_SUMMARY_ITEM_ID)) return page;
        const nextItems: CanvasItem[] = [
          ...page.items,
          { id: BOARD_SUMMARY_ITEM_ID, type: "board_summary" },
        ];
        const nextLayouts = packPageLayouts(nextItems, page.layouts, maxRows);
        return { ...page, items: nextItems, layouts: nextLayouts };
      });
      setActivePage(0);
      progress.success("Summary ready");
    } catch {
      progress.error("Failed to connect");
    } finally {
      setIsGenerating(false);
    }
  }, [pages, patchPage, maxRows, setActivePage]);

  const handleDropData = useCallback(
    (data: DataTransfer) => {
      if (needsSetup) return;

      const files = Array.from(data.files);
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length > 0) {
        void Promise.all(imageFiles.map((file) => addImage(file)));
        return;
      }

      if (files.length > 0) {
        notify.error("Only images can be dropped into a board");
        return;
      }

      const html = data.getData("text/html")?.trim() || null;
      const text = data.getData("text/plain")?.trim() || null;
      const svgSource = findSvgSource(html, text);
      if (svgSource) {
        void addImage(createSvgFile(svgSource));
        return;
      }

      const url = findSharedUrl(data.types, (type) => data.getData(type));
      if (url) {
        void addUrl(url);
        notify.success("URL added");
        return;
      }

      if (text) {
        addNote(text);
        notify.success("Note added");
      }
    },
    [needsSetup, addImage, addNote, addUrl]
  );

  // Install the paste listener once on mount and route through a latest-handler
  // ref so closure deps (addUrl, addImage, addNote, needsSetup) stay current
  // without resubscribing — resubscribing on rapid pastes dropped items.
  const handlePasteRef = useRef<(e: ClipboardEvent) => void>(() => {});
  handlePasteRef.current = (e: ClipboardEvent) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (
      target?.closest("input, textarea, select") ||
      target?.isContentEditable ||
      target?.closest(".tiptap") ||
      target?.closest("[contenteditable]")
    ) {
      return;
    }

    if (needsSetup) return;

    const clipboard = e.clipboardData;
    if (!clipboard) return;

    const imageItem = Array.from(clipboard.items).find((item) => item.type.startsWith("image/"));
    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (!file) return;
      void addImage(file);
      return;
    }

    if (clipboard.files.length > 0) {
      e.preventDefault();
      notify.error("Only images can be pasted into a board");
      return;
    }

    const html = clipboard.getData("text/html")?.trim() || null;
    const text = clipboard.getData("text/plain")?.trim() || null;
    const svgSource = findSvgSource(html, text);
    if (svgSource) {
      e.preventDefault();
      void addImage(createSvgFile(svgSource));
      return;
    }

    const url = findSharedUrl(clipboard.types, (type) => clipboard.getData(type));
    if (url) {
      e.preventDefault();
      void addUrl(url);
      notify.success("URL added");
      return;
    }

    if (!text) return;
    e.preventDefault();
    addNote(text);
    notify.success("Note added");
  };

  const handleCanvasSelect = useCallback((id: string | null, e?: MouseEvent) => {
    if (id === null) {
      setSelectedIds([]);
      return;
    }
    if (e?.metaKey || e?.ctrlKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return [...next];
      });
    } else {
      setSelectedIds([id]);
    }
  }, []);

  // Same latest-handler ref pattern for keydown shortcuts.
  const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  handleKeyDownRef.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const inField =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable ||
      !!target.closest('[contenteditable="true"]');

    if (deleteDialogIds) return;
    if (inField) return;

    if (target.closest("[data-slot=dialog-content]") || target.closest("[data-slot=dialog-overlay]")) {
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      if (!needsSetup && itemsOnActive.length > 0) {
        setSelectedIds(itemsOnActive.map((i) => i.id));
      }
      return;
    }

    if (!needsSetup) {
      if (e.key === "ArrowLeft" && activePage > 0) {
        e.preventDefault();
        setActivePage(activePage - 1);
        return;
      }
      if (e.key === "ArrowRight" && activePage < pages.length - 1) {
        e.preventDefault();
        setActivePage(activePage + 1);
        return;
      }
    }

    if (needsSetup) return;

    if (selectedIds.length === 0) return;

    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      if (selectedIds.length > 1) {
        setDeleteDialogIds([...selectedIds]);
        return;
      }
      const only = selectedIds[0]!;
      const selected = itemsOnActive.find((i) => i.id === only);
      if (selected) removeItem(activePage, only);
      return;
    }

    if (selectedIds.length > 1) {
      if (e.key === "Escape") {
        e.preventDefault();
        setSelectedIds([]);
      }
      return;
    }

    const one = selectedIds[0]!;
    const selected = itemsOnActive.find((i) => i.id === one);
    if (!selected) return;

    if ((e.metaKey || e.ctrlKey) && e.key === "d") {
      e.preventDefault();
      duplicateItem(activePage, one);
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === "c") {
      e.preventDefault();
      let text = "";
      if (selected.type === "url") text = selected.url;
      else if (selected.type === "note") text = selected.text;
      else if (selected.type === "board_summary") {
        text =
          generation?.overall_summary.explanation?.trim() ||
          generation?.overall_summary.title ||
          "";
      } else if (selected.type === "image")
        text = isDraftImageItem(selected) ? selected.caption ?? selected.file.name : selected.url;
      void copyText(text).then((copied) =>
        copied ? notify.success("Copied") : notify.error("Couldn't copy")
      );
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setSelectedIds([]);
    }
  };

  // Install document-level paste and keydown listeners exactly once. Each
  // delegates to its *Ref handler so closure state stays fresh without
  // resubscribing (see rapid-paste bug fix).
  useMountEffect(() => {
    const onPaste = (e: ClipboardEvent) => handlePasteRef.current(e);
    const onKeyDown = (e: KeyboardEvent) => handleKeyDownRef.current(e);
    document.addEventListener("paste", onPaste);
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  });

  if (!mounted) return null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="board-notch" data-locked={needsSetup || undefined}>
        <button
          type="button"
          className="board-notch-action"
          onClick={handleSaveClick}
          disabled={!hasItems || saveState === "saving"}
          aria-label="Save board to this browser"
          title="Save board to this browser"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={saveState}
              className="board-notch-action-content"
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
            >
              {saveState === "saving" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : saveState === "saved" ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              <span>{saveState === "saved" ? "Saved" : "Save"}</span>
            </motion.span>
          </AnimatePresence>
        </button>
        <span aria-hidden className="board-notch-divider" />
        <button
          type="button"
          className="board-notch-action"
          onClick={share}
          disabled={!hasItems || shareState === "sharing"}
          aria-label="Share board"
          title="Share board"
        >
          {shareState === "sharing" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : shareState === "copied" ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Share2 className="h-3.5 w-3.5" />
          )}
          <span>{shareState === "copied" ? "Copied" : "Share"}</span>
        </button>
      </div>

      <BoardCarousel
        pages={pages}
        activeIndex={activePage}
        onNavigate={(delta) => setActivePage(activePage + delta)}
        renderPage={(page, i, isActive) => (
          <Canvas
            items={page.items}
            generation={generation}
            layouts={page.layouts}
            maxRows={maxRows}
            selectedIds={isActive ? selectedIds : undefined}
            onSelect={isActive ? handleCanvasSelect : undefined}
            onLayoutChange={(next) => patchPage(i, { layouts: next })}
            onRemove={(id) => removeItem(i, id)}
            onDropData={isActive ? handleDropData : undefined}
            onUpdateNoteText={(id, text) => updateNoteText(i, id, text)}
            onMaxRowsChange={isActive ? setMaxRows : undefined}
            acceptExternalDrop={isActive && !needsSetup}
            hideEmptyState={needsSetup}
          />
        )}
      />

      <Toolbar
        hasItems={hasItems}
        hasApiKey={hasApiKey}
        isGenerating={isGenerating}
        isDeletingShare={isDeletingShare}
        hasLastSharedBoard={hasLastSharedBoard}
        locked={needsSetup}
        pageCount={pages.length}
        activePage={activePage}
        history={history}
        onChangePage={setActivePage}
        onAddPage={addPage}
        onAddImage={(file) => void addImage(file)}
        onAddNote={addNote}
        onImport={openImportDialog}
        onGenerate={generate}
        onShare={() => setLockedShareOpen(true)}
        onDeleteLastShare={deleteLastShare}
        onOpenHistoryEntry={openHistoryEntry}
        onRemoveHistoryEntry={removeHistoryEntry}
      />

      {needsSetup && <SetupCards onComplete={() => setNeedsSetup(false)} />}

      <LockedShareDialog
        open={lockedShareOpen}
        busy={lockedShareBusy}
        onOpenChange={setLockedShareOpen}
        onCreate={shareLocked}
      />

      <Dialog
        open={deleteDialogIds !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogIds(null);
        }}
      >
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>
              Remove {deleteDialogIds?.length ?? 0} item
              {deleteDialogIds && deleteDialogIds.length !== 1 ? "s" : ""}?
            </DialogTitle>
            <DialogDescription className="text-pretty">
              These cards will be removed from this page. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteDialogIds(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                if (deleteDialogIds) removeItems(activePage, deleteDialogIds);
                setDeleteDialogIds(null);
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          if (!open && isImporting) return;
          setImportDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Import a shared board</DialogTitle>
            <DialogDescription>
              Paste a Shareboard link to load it onto your canvas. This replaces the current board — share or save it first if you want to keep it.
            </DialogDescription>
          </DialogHeader>
          <input
            autoFocus
            placeholder="https://..."
            value={importInput}
            onChange={(e) => setImportInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && importInput.trim() && !isImporting) {
                e.preventDefault();
                void importFromInput();
              }
            }}
            className="setup-dialog-tile-input"
          />
          <DialogFooter className="mt-2">
            <DialogClose render={<Button type="button" variant="outline" disabled={isImporting} />}>
              Cancel
            </DialogClose>
            <Button
              type="button"
              onClick={() => void importFromInput()}
              disabled={!importInput.trim() || isImporting}
            >
              {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!manualShareUrl}
        onOpenChange={(open) => {
          if (!open) setManualShareUrl("");
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Share link</DialogTitle>
            <DialogDescription>
              Your board was created, but the browser blocked automatic clipboard access.
            </DialogDescription>
          </DialogHeader>
          <input
            readOnly
            value={manualShareUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="setup-dialog-tile-input"
          />
          <DialogFooter className="mt-2">
            <DialogClose render={<Button type="button" variant="outline" />}>Done</DialogClose>
            <Button
              type="button"
              onClick={async () => {
                if (await copyText(manualShareUrl)) {
                  setManualShareUrl("");
                  markShareCopied();
                  notify.success("Link copied to clipboard");
                } else {
                  notify.error("Select the link to copy it");
                }
              }}
            >
              <Copy className="h-4 w-4" />
              Copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toasts slide up from bottom-right. When the page-nav pill is present
          (>1 page), we shift left past it so the two don't collide. */}
      <Toaster
        position="bottom-right"
        offset={{ bottom: "1.25rem", right: pages.length > 1 ? "12rem" : "1.25rem" }}
        mobileOffset={{ bottom: "1.25rem", right: pages.length > 1 ? "10rem" : "1rem" }}
      />
    </div>
  );
}
