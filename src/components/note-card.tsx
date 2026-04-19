
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import type { CanvasItem, ItemSummary } from "@/lib/types";

type NoteItem = Extract<CanvasItem, { type: "note" }>;

export function NoteCard({
  item,
  summary,
  readonly,
  onUpdateText,
}: {
  item: NoteItem;
  summary?: ItemSummary;
  readonly?: boolean;
  onUpdateText?: (id: string, text: string) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Type something…" }),
    ],
    content: item.text,
    editable: !readonly,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onUpdateText?.(item.id, editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "outline-none h-full",
      },
    },
  });

  return (
    <div
      className="flex h-full flex-col bg-card p-4"
      onPointerDownCapture={(e) => {
        // Prevent grid drag when interacting with the editor
        if (!readonly) e.stopPropagation();
      }}
    >
      <div className="flex-1 min-h-0 overflow-auto">
        <EditorContent editor={editor} className="h-full text-sm leading-relaxed" />
      </div>
      {summary?.summary && (
        <p className="mt-3 border-t border-border/40 pt-2 text-xs text-muted-foreground shrink-0">
          {summary.summary}
        </p>
      )}
    </div>
  );
}
