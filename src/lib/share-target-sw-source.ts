import {
  SHARE_PARAM_MAX,
  SHARE_TARGET_DB,
  SHARE_TARGET_DB_VERSION,
  SHARE_TARGET_IMAGE_TYPES,
  SHARE_TARGET_PATH,
  SHARE_TARGET_STORE,
} from "./share-target-contract.ts";

export function shareTargetSwSource(): string {
  return `const DB_NAME = ${JSON.stringify(SHARE_TARGET_DB)};
const DB_VERSION = ${SHARE_TARGET_DB_VERSION};
const STORE = ${JSON.stringify(SHARE_TARGET_STORE)};
const SHARE_PATH = ${JSON.stringify(SHARE_TARGET_PATH)};
const PARAM_MAX = ${SHARE_PARAM_MAX};
const IMAGE_TYPES = new Set(${JSON.stringify(SHARE_TARGET_IMAGE_TYPES)});

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.origin !== self.location.origin || url.pathname !== SHARE_PATH) {
    return;
  }
  event.respondWith(handleShareTarget(event.request));
});

async function handleShareTarget(request) {
  const form = await request.formData().catch(() => null);
  const title = form ? textParam(form.get("title")) : "";
  const text = form ? textParam(form.get("text")) : "";
  const url = form ? textParam(form.get("url")) : "";
  const files = form ? imageFiles(form.getAll("media")) : [];

  if (files.length > 0) {
    await putShare({ createdAt: Date.now(), title, text, url, files }).catch(() => {});
  }

  return Response.redirect(redirectUrl({ title, text, url }).href, 303);
}

function textParam(value) {
  return typeof value === "string"
    ? value.trim().slice(0, PARAM_MAX)
    : "";
}

function imageFiles(entries) {
  return entries
    .filter((entry) => entry instanceof File && IMAGE_TYPES.has(entry.type))
    .map((file, index) => ({
      blob: file.slice(0, file.size, file.type),
      name: file.name || \`shared-image-\${index + 1}\`,
      type: file.type,
      lastModified: file.lastModified || Date.now(),
    }));
}

function redirectUrl(params) {
  const target = new URL("/", self.location.origin);
  const search = new URLSearchParams({ shared: "1" });
  for (const key of ["title", "text", "url"]) {
    if (params[key]) search.set(key, params[key]);
  }
  target.search = search.toString();
  return target;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putShare(record) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).add(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
`;
}
