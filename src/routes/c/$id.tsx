import { lazy, Suspense, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { boardAsJson } from "@/lib/canvas-sanitize";
import { isRecord, parseJson, readResponseJson, readString } from "@/lib/json";
import { validatePageSearch } from "@/lib/pagination";
import { isLockedBoardStub, type BoardFetchResponse } from "@/lib/types";
import { SharedCanvas } from "@/components/shared-canvas";
import { SharedBoardStatus } from "@/components/shared-board-status";
import {
  SHARED_BOARD_LOADING_LABEL,
  SHARED_BOARD_NOT_FOUND_LABEL,
  parseBoardFetchResponse,
  storedBoardFetchUrl,
  useSharedBoardLoad,
} from "@/lib/shared-board";

const LockedCanvas = lazy(() =>
  import("@/components/locked-canvas").then((module) => ({ default: module.LockedCanvas })),
);

const getSharedBoard = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => ({ id: String(data.id) }))
  .handler(async ({ data }) => {
    const { keepShareId } = await import("@/lib/locked-envelope");
    const { takeRateLimit } = await import("@/lib/server/rate-limit");
    const { clientIp } = await import("@/lib/server/request");
    const { readShare } = await import("@/lib/server/share-store");
    const id = keepShareId(data.id);
    const request = getRequest();
    if (!id || !(await takeRateLimit("publicRead", clientIp(request)))) return null;
    const record = await readShare(id).catch(() => null);
    if (!record) return null;
    if (record.kind === "locked") {
      return { title: "Shareboard", board: JSON.stringify({ id, encrypted: true, locked: true }) };
    }
    const previewUrl = record.board.previewUrl
      ? new URL(record.board.previewUrl, request.url).toString()
      : undefined;
    return { title: `${record.board.author}'s board`, previewUrl, board: JSON.stringify(boardAsJson(record.board)) };
  });

function loaderField(loaderData: unknown, field: "title" | "previewUrl" | "board") {
  return isRecord(loaderData) ? readString(loaderData[field]) : null;
}

export const Route = createFileRoute("/c/$id")({
  validateSearch: validatePageSearch,
  loader: ({ params }) => getSharedBoard({ data: { id: params.id } }).catch(() => null),
  head: ({ loaderData }) => {
    const title = loaderField(loaderData, "title") ?? "Shareboard";
    const previewUrl = loaderField(loaderData, "previewUrl");
    const meta: Array<{ title: string } | { name: string; content: string } | { property: string; content: string }> = [
      { title },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:title", content: title },
      { property: "og:type", content: "website" },
    ];
    if (previewUrl) {
      meta.push(
        { property: "og:image", content: previewUrl },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: previewUrl },
      );
    }
    return { meta };
  },
  component: SharedPage,
  notFoundComponent: () => <SharedBoardStatus label={SHARED_BOARD_NOT_FOUND_LABEL} />,
});

function SharedPage() {
  const { id } = Route.useParams();
  const loaderData = Route.useLoaderData();
  const loadBoard = useCallback(
    async (signal: AbortSignal): Promise<BoardFetchResponse | null> => {
      const loaded = parseBoardFetchResponse(parseJson(loaderField(loaderData, "board") ?? ""));
      if (loaded) return loaded;
      const res = await fetch(storedBoardFetchUrl(id), { signal });
      return res.ok ? parseBoardFetchResponse(await readResponseJson(res)) : null;
    },
    [id, loaderData],
  );

  const state = useSharedBoardLoad<BoardFetchResponse>({ load: loadBoard });

  if (state.status === "loading") return <SharedBoardStatus label={SHARED_BOARD_LOADING_LABEL} />;
  if (state.status === "error") return <SharedBoardStatus label={SHARED_BOARD_NOT_FOUND_LABEL} />;
  if (isLockedBoardStub(state.canvas)) {
    return (
      <Suspense fallback={<div className="locked-share-screen" />}>
        <LockedCanvas id={state.canvas.id} />
      </Suspense>
    );
  }
  return <SharedCanvas canvas={state.canvas} />;
}
