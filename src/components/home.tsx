import { useState, useCallback, useRef, useMemo } from "react";
import { useMountEffect } from "@/lib/use-mount-effect";
import { nanoid } from "nanoid";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { notify } from "@/lib/toast";
import { Canvas } from "@/components/canvas";
import { Toolbar } from "@/components/toolbar";
import { SetupCards } from "@/components/setup-dialog";
import { BoardCarousel } from "@/components/board-carousel";
import { MobileEditorBanner } from "@/components/mobile-editor-banner";
import { Toaster } from "@/components/ui/sonner";
import {
  clearLastSharedBoard,
  getLastSharedBoard,
  getApiKey,
  getName,
  getProfile,
  isSetup,
  saveLastSharedBoard,
} from "@/lib/store";
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
  CanvasItem,
  GenerateResponse,
  GridLayouts,
  UrlItem,
} from "@/lib/types";
import { BOARD_SUMMARY_ITEM_ID, isDraftImageItem } from "@/lib/types";

type SharePayload = {
  author: string;
  authorProfile: ReturnType<typeof getProfile>;
  generation: GenerateResponse | null;
  pages: Array<{
    id: string;
    layouts: GridLayouts;
    items: Array<
      | UrlItem
      | { id: string; type: "image"; mimeType?: string; caption?: string }
      | { id: string; type: "note"; text: string }
    >;
  }>;
};

