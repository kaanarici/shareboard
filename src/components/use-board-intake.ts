import { useEffect, useRef } from "react";
import { notify } from "@/lib/toast";
import {
  clearSharedImageFiles,
  filesFromTransfer,
  looksLikeImageFilename,
  looksLikeJsonFilename,
  readSharedImageFiles,
  resolveClipboardIntake,
  resolveShareIntake,
  type EditorSearch,
  type ShareIntake,
} from "@/lib/intake";
import { parseClipHash } from "@/lib/bookmarklet";
import { isJsonFile } from "@/lib/json-policy";

function boardFilesFromTransfer(data: DataTransfer) {
  return filesFromTransfer(data, (file) => file.type.startsWith("image/") || isJsonFile(file));
}

function filesFromIntakeForm(form: FormData): File[] {
  return form.getAll("media").filter((value): value is File => value instanceof File);
}

type IntakeHandlers = {
  addUrl: (url: string) => unknown;
  addNote: (text: string) => unknown;
  addImage: (file: File) => unknown;
};

function applyShareIntake(intake: ShareIntake, { addUrl, addNote, addImage }: IntakeHandlers) {
  if (intake?.kind === "url") void addUrl(intake.url);
  if (intake?.kind === "svg") void addImage(intake.file);
  if (intake?.kind === "note") addNote(intake.text);
}

export function useBoardIntake({
  mounted,
  needsSetup,
  search,
  navigate,
  addUrl,
  addNote,
  addImage,
  addBoardFiles,
}: IntakeHandlers & {
  mounted: boolean;
  needsSetup: boolean;
  search: EditorSearch;
  navigate: (opts: { search: EditorSearch; replace: boolean }) => unknown;
  addBoardFiles: (files: File[]) => unknown;
}) {
  const shareIngestedRef = useRef(false);
  const sharedFilesIngestedRef = useRef(false);
  const handledIntakeRef = useRef<string | null>(null);

  const applyBoardTransfer = (data: DataTransfer, verb: "dropped" | "pasted") => {
    const boardFiles = boardFilesFromTransfer(data);
    if (boardFiles.length > 0) {
      void addBoardFiles(boardFiles);
      return true;
    }
    if (data.files.length > 0) {
      notify.error(`Only images and JSON files can be ${verb} into a board`);
      return true;
    }
    const intake = resolveClipboardIntake(data);
    if (intake?.kind === "note") {
      if (looksLikeImageFilename(intake.text)) {
        notify.error("Paste the image data or drop the file onto the board");
        return true;
      }
      if (looksLikeJsonFilename(intake.text)) {
        notify.error("Paste the JSON file or drop it onto the board");
        return true;
      }
    }
    if (intake) {
      applyShareIntake(intake, { addUrl, addNote, addImage });
      return true;
    }
    return false;
  };

  const handleDropData = (data: DataTransfer) => {
    if (needsSetup) return;
    applyBoardTransfer(data, "dropped");
  };

  const handlePasteRef = useRef<(e: ClipboardEvent) => void>(() => {});
  handlePasteRef.current = (e: ClipboardEvent) => {
    if (needsSetup) return;
    if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable], .tiptap")) return;

    const clipboard = e.clipboardData;
    if (!clipboard) return;
    if (applyBoardTransfer(clipboard, "pasted")) e.preventDefault();
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => handlePasteRef.current(e);
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  useEffect(() => {
    if (!mounted || needsSetup) return;
    if (search.shared === "lost") {
      notify.error("Images couldn't be received. Open Shareboard once, then share again.");
      sharedFilesIngestedRef.current = false;
      navigate({ search: {}, replace: true });
      return;
    }
    if (search.shared !== "1") {
      sharedFilesIngestedRef.current = false;
      return;
    }
    if (sharedFilesIngestedRef.current) return;
    sharedFilesIngestedRef.current = true;

    void (async () => {
      try {
        const files = await readSharedImageFiles();
        try {
          if (files.length > 0) await addBoardFiles(files);
        } finally {
          await clearSharedImageFiles();
        }
      } finally {
        navigate({ search: {}, replace: true });
      }
    })();
  }, [mounted, needsSetup, search.shared, addBoardFiles, navigate]);

  useEffect(() => {
    if (!mounted || needsSetup || !search.intake || handledIntakeRef.current === search.intake) return;
    const intakeId = search.intake;
    handledIntakeRef.current = intakeId;
    const { intake: _intake, ...remaining } = search;
    void (async () => {
      try {
        const res = await fetch(`/api/intake/${encodeURIComponent(intakeId)}`);
        if (res.ok) {
          const downloaded = filesFromIntakeForm(await res.formData());
          if (downloaded.length > 0) await addBoardFiles(downloaded);
        }
      } finally {
        await fetch(`/api/intake/${encodeURIComponent(intakeId)}`, { method: "DELETE" }).catch(() => undefined);
        navigate({ search: remaining, replace: true });
      }
    })();
  }, [mounted, needsSetup, search, addBoardFiles, navigate]);

  useEffect(() => {
    if (!mounted || needsSetup || search.intake) return;
    const { title, text, url } = search;
    if (!title && !text && !url) {
      shareIngestedRef.current = false;
      return;
    }
    if (shareIngestedRef.current) return;
    shareIngestedRef.current = true;

    const intake = resolveShareIntake({ title, text, url });
    applyShareIntake(intake, { addUrl, addNote, addImage });

    navigate({ search: {}, replace: true });
  }, [mounted, needsSetup, search, addUrl, addNote, addImage, navigate]);

  useEffect(() => {
    if (!mounted || needsSetup) return;

    const ingestClip = () => {
      const params = parseClipHash(window.location.hash);
      if (!params) return;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      applyShareIntake(resolveShareIntake(params), { addUrl, addNote, addImage });
    };

    ingestClip();
    window.addEventListener("hashchange", ingestClip);
    return () => window.removeEventListener("hashchange", ingestClip);
  }, [mounted, needsSetup, addUrl, addNote, addImage]);

  return { handleDropData };
}
