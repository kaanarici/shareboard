import { useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { useMountEffect } from "@/lib/use-mount-effect";

const RADIUS = 96;
const ITEM_SIZE = 44;

export type ActionFanItem = {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
};

export function ActionFan({
  trigger,
  items,
  triggerClassName,
}: {
  trigger: ReactNode;
  items: ActionFanItem[];
  triggerClassName?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Mirror isOpen in a ref so the mount-only listeners can early-exit when
  // closed without resubscribing each time the state flips.
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  // Outside-click + Escape close. Using `click` (not `pointerdown`) lets a
  // fan-item's own onClick still fire when clicked.
  useMountEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!isOpenRef.current) return;
      if (!containerRef.current?.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (!isOpenRef.current) return;
      if (e.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  });

  const n = items.length;

  return (
    <div ref={containerRef} className="action-fan">
      {items.map((item, i) => {
        // Narrow top arc centered on straight-up (0). 120° spread.
        const arc = (120 * Math.PI) / 180;
        const angle = n === 1 ? 0 : -arc / 2 + (arc * i) / (n - 1);
        const x = RADIUS * Math.sin(angle);
        const y = -RADIUS * Math.cos(angle);
        return (
          <FanItem
            key={i}
            item={item}
            x={x}
            y={y}
            angle={angle}
            index={i}
            total={n}
            isOpen={isOpen}
            onSelect={() => setIsOpen(false)}
          />
        );
      })}

      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className={triggerClassName}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        data-fan-open={isOpen || undefined}
      >
        <motion.span
          className="action-fan-trigger-icon"
          animate={{ rotate: isOpen ? 45 : 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 24 }}
        >
          {trigger}
        </motion.span>
      </button>
    </div>
  );
}

function FanItem({
  item,
  x,
  y,
  angle,
  index,
  total,
  isOpen,
  onSelect,
}: {
  item: ActionFanItem;
  x: number;
  y: number;
  angle: number;
  index: number;
  total: number;
  isOpen: boolean;
  onSelect: () => void;
}) {
  const [hovering, setHovering] = useState(false);

  // Project the tooltip along the same ray so it never overlaps the trigger
  // or neighboring items. Pure vertical items get a simple "above" tooltip.
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const tooltipSide: "above" | "left" | "right" =
    Math.abs(sin) < 0.15 ? "above" : sin < 0 ? "left" : "right";
  let tooltipStyle: React.CSSProperties;
  const gap = 10;
  if (tooltipSide === "above") {
    tooltipStyle = {
      bottom: `calc(100% + ${gap}px)`,
      left: "50%",
      transform: "translateX(-50%)",
    };
  } else if (tooltipSide === "left") {
    tooltipStyle = {
      right: `calc(100% + ${gap}px)`,
      top: "50%",
      transform: "translateY(-50%)",
    };
  } else {
    tooltipStyle = {
      left: `calc(100% + ${gap}px)`,
      top: "50%",
      transform: "translateY(-50%)",
    };
  }
  // Nudge top-arc labels up along the ray so they don't kiss the circles.
  void cos;

  return (
    <motion.button
      type="button"
      disabled={item.disabled}
      aria-label={item.label}
      className="action-fan-item"
      style={{
        width: ITEM_SIZE,
        height: ITEM_SIZE,
        marginLeft: -ITEM_SIZE / 2,
        marginTop: -ITEM_SIZE / 2,
        pointerEvents: isOpen ? "auto" : "none",
      }}
      initial={false}
      animate={{
        x: isOpen ? x : 0,
        y: isOpen ? y : 0,
        opacity: isOpen ? 1 : 0,
        scale: isOpen ? 1 : 0.35,
      }}
      transition={{
        type: "spring",
        stiffness: 320,
        damping: 26,
        mass: 0.8,
        delay: isOpen ? index * 0.025 : (total - 1 - index) * 0.03,
      }}
      whileHover={!item.disabled ? { scale: 1.08 } : undefined}
      whileTap={!item.disabled ? { scale: 0.92 } : undefined}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
      onClick={() => {
        if (item.disabled) return;
        item.onClick();
        onSelect();
      }}
    >
      {item.icon}
      {hovering && isOpen && (
        <span
          role="tooltip"
          className="action-fan-label"
          data-side={tooltipSide}
          style={tooltipStyle}
        >
          {item.label}
        </span>
      )}
    </motion.button>
  );
}
