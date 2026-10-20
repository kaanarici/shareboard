import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Responsive, useContainerWidth, noCompactor } from "react-grid-layout";
import type { Layout, LayoutItem, ResponsiveLayouts } from "react-grid-layout";
import { aspectRatio, gridBounds, snapToGrid } from "react-grid-layout/core";
import type { AutoLayouts, TileSpecMap } from "./types";
import {
  chooseRows,
  chooseSpan,
  mergeLayout,
  normalizeLayoutItem,
  rectsOverlap,
  resolveDisplacedLayout,
  resolveGroupedDragLayout,
} from "./pack";

type FreePlacementCompactor = typeof noCompactor & { allowOverlap: true };
const freePlacementCompactor: FreePlacementCompactor = { ...noCompactor, allowOverlap: true };

function toStoredLayout(layout: Layout, columns: number, maxRows?: number): Layout {
  return layout.flatMap((item) => {
    const normalized = normalizeLayoutItem(item, { columns, maxRows });
    return normalized ? [normalized] : [];
  });
}

function sameLayout(a: readonly LayoutItem[] | undefined, b: readonly LayoutItem[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (
      !left ||
      !right ||
      left.i !== right.i ||
      left.x !== right.x ||
      left.y !== right.y ||
      left.w !== right.w ||
      left.h !== right.h
    ) {
      return false;
    }
  }
  return true;
}

function sameLayouts(a: ResponsiveLayouts | null, b: ResponsiveLayouts | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return sameLayout(a.lg, b.lg) && sameLayout(a.sm, b.sm);
}

interface AutoCanvasProps {
  columns?: number;
  smColumns?: number;
  lgBreakpoint?: number;
  rowHeight?: number;
  gap?: number;
  maxRows?: number;
  tileSpecs: TileSpecMap;
  layout?: AutoLayouts;
  onLayoutChange?: (next: AutoLayouts) => void;
  readonly?: boolean;
  selectedIds?: readonly string[];
  children: ReactNode;
}

function findMoved(next: Layout, before: Layout): LayoutItem | undefined {
  return next.find((item) => {
    const prior = before.find((candidate) => candidate.i === item.i);
    return prior && (prior.x !== item.x || prior.y !== item.y || prior.w !== item.w || prior.h !== item.h);
  });
}

function overflowsRows(item: LayoutItem, maxRows: number | undefined): boolean {
  return !!maxRows && maxRows > 0 && item.y + item.h > maxRows;
}

