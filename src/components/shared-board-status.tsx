import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { SHARED_BOARD_LOADING_LABEL, SHARED_BOARD_NOT_FOUND_LABEL } from "@/lib/shared-board";

export function SharedBoardStatus({
  label,
}: {
  label: typeof SHARED_BOARD_LOADING_LABEL | typeof SHARED_BOARD_NOT_FOUND_LABEL;
}) {
  if (label === SHARED_BOARD_LOADING_LABEL) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
        {label}
      </div>
    );
  }
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-1.5 px-6 text-center">
      <p className="text-base font-medium">{label}</p>
      <p className="max-w-[34ch] text-sm text-pretty text-muted-foreground">
        The link may be incomplete, or the board was deleted or has expired.
      </p>
      <Link to="/" className="board-cta-link mt-4">
        <span>Make your own</span>
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
