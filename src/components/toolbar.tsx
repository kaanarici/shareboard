import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { EMPTY_PROFILE_DRAFT, readProfileDraft, saveProfileDraft } from "@/lib/store";
import {
  Library,
  LockKeyhole,
  Settings,
  Loader2,
  Trash2,
  Plus,
  Download,
  Copy,
  Pencil,
  FilePlus,
  ClipboardPaste,
  Bookmark,
  GripVertical,
} from "lucide-react";
import { buildBookmarklet } from "@/lib/bookmarklet";
import { copyWithToast } from "@/lib/clipboard";
import { PageNav } from "@/components/page-nav";
import { ActionFan, type ActionFanItem } from "@/components/action-fan";
import { ProfileFields } from "@/components/profile-fields";
import type { BoardListEntry } from "@/lib/boards";
import { Hint } from "@/components/ui/tooltip";
import { notify } from "@/lib/toast";
import { createDeviceLink, useOwner } from "@/lib/owner-client";
import { OwnerPanel } from "@/components/owner-panel";
import { BoardPassDialog } from "@/components/board-pass-dialog";
import { useRetained } from "@/lib/use-retained";
import { useIsMobile } from "@/lib/use-is-mobile";

function boardSubtitle(entry: BoardListEntry): string {
  switch (entry.kind) {
    case "tiny":
      return "Link share";
    case "stored":
      return "Public share";
    case "locked":
      return "PIN-protected share";
    default: {
      const _never: never = entry.kind;
      return _never;
    }
  }
}

