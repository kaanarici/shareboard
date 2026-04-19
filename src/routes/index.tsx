import { createFileRoute } from "@tanstack/react-router";
import { Home } from "@/components/home";

type HomeSearch = { page?: number };

export const Route = createFileRoute("/")({
  validateSearch: (search): HomeSearch => {
    const raw = Number(search.page);
    if (!Number.isFinite(raw) || raw < 1) return {};
    return { page: Math.floor(raw) };
  },
  component: Home,
});
