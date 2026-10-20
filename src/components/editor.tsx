import { useEffect, useState } from "react";
import { Check, Loader2, MonitorSmartphone, Share2 } from "lucide-react";
import { Canvas } from "@/components/canvas";
import { Toolbar } from "@/components/toolbar";
import { SetupCards } from "@/components/setup-dialog";
import { BoardCarousel } from "@/components/board-carousel";
import { Toaster } from "@/components/ui/sonner";
import { EditorDialogs, useHandoffSend } from "@/components/editor-dialogs";
import { useEditorBoard } from "@/components/use-editor-board";
import { useBoardIntake } from "@/components/use-board-intake";
import { useShareFlows } from "@/components/use-share-flows";
import { useIsMobile } from "@/lib/use-is-mobile";
import { Hint } from "@/components/ui/tooltip";
import { isDemo, useOwner } from "@/lib/owner-client";

export function Editor() {
  const isMobile = useIsMobile();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const editor = useEditorBoard();
  const handoff = useHandoffSend(editor.pages);
  const owner = useOwner();
  const canPublish = owner.status === "owner";
  const demo = isDemo(owner);
  const { needsSetup, setNeedsSetup } = editor;
  useEffect(() => {
    if (demo && needsSetup) setNeedsSetup(false);
  }, [demo, needsSetup, setNeedsSetup]);
  const share = useShareFlows(editor, canPublish);
  const { handleDropData } = useBoardIntake({
    mounted: editor.mounted,
    needsSetup: editor.needsSetup,
    search: editor.search,
    navigate: editor.navigate,
    addUrl: editor.addUrl,
    addNote: editor.addNote,
    addImage: editor.addImage,
    addBoardFiles: editor.addBoardFiles,
  });

  if (!editor.mounted) return null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="board-notch" data-locked={editor.needsSetup || undefined}>
        <Hint label="Get a link anyone can open" side="bottom">
          <button
            type="button"
            className="board-notch-action"
            onClick={share.share}
            disabled={!editor.hasItems || share.shareState === "sharing"}
            aria-label="Share board"
          >
            {share.shareState === "sharing" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : share.shareState === "copied" ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Share2 className="h-3.5 w-3.5" />
            )}
            <span>{share.shareState === "copied" ? "Copied" : "Share"}</span>
          </button>
        </Hint>
        {canPublish ? (
          <Hint label="Open this board on your other device" side="bottom">
            <button
              type="button"
              className="board-notch-action"
              onClick={() => void handoff.sendToDevice()}
              disabled={!editor.hasItems || handoff.handoffSending}
              aria-label="Send board to another device"
            >
              {handoff.handoffSending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MonitorSmartphone className="h-3.5 w-3.5" />
              )}
              <span>Send</span>
            </button>
          </Hint>
        ) : null}
      </div>

      <BoardCarousel
        pages={editor.pages}
        activeIndex={editor.activePage}
        onNavigate={(delta) => editor.setActivePage(editor.activePage + delta)}
        renderPage={(page, i, isActive) => (
          <Canvas
            items={page.items}
            layouts={page.layouts}
            maxRows={editor.maxRows}
            selectedIds={isActive ? editor.selectedIds : undefined}
            onSelect={isActive ? editor.handleCanvasSelect : undefined}
            onSelectMany={isActive ? editor.handleCanvasSelectMany : undefined}
            onLayoutChange={(next) => editor.patchPage(i, { layouts: next })}
            onRemove={(id) => editor.removeItem(i, id)}
            onDropData={isActive ? handleDropData : undefined}
            onUpdateNoteText={editor.updateNoteText}
            onMaxRowsChange={isActive ? editor.setMaxRows : undefined}
            acceptExternalDrop={isActive && !editor.needsSetup}
            hideEmptyState={editor.needsSetup}
          />
        )}
      />

      <Toolbar
        hasItems={editor.hasItems}
        locked={editor.needsSetup}
        pageCount={editor.pages.length}
        activePage={editor.activePage}
        boards={editor.boards}
        openingEntryId={share.openingEntryId}
        onChangePage={editor.setActivePage}
        onAddFile={(file) => void editor.addFile(file)}
        onPasteLink={() => setPasteOpen(true)}
        onImport={() => setImportOpen(true)}
        onLockedShare={() => share.setLockedShareOpen(true)}
        onNewBoard={editor.newBoard}
        onOpenBoard={(entry) => {
          void share.openBoardEntry(entry);
        }}
        onRemoveBoard={(entry) => void share.removeBoard(entry)}
      />

      {editor.needsSetup && owner.status !== "loading" && !demo && <SetupCards onComplete={() => editor.setNeedsSetup(false)} />}

      <EditorDialogs
        editor={editor}
        share={share}
        demo={demo}
        pasteOpen={pasteOpen}
        setPasteOpen={setPasteOpen}
        importOpen={importOpen}
        setImportOpen={setImportOpen}
        handoff={handoff}
      />

      <Toaster
        position={isMobile ? "top-center" : "bottom-right"}
        offset={{ bottom: "1.25rem", right: editor.pages.length > 1 ? "12rem" : "1.25rem" }}
        mobileOffset={{ top: "3rem", left: "1rem", right: "1rem" }}
      />
    </div>
  );
}
