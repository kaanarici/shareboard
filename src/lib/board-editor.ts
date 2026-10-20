import { LIMITS } from "@/lib/limits";
import { notify } from "@/lib/toast";
import { formatBytes } from "@/lib/image-policy";
import type { BoardItem, BoardPage } from "@/lib/types";

function mediaBytesForItems(items: readonly BoardItem[]) {
  return items.reduce((sum, item) => sum + (item.type === "image" ? (item.size ?? 0) : 0), 0);
}

export function jsonBytesForItems(items: readonly BoardItem[]) {
  return items.reduce((sum, item) => sum + (item.type === "json" ? item.size : 0), 0);
}

function mediaBytesForPages(pages: readonly BoardPage[]) {
  return pages.reduce((sum, page) => sum + mediaBytesForItems(page.items), 0);
}

function jsonBytesForPages(pages: readonly BoardPage[]) {
  return pages.reduce((sum, page) => sum + jsonBytesForItems(page.items), 0);
}

export async function fileFingerprint(file: File) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function boardBudgetError(pages: readonly BoardPage[], adding: readonly BoardItem[]): string | null {
  if (mediaBytesForPages(pages) + mediaBytesForItems(adding) > LIMITS.maxBoardImageBytes) {
    return `Boards can hold up to ${formatBytes(LIMITS.maxBoardImageBytes)} of images`;
  }
  if (jsonBytesForPages(pages) + jsonBytesForItems(adding) > LIMITS.maxBoardJsonBytes) {
    return `Boards can hold up to ${formatBytes(LIMITS.maxBoardJsonBytes)} of JSON`;
  }
  return null;
}

type EditorKeyState = {
  needsSetup: boolean;
  deleteDialogOpen: boolean;
  activePage: number;
  pageCount: number;
  itemsOnActive: readonly BoardItem[];
  selectedIds: readonly string[];
  clipboard: readonly BoardItem[];
};

type EditorKeyActions = {
  setActivePage: (page: number) => void;
  setSelectedIds: (ids: string[]) => void;
  setDeleteDialogIds: (ids: string[]) => void;
  pasteBoardItems: (items: BoardItem[]) => boolean;
  removeItem: (page: number, id: string) => void;
  duplicateItem: (page: number, id: string) => void;
  setClipboard: (items: BoardItem[]) => void;
};

export function handleEditorKeyDown(e: KeyboardEvent, state: EditorKeyState, actions: EditorKeyActions) {
  if (!(e.target instanceof HTMLElement)) return;
  const target = e.target;
  const inField =
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable ||
    !!target.closest('[contenteditable="true"]');

  if (state.deleteDialogOpen) return;
  if (inField) return;

  if (target.closest("[data-slot=dialog-content]") || target.closest("[data-slot=dialog-overlay]")) {
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
    e.preventDefault();
    if (!state.needsSetup && state.itemsOnActive.length > 0) {
      actions.setSelectedIds(state.itemsOnActive.map((i) => i.id));
    }
    return;
  }

  if (!state.needsSetup) {
    if (e.key === "ArrowLeft" && state.activePage > 0) {
      e.preventDefault();
      actions.setActivePage(state.activePage - 1);
      return;
    }
    if (e.key === "ArrowRight" && state.activePage < state.pageCount - 1) {
      e.preventDefault();
      actions.setActivePage(state.activePage + 1);
      return;
    }
  }

  if (state.needsSetup) return;

  const key = e.key.toLowerCase();

  if ((e.metaKey || e.ctrlKey) && key === "v") {
    if (state.clipboard.length === 0) return;
    e.preventDefault();
    actions.pasteBoardItems([...state.clipboard]);
    return;
  }

  if (state.selectedIds.length === 0) return;

  if ((e.metaKey || e.ctrlKey) && key === "c") {
    e.preventDefault();
    const selected = state.itemsOnActive.filter((item) => state.selectedIds.includes(item.id));
    actions.setClipboard(selected);
    if (selected.length > 0) {
      notify.success(selected.length > 1 ? "Copied items" : "Copied item");
    }
    return;
  }

  if (e.key === "Backspace" || e.key === "Delete") {
    e.preventDefault();
    if (state.selectedIds.length > 1) {
      actions.setDeleteDialogIds([...state.selectedIds]);
      return;
    }
    const only = state.itemsOnActive.find((i) => i.id === state.selectedIds[0]);
    if (only) actions.removeItem(state.activePage, only.id);
    return;
  }

  if (state.selectedIds.length > 1) {
    if (e.key === "Escape") {
      e.preventDefault();
      actions.setSelectedIds([]);
    }
    return;
  }

  const selected = state.itemsOnActive.find((i) => i.id === state.selectedIds[0]);
  if (!selected) return;

  if ((e.metaKey || e.ctrlKey) && key === "d") {
    e.preventDefault();
    actions.duplicateItem(state.activePage, selected.id);
    return;
  }

  if (e.key === "Escape") {
    e.preventDefault();
    actions.setSelectedIds([]);
  }
}
