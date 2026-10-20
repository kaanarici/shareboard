import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Liquid } from "liquid-gooey";
import { useIsMobile } from "@/lib/use-is-mobile";
import { Hint } from "@/components/ui/tooltip";

const ARC_DEGREES = 140;
const OPEN = { duration: 550, ease: "cubic-bezier(0.34, 1.56, 0.64, 1)" };
const CLOSE = { duration: 250, ease: "cubic-bezier(0.22, 1, 0.36, 1)" };
const OPEN_STAGGER = 40;
const ICON_DELAY = 120;
const ANTICIP_DIST = 5;
const ANTICIP_DUR = 700;
const GOO_SHADOW =
  "0 0 0 1px rgba(0, 0, 0, 0.06), 0 2px 6px rgba(0, 0, 0, 0.05), 0 4px 42px rgba(0, 0, 0, 0.06)";

type PlusMenuVars = CSSProperties & {
  "--pm-anticip": string;
  "--pm-anticip-dur": string;
  "--pm-icon-dur": string;
  "--pm-size": string;
  "--pm-spread": string;
};

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
  const [anticipating, setAnticipating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const anticipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeMenu = () => {
    if (isOpenRef.current) {
      if (anticipTimer.current) clearTimeout(anticipTimer.current);
      setAnticipating(false);
      requestAnimationFrame(() => setAnticipating(true));
      anticipTimer.current = setTimeout(() => setAnticipating(false), ANTICIP_DUR);
    }
    setIsOpen(false);
  };
  const closeMenuRef = useRef(closeMenu);
  closeMenuRef.current = closeMenu;

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!isOpenRef.current) return;
      if (!(e.target instanceof Node) || !containerRef.current?.contains(e.target)) {
        closeMenuRef.current();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (!isOpenRef.current) return;
      if (e.key === "Escape") closeMenuRef.current();
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(
    () => () => {
      if (anticipTimer.current) clearTimeout(anticipTimer.current);
    },
    [],
  );

  const n = items.length;
  const isMobile = useIsMobile();
  const size = isMobile ? 56 : 44;
  const spread = isMobile ? 88 : 68;
  const phase = isOpen ? OPEN : CLOSE;
  const stagger = isOpen ? OPEN_STAGGER : 0;

  const toggle = () => {
    if (isOpen) closeMenu();
    else setIsOpen(true);
  };

  const vars: PlusMenuVars = {
    position: "absolute",
    "--pm-anticip": `${ANTICIP_DIST}px`,
    "--pm-anticip-dur": `${ANTICIP_DUR}ms`,
    "--pm-icon-dur": "180ms",
    "--pm-size": `${size}px`,
    "--pm-spread": `${spread}px`,
  };

  return (
    <div ref={containerRef} className="action-fan-root" style={{ width: size, height: size }}>
      <AnimatePresence>
        {isOpen && isMobile && (
          <motion.div
            key="backdrop"
            className="action-fan-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>
      <Liquid
        blur={6}
        contrast={18}
        fill="#fff"
        shadow={GOO_SHADOW}
        className={`action-fan pm${isOpen ? " pm-open" : ""}${anticipating ? " pm-anticipating" : ""}`}
        style={vars}
      >
        {items.map((item, i) => {
          const arc = (ARC_DEGREES * Math.PI) / 180;
          const angle = n === 1 ? 0 : -arc / 2 + (arc * i) / (n - 1);
          const x = spread * Math.sin(angle);
          const y = -spread * Math.cos(angle);
          return (
            <Liquid.Item
              key={item.label}
              className="pm-slot"
              x={isOpen ? x : 0}
              y={isOpen ? y : 0}
              transition={phase}
              delay={i * stagger}
            >
              <Hint label={item.label} disabled={!isOpen}>
                <button
                  type="button"
                  className="pm-btn pm-sat"
                  disabled={item.disabled}
                  aria-label={item.label}
                  tabIndex={isOpen ? 0 : -1}
                  onClick={() => {
                    if (item.disabled) return;
                    item.onClick();
                    closeMenu();
                  }}
                >
                  <span
                    className="pm-sat-icon"
                    style={{
                      transitionDelay: isOpen ? `${ICON_DELAY + i * stagger}ms` : "0ms",
                    }}
                  >
                    {item.icon}
                  </span>
                </button>
              </Hint>
            </Liquid.Item>
          );
        })}
        <Liquid.Item className="pm-slot">
          <Hint label={isOpen ? "Close" : "Add"}>
            <button
              type="button"
              className={`pm-btn pm-main ${triggerClassName ?? ""}`}
              aria-expanded={isOpen}
              aria-haspopup="menu"
              aria-label={isOpen ? "Close menu" : "Add"}
              onClick={toggle}
            >
              <span className="pm-plus action-fan-trigger-icon">{trigger}</span>
            </button>
          </Hint>
        </Liquid.Item>
      </Liquid>
    </div>
  );
}
