
import { TooltipProvider } from "@/components/ui/tooltip";
import { useMountEffect } from "@/lib/use-mount-effect";

export function Providers({ children }: { children: React.ReactNode }) {
  useMountEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js");
    }
  });

  return <TooltipProvider>{children}</TooltipProvider>;
}