export function AutoCanvas({
  columns = 24,
  smColumns = 1,
  lgBreakpoint = 768,
  rowHeight = 20,
  gap = 12,
  maxRows,
  tileSpecs,
  layout,
  onLayoutChange,
  readonly,
  selectedIds,
  children,
}: AutoCanvasProps) {
  const { containerRef, width } = useContainerWidth();

  const breakpointRef = useRef<"lg" | "sm">("lg");

  const merged = useMemo<ResponsiveLayouts>(() => {
    const specs = Object.entries(tileSpecs).flatMap(([id, spec]) => (spec ? [{ id, ...spec }] : []));

    const cw = width > 0 ? width : Math.max(columns * 40, 800);
    const optionsFor = (cols: number) => ({ columns: cols, containerWidth: cw, rowHeight, gap, maxRows });

    const lg = mergeLayout(layout?.lg ?? [], specs, optionsFor(columns));

    const sm: LayoutItem[] = [];
    let smY = 0;
    for (const spec of specs) {
      const span = Math.min(smColumns, chooseSpan(spec, optionsFor(smColumns)));
      const rows = chooseRows(spec, span, optionsFor(smColumns));
      sm.push({
        i: spec.id,
        x: 0,
        y: smY,
        w: span,
        h: rows,
        minW: 1,
        minH: spec.minRows ?? 3,
      });
      smY += rows;
    }

    const applyAspectAndConstraints = (items: LayoutItem[], cols: number) =>
      items.map((l) => {
        const spec = tileSpecs[l.i];
        if (!spec) return { ...l, constraints: [snapToGrid(1), gridBounds] };
        if (spec.aspect && spec.aspect > 0) {
          let w = l.w;
          let h = chooseRows(spec, w, optionsFor(cols));
          const rowBudget = maxRows && maxRows > 0 ? Math.max(1, maxRows - l.y) : null;
          if (rowBudget && h > rowBudget) {
            const minSpan = Math.max(1, spec.minSpan ?? 1);
            for (let nextW = Math.min(w, cols); nextW >= minSpan; nextW--) {
              const nextH = chooseRows(spec, nextW, optionsFor(cols));
              if (nextH <= rowBudget) {
                w = nextW;
                h = nextH;
                break;
              }
            }
            h = Math.min(h, rowBudget);
          }
          const minH = spec.minRows != null
            ? Math.min(spec.minRows, h)
            : l.minH != null
              ? Math.min(l.minH, h)
              : undefined;
          const minW = spec.minSpan != null
            ? Math.min(spec.minSpan, w)
            : l.minW != null
              ? Math.min(l.minW, w)
              : undefined;
          return {
            ...l,
            w,
            h,
            ...(minW != null && { minW }),
            ...(minH != null && { minH }),
            constraints: [snapToGrid(1), aspectRatio(spec.aspect), gridBounds],
          };
        }
        return { ...l, constraints: [snapToGrid(1), gridBounds] };
      });

    return {
      lg: applyAspectAndConstraints(lg, columns),
      sm: applyAspectAndConstraints(sm, smColumns),
    };
  }, [tileSpecs, layout, width, columns, smColumns, rowHeight, gap, maxRows]);

  const [dragPreview, setDragPreview] = useState<ResponsiveLayouts | null>(null);
  const dragPreviewRef = useRef<ResponsiveLayouts | null>(null);
  const pageHeight = maxRows && maxRows > 0
    ? maxRows * rowHeight + gap * Math.max(0, maxRows - 1)
    : undefined;
  const shadowClipStyle = pageHeight ? { overflow: "hidden", padding: 6, margin: -6 } : undefined;
  const boundedCanvasStyle = pageHeight ? { height: pageHeight, minHeight: pageHeight, maxHeight: pageHeight } : undefined;
  const setDragPreviewLayouts = useCallback((next: ResponsiveLayouts | null) => {
    if (sameLayouts(dragPreviewRef.current, next)) return;
    dragPreviewRef.current = next;
    setDragPreview(next);
  }, []);

  const preInteractionRef = useRef<Layout | null>(null);
  const interactionKindRef = useRef<"drag" | "resize" | null>(null);

  const handleInteractionStart = useCallback(
    (current: Layout, kind: "drag" | "resize") => {
      preInteractionRef.current = current.map((l) => ({ ...l }));
      interactionKindRef.current = kind;
      setDragPreviewLayouts(null);
      document.body.classList.add("grid-interacting");
      if (kind === "resize") document.body.classList.add("grid-resizing");
    },
    [setDragPreviewLayouts],
  );

  const handleDrag = useCallback(
    (next: Layout, activeItem?: LayoutItem | null) => {
      if (!onLayoutChange || readonly) return;

      const before = preInteractionRef.current ?? [];
      if (before.length === 0) return;

      const changed = activeItem ?? findMoved(next, before);
      if (!changed) {
        setDragPreviewLayouts(null);
        return;
      }

      const normalizedNext = next.map((item) => {
        if (item.i === changed.i) return { ...item };
        const original = before.find((candidate) => candidate.i === item.i);
        return original ? { ...item, x: original.x, y: original.y, w: original.w, h: original.h } : { ...item };
      });
      const moved = normalizedNext.find((item) => item.i === changed.i);
      if (!moved) return;

      const grouped = resolveGroupedDragLayout(normalizedNext, before, moved.i, selectedIds, { columns, maxRows });
      if (grouped) {
        const bp = breakpointRef.current;
        setDragPreviewLayouts({ ...merged, [bp]: grouped });
        return;
      }
      if ((selectedIds?.length ?? 0) > 1 && selectedIds?.includes(moved.i)) {
        setDragPreviewLayouts(null);
        return;
      }

      const others = normalizedNext.filter((item) => item.i !== moved.i);
      const collides = others.some((item) => rectsOverlap(moved, item));
      if (!collides || overflowsRows(moved, maxRows)) {
        setDragPreviewLayouts(null);
        return;
      }

      const resolved = resolveDisplacedLayout(normalizedNext, before, moved.i, { columns, maxRows });
      if (!resolved) {
        setDragPreviewLayouts(null);
        return;
      }

      const bp = breakpointRef.current;
      setDragPreviewLayouts({ ...merged, [bp]: resolved });
    },
    [onLayoutChange, readonly, maxRows, columns, merged, selectedIds, setDragPreviewLayouts],
  );

  const handleInteractionStop = useCallback(
    (next: Layout) => {
      document.body.classList.remove("grid-interacting");
      document.body.classList.remove("grid-resizing");
      const bp = breakpointRef.current;
      const preview = dragPreviewRef.current?.[bp] ?? null;
      setDragPreviewLayouts(null);
      if (!onLayoutChange || readonly) return;

      const before = preInteractionRef.current ?? [];
      preInteractionRef.current = null;
      const kind = interactionKindRef.current;
      interactionKindRef.current = null;

      const moved = findMoved(next, before);

      let finalLayout = kind === "drag" && preview ? preview : next;
      if (!preview && moved) {
        const grouped = kind === "drag"
          ? resolveGroupedDragLayout(next, before, moved.i, selectedIds, { columns, maxRows })
          : null;
        if (grouped) {
          finalLayout = grouped;
        } else if ((selectedIds?.length ?? 0) > 1 && selectedIds?.includes(moved.i)) {
          finalLayout = before;
        } else {
          const others = next.filter((l) => l.i !== moved.i);
          const collides = others.some((o) => rectsOverlap(moved, o));
          const overflows = overflowsRows(moved, maxRows);
          if (collides || overflows) {
            const displaced =
              kind === "drag" && !overflows
                ? resolveDisplacedLayout(next, before, moved.i, { columns, maxRows })
                : null;
            if (displaced) {
              finalLayout = displaced;
            } else {
              const prev = before.find((p) => p.i === moved.i);
              if (prev) {
                finalLayout = next.map((l) =>
                  l.i === moved.i ? { ...l, x: prev.x, y: prev.y, w: prev.w, h: prev.h } : l,
                );
              }
            }
          }
        }
      }

      const prevLayouts: AutoLayouts = {
        lg: layout?.lg ?? [],
        sm: layout?.sm ?? [],
      };
      onLayoutChange({
        ...prevLayouts,
        [bp]: toStoredLayout(finalLayout, bp === "sm" ? smColumns : columns, maxRows),
      });
    },
    [onLayoutChange, readonly, layout, maxRows, columns, smColumns, selectedIds, setDragPreviewLayouts],
  );

  return (
    <div ref={containerRef} style={{ width: "100%", minHeight: "100%" }}>
      {width > 0 && (
        <div style={shadowClipStyle}>
          <Responsive
            width={width}
            layouts={dragPreview ?? merged}
            breakpoints={{ lg: lgBreakpoint, sm: 0 }}
            cols={{ lg: columns, sm: smColumns }}
            rowHeight={rowHeight}
            maxRows={maxRows}
            margin={[gap, gap]}
            containerPadding={[0, 0]}
            autoSize={!pageHeight}
            style={boundedCanvasStyle}
            dragConfig={{
              enabled: !readonly,
              bounded: !!pageHeight,
              cancel: "input, textarea, [data-editing='true'] .ProseMirror, [data-editing='true'][contenteditable=true], .grid-card-close, .grid-no-drag",
            }}
            resizeConfig={{ enabled: !readonly, handles: ["se", "sw", "ne", "nw", "e", "w", "s", "n"] }}
            compactor={freePlacementCompactor}
            onBreakpointChange={(bp: string) => {
              breakpointRef.current = bp === "sm" ? "sm" : "lg";
            }}
            onDragStart={(l: Layout) => handleInteractionStart(l, "drag")}
            onDrag={(l: Layout, _oldItem: LayoutItem | null, newItem: LayoutItem | null) => handleDrag(l, newItem)}
            onDragStop={(l: Layout) => handleInteractionStop(l)}
            onResizeStart={(l: Layout) => handleInteractionStart(l, "resize")}
            onResizeStop={(l: Layout) => handleInteractionStop(l)}
          >
            {children}
          </Responsive>
        </div>
      )}
    </div>
  );
}
