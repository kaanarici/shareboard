import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "../styles/globals.css";
import { Providers } from "@/components/providers";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, maximum-scale=1",
      },
      { name: "theme-color", content: "#ffffff" },
      { title: "Shareboard" },
      { name: "description", content: "Collect, curate, and share ideas beautifully" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Shareboard" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
    ],
    links: [{ rel: "manifest", href: "/manifest.json" }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en" className="font-sans">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <Providers>
          <Outlet />
        </Providers>
        <Scripts />
      </body>
    </html>
  );
}
