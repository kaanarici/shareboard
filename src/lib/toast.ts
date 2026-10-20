import { toast } from "sonner";

const repeats = new Map<string, number>();

function trigger(kind: "success" | "error", message: string): void {
  const id = `sb-${kind}:${message}`;
  const previous = repeats.get(id);
  const repeat = previous === undefined ? 0 : previous + 1;
  const forget = () => repeats.delete(id);
  repeats.set(id, repeat);
  toast[kind](message, {
    id,
    className: repeat === 0 ? undefined : repeat % 2 === 1 ? "sb-toast--pulse-a" : "sb-toast--pulse-b",
    onDismiss: forget,
    onAutoClose: forget,
  });
}

export const notify = {
  success: (message: string) => trigger("success", message),
  error: (message: string) => trigger("error", message),
};

export function notifyWithUndo(message: string, onUndo: () => void) {
  toast.success(message, {
    duration: 5000,
    action: { label: "Undo", onClick: onUndo },
  });
}
