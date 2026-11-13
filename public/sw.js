// Increment this version when changing the offline page or precached assets.
const CACHE_PREFIX = "pianyu-pwa-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const OFFLINE_URL = "/offline.html";
const ASSETS = new Set([
  OFFLINE_URL,
  "/logo.svg",
  "/logo-light.svg",
  "/pwa/icon-192.png",
  "/pwa/icon-512.png",
  "/pwa/icon-maskable-512.png",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) =>
    cache.addAll([...ASSETS].map((url) => new Request(url, { cache: "reload", credentials: "omit" })))));
  // Updates wait for the user to choose when to activate them.
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
});

async function cachedAsset(request) {
  try {
    return await (await caches.open(CACHE_NAME)).match(request);
  } catch { return undefined; }
}

async function navigate(request) {
  try {
    // Never persist document HTML, RSC payloads, photos, or authentication data.
    return await fetch(request);
  } catch {
    const offline = await cachedAsset(OFFLINE_URL);
    return new Response(offline?.body || "暂时离线，请恢复网络后重试。", {
      status: 503,
      headers: {
        "Content-Type": offline ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  }
}

async function staticAsset(event) {
  try {
    const response = await fetch(event.request);
    if (response.ok && response.type === "basic") {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {}));
    }
    return response;
  } catch {
    return (await cachedAsset(event.request)) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Positive allowlists keep admin, APIs, media, downloads, and Next.js data
  // requests on the network, even when a logged-in admin is using this app.
  const publicPage = ["/", "/archive", "/archive/", "/works", "/works/"].includes(url.pathname) || /^\/works\/[^/]+\/?$/.test(url.pathname);
  if (request.mode === "navigate" && publicPage) {
    event.respondWith(navigate(request));
  } else if (ASSETS.has(url.pathname) && !url.search) {
    event.respondWith(staticAsset(event));
  }
});
