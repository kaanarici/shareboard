
import { useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import type { CanvasItem } from "@/lib/types";

type NoteItem = Extract<CanvasItem, { type: "note" }>;

export function NoteCard({
  item,
  readonly,
  onUpdateText,
}: {
  item: NoteItem;
  readonly?: boolean;
  onUpdateText?: (id: string, text: string) => void;
}) {
  const lastTextRef = useRef(item.text);
  lastTextRef.current = item.text;
  // Editing gates the drag/cursor behaviour: while editing, the editor is a
  // react-grid-layout drag-cancel zone (see the `cancel` selector in
  // auto-canvas) and shows the text caret; otherwise the whole note body is a
  // drag surface so the card can be grabbed from anywhere.
  const [editing, setEditing] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Type something…" }),
    ],
    content: item.text,
    editable: !readonly,
    immediatelyRender: false,
    onFocus: () => setEditing(true),
    onBlur: () => setEditing(false),
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      if (html === lastTextRef.current) return;
      lastTextRef.current = html;
      onUpdateText?.(item.id, html);
    },
    editorProps: {
      attributes: {
        class: "outline-none h-full",
      },
    },
  });

  // The browser focuses a contenteditable natively at mousedown — before any
  // drag begins — so a card drag would end with the caret in the editor.
  // While not editing, suppress that native focus (preventDefault on
  // mousedown; react-grid-layout ignores defaultPrevented, so drag still
  // works) and place the caret ourselves on a clean click (< 4px travel),
  // at the clicked text position.
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNativeFocus = (e: React.MouseEvent) => {
    pointerDownRef.current = { x: e.clientX, y: e.clientY };
    if (!readonly && !editing) e.preventDefault();
  };
  const focusEditor = (e: React.MouseEvent) => {
    if (readonly || editing || !editor) return;
    const down = pointerDownRef.current;
    pointerDownRef.current = null;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
    editor.chain().focus(pos?.pos ?? "end").run();
  };

  return (
    <div
      className={`flex h-full flex-col bg-card p-4 ${
        readonly ? "" : editing ? "cursor-text" : "cursor-grab"
      }`}
      onMouseDown={suppressNativeFocus}
      onClick={focusEditor}
    >
      <div
        className="flex-1 min-h-0 overflow-auto note-scroll"
        data-editing={editing ? "true" : undefined}
      >
        <EditorContent editor={editor} className="h-full text-sm leading-relaxed" />
      </div>
    </div>
  );
}
