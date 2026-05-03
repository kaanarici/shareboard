import { TooltipProvider } from "@/components/ui/tooltip";
import { useMountEffect } from "@/lib/use-mount-effect";

export function Providers({ children }: { children: React.ReactNode }) {
  useMountEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => void registration.unregister());
    });
    if ("caches" in window) {
      caches.keys().then((keys) => {
        keys.filter((key) => key.startsWith("shareboard-")).forEach((key) => void caches.delete(key));
      });
    }
  });

  return <TooltipProvider>{children}</TooltipProvider>;
}