export function Toolbar({
  hasItems,
  locked,
  pageCount,
  activePage,
  boards,
  openingEntryId,
  onChangePage,
  onAddFile,
  onPasteLink,
  onImport,
  onLockedShare,
  onNewBoard,
  onOpenBoard,
  onRemoveBoard,
  onRedoSetup,
}: {
  hasItems: boolean;
  locked?: boolean;
  pageCount: number;
  activePage: number;
  boards: BoardListEntry[];
  openingEntryId: string | null;
  onChangePage: (next: number) => void;
  onAddFile: (file: File) => void;
  onPasteLink: () => void;
  onImport: () => void;
  onLockedShare: () => void;
  onNewBoard: () => void;
  onOpenBoard: (entry: BoardListEntry) => void;
  onRemoveBoard: (entry: BoardListEntry) => void;
  onRedoSetup?: () => void;
}) {
  const [openMenu, setOpenMenu] = useState<"settings" | "boards" | null>(null);
  const settingsOpen = openMenu === "settings";
  const boardsOpen = openMenu === "boards";
  const toggleMenu = (id: "settings" | "boards") => {
    if (id === "settings" && !settingsOpen) setProfile(readProfileDraft());
    setOpenMenu((prev) => (prev === id ? null : id));
  };
  const closeMenu = () => setOpenMenu(null);

  const [profile, setProfile] = useState(EMPTY_PROFILE_DRAFT);
  const isMobile = useIsMobile();
  const owner = useOwner();
  const isOwner = owner.status === "owner";
  const [deviceLink, setDeviceLink] = useState("");
  const shownDeviceLink = useRetained(deviceLink, deviceLink !== "");

  const addDevice = () => {
    closeMenu();
    createDeviceLink()
      .then((link) => setDeviceLink(link.url))
      .catch((error: unknown) => notify.error(error instanceof Error ? error.message : "Couldn't create a device link"));
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const bookmarkletRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const el = bookmarkletRef.current;
    if (!settingsOpen || !el) return;
    el.setAttribute("href", buildBookmarklet(window.location.origin));
  }, [settingsOpen]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onAddFile(file);
    e.target.value = "";
  };

  const fanItems: ActionFanItem[] = [
    {
      label: "Paste link or note",
      icon: <ClipboardPaste className="h-4 w-4" />,
      onClick: onPasteLink,
    },
    {
      label: "Upload file",
      icon: <FilePlus className="h-4 w-4" />,
      onClick: () => fileRef.current?.click(),
    },
    {
      label: "Import shared board",
      icon: <Download className="h-4 w-4" />,
      onClick: onImport,
    },
  ];
  if (isOwner) {
    fanItems.push({
      label: "Share with PIN",
      icon: <LockKeyhole className="h-4 w-4" />,
      onClick: onLockedShare,
      disabled: !hasItems,
    });
  }

  const saveSettings = () => {
    saveProfileDraft(profile);
    closeMenu();
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,.json,application/json"
        className="hidden"
        onChange={handleFile}
      />

      <BoardPassDialog
        open={deviceLink !== ""}
        onClose={() => setDeviceLink("")}
        title="Add a device"
        description="Scan this with your phone, or open the link on another computer. That device will be able to publish. The link works once, for 10 minutes."
        qrUrl={shownDeviceLink || null}
        primaryLabel="Copy link"
        onPrimary={() => void copyWithToast(shownDeviceLink, "Link copied", "Couldn't copy the link")}
      >
        <p className="board-pass-code-meta text-center">Anyone with this link can publish here, so only open it on your own devices.</p>
      </BoardPassDialog>

      <div
        className="board-toolbar"
        data-locked={locked || undefined}
        inert={locked || undefined}
        aria-hidden={locked || undefined}
      >
        <div className="board-toolbar-left">
          <ToolbarMenu
            open={settingsOpen}
            onToggle={() => toggleMenu("settings")}
            onClose={closeMenu}
            ariaLabel="Settings"
            popupClassName="board-popover board-popover--settings"
            triggerIcon={<Settings className="h-4 w-4 text-foreground/60" />}
          >
            <ProfileFields
              value={profile}
              onChange={setProfile}
            />

            <OwnerPanel owner={owner} onAddDevice={addDevice} />

            {isMobile || !isOwner ? null : (
              <div className="setup-dialog-tile">
                <span className="setup-dialog-tile-label">Save pages from any website</span>
                <span className="bookmarklet-hint">
                  Drag this button to your bookmarks bar. Click it on any page to add that page to your board.
                </span>
                <a
                  ref={bookmarkletRef}
                  href="#"
                  draggable
                  onClick={(e) => {
                    e.preventDefault();
                    notify.success("Drag the button to your bookmarks bar to install it");
                  }}
                  className="bookmarklet-chip"
                >
                  <GripVertical className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
                  <Bookmark className="h-4 w-4 shrink-0" aria-hidden />
                  Save to Shareboard
                </a>
              </div>
            )}

            <Button
              onClick={saveSettings}
              className="h-11 w-full rounded-full text-[14px] font-medium bg-foreground hover:bg-foreground/90 text-background"
            >
              Save
            </Button>
            {onRedoSetup ? (
              <button
                type="button"
                className="owner-button owner-button--quiet w-full justify-center"
                onClick={() => {
                  closeMenu();
                  onRedoSetup();
                }}
              >
                Run setup again
              </button>
            ) : null}
          </ToolbarMenu>

          <ToolbarMenu
            open={boardsOpen}
            onToggle={() => toggleMenu("boards")}
            onClose={closeMenu}
            ariaLabel="Boards"
            popupClassName="board-popover board-popover--history"
            triggerIcon={<Library className="h-4 w-4 text-foreground/60" />}
          >
            <div className="board-popover-section board-history">
              <button
                type="button"
                className="board-history-row board-history-new"
                disabled={!hasItems}
                onClick={() => {
                  onNewBoard();
                  closeMenu();
                }}
              >
                <FilePlus className="h-4 w-4 text-foreground/60" aria-hidden />
                <span className="board-history-title">New board</span>
              </button>
              {boards.length === 0 ? (
                <div className="board-history-empty">
                  Boards you share show up here. This list is saved in this
                  browser only.
                </div>
              ) : (
                boards.map((entry) => {
                  const isOpening = openingEntryId === entry.id;
                  const removeTooltip = entry.kind === "tiny" ? "Remove from this browser" : "Delete share";
                  return (
                    <div className="board-history-row" key={entry.id}>
                      <button
                        type="button"
                        className="board-history-main"
                        onClick={() => {
                          onOpenBoard(entry);
                          closeMenu();
                        }}
                      >
                        <span className="board-history-title">{entry.title}</span>
                        <span className="board-history-subtitle">{boardSubtitle(entry)}</span>
                      </button>
                      <div className="board-history-actions">
                        <Hint label="Copy link">
                          <button
                            type="button"
                            className="board-history-action"
                            aria-label={`Copy link to ${entry.title}`}
                            onClick={() => void copyWithToast(entry.shareUrl, "Link copied to clipboard", "Couldn't copy link")}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </Hint>
                        <Hint label="Open">
                          <button
                            type="button"
                            className="board-history-action"
                            aria-label={`Open ${entry.title}`}
                            disabled={isOpening}
                            onClick={() => {
                              onOpenBoard(entry);
                              closeMenu();
                            }}
                          >
                            {isOpening ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Pencil className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </Hint>
                        <Hint label={removeTooltip}>
                          <button
                            type="button"
                            className="board-history-action"
                            aria-label={`${removeTooltip} for ${entry.title}`}
                            onClick={() => void onRemoveBoard(entry)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </Hint>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ToolbarMenu>
        </div>

        <div className="board-toolbar-center">
          <ActionFan
            triggerClassName="board-toolbar-add"
            trigger={<Plus className="h-5 w-5" strokeWidth={2.25} />}
            items={fanItems}
          />
        </div>

        <div className="board-toolbar-right">
          <PageNav
            pageCount={pageCount}
            activeIndex={activePage}
            onChange={onChangePage}
          />
        </div>
      </div>
    </>
  );
}

function ToolbarMenu({
  open,
  onToggle,
  onClose,
  ariaLabel,
  triggerIcon,
  popupClassName,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  ariaLabel: string;
  triggerIcon: ReactNode;
  popupClassName: string;
  children: ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (e.target instanceof Node && wrapperRef.current?.contains(e.target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div ref={wrapperRef} className="board-toolbar-menu">
      <Hint label={ariaLabel}>
        <button
          type="button"
          className="board-toolbar-icon"
          aria-label={ariaLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={onToggle}
        >
          {triggerIcon}
        </button>
      </Hint>
      <AnimatePresence>
        {open && (
          <motion.div
            key="popup"
            className={`board-toolbar-menu-popup ${popupClassName}`}
            initial={{ opacity: 0, y: 8, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{
              opacity: 0,
              y: 4,
              scale: 0.96,
              transition: { duration: 0.1, ease: "easeOut" },
            }}
            transition={{ type: "spring", stiffness: 320, damping: 26, mass: 0.8 }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
