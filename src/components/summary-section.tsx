
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { OverallSummary } from "@/lib/types";

export function SummarySection({ summary }: { summary: OverallSummary }) {
  return (
    <div className="flex h-full flex-col">
      <h2 className="mb-2 text-base font-semibold">{summary.title}</h2>
      <div className="prose prose-sm prose-neutral max-w-none flex-1 overflow-auto text-sm [&_p]:leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {summary.explanation}
        </ReactMarkdown>
      </div>
      {summary.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {summary.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-lg bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
