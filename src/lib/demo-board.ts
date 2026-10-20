import { nanoid } from "nanoid";
import { packedPage } from "@/lib/board-lifecycle";
import type { BoardItem, BoardPage, OGData } from "@/lib/types";

const SITE = "https://kaanarici.com";

type Placed = { item: BoardItem; x: number; y: number; w: number; h: number };

function note(html: string): BoardItem {
  return { id: nanoid(8), type: "note", html };
}

function link(url: string, ogData: OGData): BoardItem {
  return { id: nanoid(8), type: "url", url, platform: "website", ogData };
}

function project(url: string, title: string, description: string, preview: string): BoardItem {
  return link(url, { title, description, image: `${SITE}/previews/${preview}.webp` });
}

function at(item: BoardItem, x: number, y: number, w: number, h: number): Placed {
  return { item, x, y, w, h };
}

export function demoBoardPage(): BoardPage {
  const placed = [
    at(
      note("<h2>Kaan Aricioglu</h2><p>I do econ at NYU and I'm the on-call AI guy at Gumshoe Capital, a hedge fund. Grew up in Istanbul, live in Manhattan.</p>"),
      0, 0, 6, 7,
    ),
    at(note("<p>x.com/kaanaricioglu<br>github.com/kaanarici<br>linkedin.com/in/kaanarici1</p>"), 0, 7, 6, 5),
    at(note("<p>Paste a link, note, or image anywhere. Drag things around. Share sends the board as one link.</p>"), 0, 12, 6, 6),
    at(link(`${SITE}/`, { title: "Kaan Aricioglu", description: "My website.", image: `${SITE}/og`, siteName: "kaanarici.com" }), 6, 0, 6, 9),
    at(project("https://github.com/kaanarici/shareboard", "Shareboard", "This canvas. Open source, deploy your own.", "shareboard"), 6, 9, 6, 9),
    at(project("https://fundcensus.com/", "Fund Census", "SEC data on advisers, private funds, and owners.", "fundcensus"), 12, 0, 6, 9),
    at(project("https://github.com/kaanarici/docsnap", "DocSnap", "Docs-to-Markdown CLI for coding agents.", "docsnap"), 12, 9, 6, 9),
    at(project("https://github.com/kaanarici/VoxelLab", "VoxelLab", "Local-first research imaging viewer.", "voxellab"), 18, 0, 6, 9),
    at(project("https://github.com/kaanarici/rag-core", "rag-core", "Embeddable retrieval engine.", "rag-core"), 18, 9, 6, 9),
  ];
  const page = packedPage(placed.map(({ item }) => item), 0);
  return { ...page, layouts: { ...page.layouts, lg: placed.map(({ item, x, y, w, h }) => ({ i: item.id, x, y, w, h })) } };
}
