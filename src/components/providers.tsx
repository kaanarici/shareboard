import { TooltipProvider } from "@/components/ui/tooltip";
import { useMountEffect } from "@/lib/use-mount-effect";

const SHARE_SW_PATH = "/share-sw.js";

function registrationScriptPath(registration: ServiceWorkerRegistration) {
  const scriptURL =
    registration.active?.scriptURL ??
    registration.waiting?.scriptURL ??
    registration.installing?.scriptURL;
  return scriptURL ? new URL(scriptURL).pathname : null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  useMountEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void (async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations
          .filter((registration) => registrationScriptPath(registration) !== SHARE_SW_PATH)
          .map((registration) => registration.unregister()),
      );
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith("shareboard-")).map((key) => caches.delete(key)));
      }
      await navigator.serviceWorker.register(SHARE_SW_PATH, { scope: "/" });
    })().catch(() => {});
  });

  return <TooltipProvider>{children}</TooltipProvider>;
}
