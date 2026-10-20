import { Children, forwardRef, useRef, type ComponentPropsWithoutRef, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/ui/tooltip";
import { imageSource, type BoardItem, type SelectionEvent } from "@/lib/types";

function itemOverflowClass(item: BoardItem) {
  return item.type === "note" ? "overflow-auto" : "overflow-hidden";
}

function isTwitterItem(item: BoardItem): boolean {
  return item.type === "url" && item.platform === "twitter";
}

function blurActiveElementSoon() {
  const blur = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  };
  blur();
  requestAnimationFrame(blur);
}

type BoardTileProps = {
  item: BoardItem;
  readonly?: boolean;
  selected?: boolean;
  variant: "stack" | "grid";
  className?: string;
  style?: CSSProperties;
  onSelect?: (id: string, event: SelectionEvent) => void;
  onRemove?: (id: string) => void;
  onOpenImage: (src: string, alt?: string) => void;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"div">, "onSelect" | "children">;

export const BoardTile = forwardRef<HTMLDivElement, BoardTileProps>(function BoardTile(
  {
    item,
    readonly,
    selected,
    variant,
    className,
    style,
    onSelect,
    onRemove,
    onOpenImage,
    children,
    ...rest
  },
  ref,
) {
  const modifiedSelectRef = useRef(false);
  const ignoreSelector =
    variant === "grid"
      ? ".ProseMirror, input, textarea, [contenteditable=true], .grid-no-drag"
      : ".ProseMirror, input, textarea, [contenteditable=true]";

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (variant === "grid") {
      e.stopPropagation();
      if (modifiedSelectRef.current) {
        modifiedSelectRef.current = false;
        e.preventDefault();
        return;
      }
    }
    if (readonly && item.type === "image") {
      onOpenImage(imageSource(item), item.caption);
      return;
    }
    if (variant === "stack" && !readonly && item.type === "url") e.preventDefault();
    if (e.metaKey || e.ctrlKey) {
      blurActiveElementSoon();
      e.preventDefault();
      onSelect?.(item.id, e);
      return;
    }
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target?.closest(ignoreSelector)) return;
    onSelect?.(item.id, e);
  };

  const coverLinks =
    variant === "grid" && item.type === "url" && !readonly && !isTwitterItem(item) && item.platform !== "youtube";

  const childList = Children.toArray(children);
  const body = variant === "grid" ? childList[0] : children;
  const handles = variant === "grid" ? childList.slice(1) : null;

  return (
    <div
      ref={ref}
      {...rest}
      data-canvas-item-id={item.id}
      data-item-type={item.type}
      data-selected={selected ? "true" : undefined}
      className={cn(
        variant === "stack"
          ? "board-mobile-stack-item group"
          : [
              "group overflow-hidden rounded-lg",
              selected && "ring-2 ring-primary/40 ring-offset-2 ring-offset-background",
              readonly && item.type === "image" && "cursor-zoom-in",
              !readonly && "cursor-grab",
            ],
        className,
      )}
      style={style}
      onMouseDownCapture={
        variant === "grid"
          ? (e) => {
              if (!readonly && (e.metaKey || e.ctrlKey)) {
                modifiedSelectRef.current = true;
                blurActiveElementSoon();
                e.preventDefault();
                e.stopPropagation();
                onSelect?.(item.id, e);
              }
            }
          : undefined
      }
      onClick={handleClick}
    >
      {!readonly && onRemove ? (
        <div
          className={
            variant === "stack"
              ? "board-mobile-stack-close"
              : "grid-card-close absolute top-2 right-2 z-50 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 grid-interacting-fade"
          }
        >
          <Hint label="Remove">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(item.id);
              }}
              aria-label="Remove item"
              className={variant === "stack" ? "card-close-btn card-close-btn--touch" : "card-close-btn"}
            >
              <X className="card-close-icon" strokeWidth={2.25} />
            </button>
          </Hint>
        </div>
      ) : null}
      {coverLinks ? <div className="absolute inset-0 z-10 rounded-3xl" /> : null}
      <div className={`h-full w-full ${itemOverflowClass(item)}`}>{body}</div>
      {handles}
    </div>
  );
});
