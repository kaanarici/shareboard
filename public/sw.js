self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith("shareboard-")).map((k) => caches.delete(k)))
    ).then(() => self.registration.unregister()).then(() => self.clients.claim())
  );
});
