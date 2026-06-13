
import { Tweet, TweetSkeleton } from "react-tweet";
import { extractTweetId } from "@/lib/youtube";

export function TweetEmbed({
  url,
  interactionOverlay,
}: {
  url: string;
  /** Captures pointer events for grid selection; matches tweet frame (550px max, rounded-lg). */
  interactionOverlay?: boolean;
}) {
  const id = extractTweetId(url);

  if (!id) return <FallbackCard url={url} />;

  return (
    <div
      className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden rounded-lg bg-white"
      data-theme="light"
    >
      <div className="relative w-full min-w-0 max-w-[550px] h-full min-h-0 overflow-y-auto overflow-x-hidden rounded-lg">
        <div className="tweet-embed-container h-full w-full min-w-0">
          <Tweet
            id={id}
            apiUrl={`/api/tweet?id=${encodeURIComponent(id)}&v=2`}
            fallback={<TweetSkeleton />}
            components={{
              TweetNotFound: ({ error }: { error?: { status?: number } }) => {
                return !error || error.status === 404 ? <FallbackCard url={url} /> : <></>;
              },
            }}
          />
        </div>
        {interactionOverlay && (
          <div
            className="absolute inset-0 z-10 rounded-lg pointer-events-auto"
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

function FallbackCard({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex h-full items-center justify-center bg-white p-4 text-sm text-muted-foreground underline"
    >
      View on X
    </a>
  );
}
