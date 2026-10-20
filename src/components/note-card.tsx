
import { useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import type { BoardItem } from "@/lib/types";

type NoteItem = Extract<BoardItem, { type: "note" }>;

export function NoteCard({
  item,
  readonly,
  onUpdateText,
}: {
  item: NoteItem;
  readonly?: boolean;
  onUpdateText?: (id: string, text: string) => void;
}) {
  const lastTextRef = useRef(item.html);
  lastTextRef.current = item.html;
  const [editing, setEditing] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Type something…" }),
    ],
    content: item.html,
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
