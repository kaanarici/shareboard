import { lazy, Suspense, useCallback, useState } from "react";
import { BoardPassDialog } from "@/components/board-pass-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Download, Link2, Loader2, StickyNote } from "lucide-react";
import { notify } from "@/lib/toast";
import { importBoard } from "@/lib/share-import";
import { prepareHandoff } from "@/lib/share-prepare";
import { encodeHandoffUrl, formatHandoffCode } from "@/lib/handoff";
import { currentAuthor } from "@/lib/store";
import { isValidUrl } from "@/lib/platforms";
import { copyWithToast } from "@/lib/clipboard";
import type { Board, BoardOrigin, BoardPage } from "@/lib/types";
import { useRetained } from "@/lib/use-retained";
import { PROJECT_URL } from "@/lib/project";

const LockedShareDialog = lazy(() =>
  import("@/components/locked-share-dialog").then((module) => ({ default: module.LockedShareDialog })),
);
const UnlockBoardDialog = lazy(() =>
  import("@/components/locked-canvas").then((module) => ({ default: module.UnlockBoardDialog })),
);

function shortenToken(token: string): string {
  return token.length > 12 ? `${token.slice(0, 6)}…${token.slice(-4)}` : token;
}

function prettyShareUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, "");
    const token = u.hash.replace(/^#([a-z]=)?/, "");
    if (token) return `${host}${u.pathname}#${shortenToken(token)}`;
    const slash = u.pathname.lastIndexOf("/");
    return `${host}${u.pathname.slice(0, slash + 1)}${shortenToken(u.pathname.slice(slash + 1))}`;
  } catch {
    return raw;
  }
}

