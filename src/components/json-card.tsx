import { FileJson } from "lucide-react";
import type { CanvasItem } from "@/lib/types";
import { formatBytes } from "@/lib/image-policy";

type JsonItem = Extract<CanvasItem, { type: "json" }>;

export function JsonCard({ item }: { item: JsonItem }) {
  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-2">
        <FileJson className="h-4 w-4 text-foreground/60" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.name}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(item.size)}</span>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {item.text}
      </pre>
    </div>
  );
}