type ShareResponse = {
  id: string;
  deleteToken: string;
};

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
  const [isDeletingShare, setIsDeletingShare] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [hasLastSharedBoard, setHasLastSharedBoard] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [maxRows, setMaxRows] = useState(estimateMaxRowsFromViewport);
  const [settingsEpoch, setSettingsEpoch] = useState(0);
  // Keep latest pages in a ref so the unmount blob-URL cleanup can walk them
  // without being a dep of the mount effect. Assignment during render is safe —
  // it doesn't trigger renders.
  const pagesRef = useRef<BoardPage[]>([]);
  pagesRef.current = pages;

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

  const hasApiKey = useMemo(() => !!getApiKey().trim(), [settingsEpoch]);
  const itemsOnActive = pages[activePage]?.items ?? [];
  const totalContentItems = useMemo(
    () => pages.reduce((n, p) => n + p.items.filter((i) => i.type !== "board_summary").length, 0),
    [pages]
  );
  const hasItems = totalContentItems > 0;

  // Mount-only: hydrate localStorage-backed flags, subscribe to settings
  // changes, and revoke blob URLs on unmount. Using useMountEffect (the only
  // sanctioned useEffect wrapper) keeps this file useEffect-free.
  useMountEffect(() => {
    setMounted(true);
    setNeedsSetup(!isSetup());
    setHasLastSharedBoard(!!getLastSharedBoard());

    const onSettings = () => setSettingsEpoch((e) => e + 1);
    window.addEventListener("shareboard-settings", onSettings);

    return () => {
      window.removeEventListener("shareboard-settings", onSettings);
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
        const landed = tentative.lg.find((l) => l.i === item.id);
        const fits = !landed || landed.y + landed.h <= maxRows;
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

      try {
        const res = await fetch(`/api/og?url=${encodeURIComponent(rawUrl)}`);
        if (res.ok) {
          const ogData = await res.json();
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
    (file: File, caption?: string) => {
      const id = nanoid(10);
      const item: CanvasItem = {
        id,
        type: "image",
        file,
        previewUrl: URL.createObjectURL(file),
        mimeType: file.type || undefined,
        caption,
      };
      addItemWithSpill(item);
    },
    [addItemWithSpill]
  );

  const addNote = useCallback(
    (text: string) => {
      const id = nanoid(10);
      const item: CanvasItem = { id, type: "note" as const, text };
      addItemWithSpill(item);
    },
    [addItemWithSpill]
  );

  const removeItem = useCallback(
    (pageIndex: number, id: string) => {
      patchPage(pageIndex, (page) => {
        const removed = page.items.find((item) => item.id === id);
        if (removed && isDraftImageItem(removed)) URL.revokeObjectURL(removed.previewUrl);
        return {
          ...page,
          items: page.items.filter((item) => item.id !== id),
          layouts: {
            lg: page.layouts.lg.filter((l) => l.i !== id),
            sm: page.layouts.sm.filter((l) => l.i !== id),
          },
        };
      });
      if (id === BOARD_SUMMARY_ITEM_ID) setGeneration(null);
      else
        setGeneration((g) =>
          g
            ? { ...g, item_summaries: g.item_summaries.filter((s) => s.item_id !== id) }
            : g
        );
      setSelectedId((sel) => (sel === id ? null : sel));
    },
    [patchPage]
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
        setSelectedId(newId);
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
        const err = await res.json().catch(() => ({ error: "Generation failed" }));
        notify.error(err.error || "Generation failed");
        return;
      }
      const data = (await res.json()) as GenerateResponse;
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
      notify.success("Summary generated");
    } catch {
      notify.error("Failed to connect");
    } finally {
      setIsGenerating(false);
    }
  }, [pages, patchPage, maxRows, setActivePage]);

  const share = useCallback(async () => {
    try {
      const form = new FormData();
      const payload: SharePayload = {
        author: getName(),
        authorProfile: getProfile(),
        generation,
        pages: pages.map((page) => ({
          id: page.id,
          layouts: page.layouts,
          items: page.items
            .filter((item) => item.type !== "board_summary")
            .map((item) => {
              if (item.type === "image") {
                return {
                  id: item.id,
                  type: "image" as const,
                  mimeType: item.mimeType,
                  caption: item.caption,
                };
              }
              return item;
            }),
        })),
      };

      form.set("payload", JSON.stringify(payload));
      for (const page of pages) {
        for (const item of page.items) {
          if (item.type === "board_summary") continue;
          if (isDraftImageItem(item)) {
            form.set(`image:${item.id}`, item.file, item.file.name || `${item.id}.bin`);
          }
        }
      }

      const res = await fetch("/api/share", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to share" }));
        notify.error(err.error || "Failed to share");
        return;
      }
      const { id, deleteToken } = (await res.json()) as ShareResponse;
      const shareUrl = `${window.location.origin}/c/${id}`;
      await navigator.clipboard.writeText(shareUrl);
      saveLastSharedBoard({ id, deleteToken, shareUrl });
      setHasLastSharedBoard(true);
      notify.success("Link copied to clipboard");
    } catch {
      notify.error("Failed to share");
    }
  }, [pages, generation]);

  const deleteLastShare = useCallback(async () => {
    const lastShare = getLastSharedBoard();
    if (!lastShare) {
      notify.error("No saved share to delete");
      setHasLastSharedBoard(false);
      return;
    }

    setIsDeletingShare(true);
    try {
      const res = await fetch(`/api/share?id=${encodeURIComponent(lastShare.id)}`, {
        method: "DELETE",
        headers: { "X-Delete-Token": lastShare.deleteToken },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to delete share" }));
        notify.error(err.error || "Failed to delete share");
        return;
      }

      clearLastSharedBoard();
      setHasLastSharedBoard(false);
      notify.success("Last shared board deleted");
    } catch {
      notify.error("Failed to delete share");
    } finally {
      setIsDeletingShare(false);
    }
  }, []);

  const handleDropData = useCallback(
    (data: DataTransfer) => {
      if (needsSetup) return;

      const files = Array.from(data.files);
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length > 0) {
        for (const file of imageFiles) addImage(file);
        notify.success(imageFiles.length === 1 ? "Image added" : `${imageFiles.length} images added`);
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
        addImage(createSvgFile(svgSource));
        notify.success("SVG added");
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
    const target = e.target as HTMLElement;
    if (
      target.closest("input, textarea, select") ||
      target.isContentEditable ||
      target.closest(".tiptap") ||
      target.closest("[contenteditable]")
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
      addImage(file);
      notify.success("Image pasted");
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
      addImage(createSvgFile(svgSource));
      notify.success("SVG added");
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

  // Same latest-handler ref pattern for keydown shortcuts.
  const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  handleKeyDownRef.current = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (!inField && !needsSetup) {
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

      if (inField) return;
      if (!selectedId) return;

      const selected = itemsOnActive.find((i) => i.id === selectedId);
      if (!selected) return;

      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        removeItem(activePage, selectedId);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "d") {
        e.preventDefault();
        duplicateItem(activePage, selectedId);
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
          text = "url" in selected ? selected.url : selected.caption ?? selected.file.name;
        navigator.clipboard.writeText(text);
        notify.success("Copied");
        return;
      }

      if (e.key === "Escape") setSelectedId(null);
  };

  // Install document-level paste and keydown listeners exactly once. Each
  // delegates to its *Ref handler so closure state stays fresh without
  // resubscribing (see rapid-paste bug fix).
  useMountEffect(() => {
    const onPaste = (e: ClipboardEvent) => handlePasteRef.current(e);
    const onKeyDown = (e: KeyboardEvent) => handleKeyDownRef.current(e);
    document.addEventListener("paste", onPaste);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("keydown", onKeyDown);
    };
  });

  if (!mounted) return null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <MobileEditorBanner />
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
            selectedId={isActive ? selectedId : null}
            onSelect={isActive ? setSelectedId : undefined}
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
        onChangePage={setActivePage}
        onAddPage={addPage}
        onAddImage={addImage}
        onAddNote={addNote}
        onGenerate={generate}
        onShare={share}
        onDeleteLastShare={deleteLastShare}
      />

      {needsSetup && <SetupCards onComplete={() => setNeedsSetup(false)} />}

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