export function EditorDialogs({
  editor,
  share,
  pasteOpen,
  setPasteOpen,
  importOpen,
  setImportOpen,
  handoff,
  demo,
}: {
  editor: {
    restoreBoard: (board: Board, origin: BoardOrigin) => void;
    deleteDialogIds: string[] | null;
    setDeleteDialogIds: (ids: string[] | null) => void;
    removeItems: (pageIndex: number, ids: string[]) => void;
    activePage: number;
    addUrl: (url: string) => Promise<void> | void;
    addNote: (text: string) => void;
  };
  share: {
    lockedShareOpen: boolean;
    lockedShareBusy: boolean;
    setLockedShareOpen: (open: boolean) => void;
    shareLocked: (pin: string) => void;
    unlockEntry: { id: string } | null;
    unlockBusy: boolean;
    unlockError: string;
    closeUnlock: () => void;
    submitUnlockPin: (pin: string) => Promise<void> | void;
    manualShareUrl: string;
    setManualShareUrl: (url: string) => void;
    markShareCopied: () => void;
    ownerOnlyOpen: boolean;
    setOwnerOnlyOpen: (open: boolean) => void;
  };
  pasteOpen: boolean;
  setPasteOpen: (open: boolean) => void;
  importOpen: boolean;
  setImportOpen: (open: boolean) => void;
  handoff: {
    handoffCode: string;
    setHandoffCode: (code: string) => void;
  };
  demo: boolean;
}) {
  const {
    restoreBoard,
    deleteDialogIds,
    setDeleteDialogIds,
    removeItems,
    activePage,
    addUrl,
    addNote,
  } = editor;
  const {
    lockedShareOpen,
    lockedShareBusy,
    setLockedShareOpen,
    shareLocked,
    unlockEntry,
    unlockBusy,
    unlockError,
    closeUnlock,
    submitUnlockPin,
    manualShareUrl,
    setManualShareUrl,
    markShareCopied,
    ownerOnlyOpen,
    setOwnerOnlyOpen,
  } = share;
  const { handoffCode, setHandoffCode } = handoff;
  const shownShareUrl = useRetained(manualShareUrl, manualShareUrl !== "");
  const shownHandoffCode = useRetained(handoffCode, handoffCode !== "");
  const shownDeleteIds = useRetained(deleteDialogIds, deleteDialogIds !== null);
  const lockedShareMounted = useRetained(lockedShareOpen, lockedShareOpen);
  const unlockMounted = useRetained(unlockEntry !== null, unlockEntry !== null);
  const [importInput, setImportInput] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [pasteInput, setPasteInput] = useState("");

  const importFromInput = useCallback(async () => {
    const raw = importInput.trim();
    if (!raw || isImporting) return;
    setIsImporting(true);
    try {
      const result = await importBoard(raw);
      if (!result.ok) {
        const messageByError = {
          "invalid-input": "Paste a Shareboard link to import",
          "tiny-decode-failed": "Couldn't read that shared board",
          "fetch-failed": "Couldn't fetch that board (it may be on another host)",
          "handoff-gone": "That handoff code has expired or was already used",
          locked: "That board is locked. Open the link to view it.",
          unreadable: "That board is locked or not importable",
          "wrong-pin": "Wrong pin",
        } as const satisfies Record<typeof result.error, string>;
        notify.error(messageByError[result.error]);
        return;
      }
      restoreBoard(result.canvas, { kind: "draft" });
      setImportOpen(false);
      notify.success("Board imported");
    } finally {
      setIsImporting(false);
    }
  }, [importInput, isImporting, restoreBoard, setImportOpen]);

  const copyShareLink = async () => {
    if (await copyWithToast(manualShareUrl, "Link copied to clipboard", "Couldn't copy. Try again.")) markShareCopied();
  };

  const pasteValue = pasteInput.trim();
  const pasteKind = !pasteValue ? null : isValidUrl(pasteValue) ? "link" : "note";

  const submitPasteDialog = useCallback(() => {
    const value = pasteInput.trim();
    if (!value) return;
    if (isValidUrl(value)) void addUrl(value);
    else addNote(value);
    setPasteOpen(false);
    setPasteInput("");
  }, [pasteInput, addUrl, addNote, setPasteOpen]);

  return (
    <>
      {lockedShareMounted && (
        <Suspense fallback={null}>
          <LockedShareDialog
            open={lockedShareOpen}
            busy={lockedShareBusy}
            onOpenChange={setLockedShareOpen}
            onCreate={shareLocked}
          />
        </Suspense>
      )}

      {unlockMounted && (
        <Suspense fallback={null}>
          <UnlockBoardDialog
            open={unlockEntry !== null}
            busy={unlockBusy}
            error={unlockError}
            onOpenChange={(open) => {
              if (!open) closeUnlock();
            }}
            onUnlock={(pin) => void submitUnlockPin(pin)}
          />
        </Suspense>
      )}

      <Dialog open={ownerOnlyOpen} onOpenChange={setOwnerOnlyOpen}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>{demo ? "Images need your own Shareboard" : "Images need the owner"}</DialogTitle>
            <DialogDescription className="text-pretty">
              {demo
                ? "This demo shares text and link boards as links. To publish boards with images, run your own Shareboard. It's free on Cloudflare."
                : "Anyone can share text and link boards from this Shareboard. Boards with images are published by its owner. You can run your own Shareboard for free on Cloudflare."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOwnerOnlyOpen(false)}>
              Got it
            </Button>
            <Button
              type="button"
              onClick={() => {
                setOwnerOnlyOpen(false);
                window.open(PROJECT_URL, "_blank", "noopener,noreferrer");
              }}
            >
              Get your own
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteDialogIds !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogIds(null);
        }}
      >
        <DialogContent className="sm:max-w-[340px]">
          <DialogHeader>
            <DialogTitle>
              Remove {shownDeleteIds?.length ?? 0} item
              {shownDeleteIds && shownDeleteIds.length !== 1 ? "s" : ""}?
            </DialogTitle>
            <DialogDescription className="text-pretty">
              These cards will be removed from this page. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setDeleteDialogIds(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
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
        open={importOpen}
        onOpenChange={(open) => {
          if (!open && isImporting) return;
          setImportOpen(open);
          if (open) setImportInput("");
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Import a board</DialogTitle>
            <DialogDescription className="text-pretty">
              Paste a Shareboard link or a code from Send. It replaces the board you&apos;re editing.
            </DialogDescription>
          </DialogHeader>
          <input
            autoFocus
            aria-label="Shareboard link or code"
            placeholder="Link or code"
            value={importInput}
            onChange={(e) => setImportInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && importInput.trim() && !isImporting) {
                e.preventDefault();
                void importFromInput();
              }
            }}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            className="dialog-input"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={isImporting}
              onClick={() => setImportOpen(false)}
            >
              Cancel
            </Button>
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
        open={pasteOpen}
        onOpenChange={(open) => {
          setPasteOpen(open);
          if (open) setPasteInput("");
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Add to board</DialogTitle>
            <DialogDescription className="text-pretty">
              Paste a link to add a preview card, or type a note.
            </DialogDescription>
          </DialogHeader>
          <textarea
            autoFocus
            aria-label="Link or note"
            placeholder="Paste a link or start typing"
            value={pasteInput}
            onChange={(e) => setPasteInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && pasteInput.trim()) {
                e.preventDefault();
                submitPasteDialog();
              }
            }}
            rows={4}
            className="dialog-input"
          />
          <div className={pasteKind ? "dialog-hint" : "dialog-hint max-sm:hidden"}>
            {pasteKind === "link" ? <Link2 className="h-3.5 w-3.5" aria-hidden /> : null}
            {pasteKind === "note" ? <StickyNote className="h-3.5 w-3.5" aria-hidden /> : null}
            <span>{pasteKind === "link" ? "Adds a link card" : pasteKind === "note" ? "Adds a note" : "\u00a0"}</span>
            <span className="ml-auto hidden sm:inline">
              <kbd>Enter</kbd> to add, <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line
            </span>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={submitPasteDialog} disabled={!pasteKind}>
              {pasteKind === "link" ? "Add link" : pasteKind === "note" ? "Add note" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BoardPassDialog
        open={!!manualShareUrl}
        onClose={() => setManualShareUrl("")}
        title="Share link"
        description="Anyone with this link can view the board. Scan the code or copy it."
        qrUrl={shownShareUrl || null}
        primaryLabel="Copy link"
        onPrimary={copyShareLink}
      >
        <button
          type="button"
          className="share-link-chip"
          onClick={() => void copyShareLink()}
          aria-label="Copy share link"
        >
          <span className="share-link-chip-text">{prettyShareUrl(shownShareUrl)}</span>
          <Copy className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
        </button>
      </BoardPassDialog>

      <BoardPassDialog
        open={!!handoffCode}
        onClose={() => setHandoffCode("")}
        title="Open on another device"
        description="Scan the code with your phone, or type it into Import on another device. Nothing is published."
        qrUrl={shownHandoffCode ? encodeHandoffUrl(window.location.origin, shownHandoffCode) : null}
        primaryLabel="Copy code"
        onPrimary={() => void copyWithToast(formatHandoffCode(handoffCode), "Code copied", "Couldn't copy the code")}
      >
        <div className="board-pass-code">
          <p className="board-pass-code-value">
            {shownHandoffCode ? formatHandoffCode(shownHandoffCode) : ""}
          </p>
          <p className="board-pass-code-meta">Works once, expires in 1 hour</p>
        </div>
      </BoardPassDialog>
    </>
  );
}

export function useHandoffSend(pages: BoardPage[]) {
  const [handoffCode, setHandoffCode] = useState("");
  const [handoffSending, setHandoffSending] = useState(false);

  const sendToDevice = useCallback(async () => {
    if (handoffSending) return;
    setHandoffSending(true);
    try {
      const result = await prepareHandoff(pages, currentAuthor());
      if (!result.ok) {
        notify.error(
          result.error === "images"
            ? "Send only works for boards without images. Use Share to get a link instead."
            : result.message ?? "Couldn't send the board. Try again.",
        );
        return;
      }
      setHandoffCode(result.code);
    } finally {
      setHandoffSending(false);
    }
  }, [pages, handoffSending]);

  return { handoffCode, setHandoffCode, handoffSending, sendToDevice };
}
