/* sw.js */
const CACHE_VERSION = "2026-06-05_dual-github-gitlab-sync"; // bump la fiecare deploy important
const CACHE_NAME = `cmd-center-${CACHE_VERSION}`;

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    // cache minimal (opțional)
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([
      "./",
      "./index.html",
      "./cloud-sync.js",
      "./manifest.json",
      "./icons/bt-bank.png",
      "./icons/lloyds.png",
      // dacă vrei: sunete/icon-uri stabile
      // "./click.mp3",
      // "./toggle.mp3",
    ]);
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k.startsWith("cmd-center-") && k !== CACHE_NAME) ? caches.delete(k) : null));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) Navigations + index.html => NETWORK FIRST (mereu versiune proaspătă)
  const isIndexHtml =
    url.origin === location.origin &&
    (url.pathname.endsWith("/index.html") || url.pathname.endsWith("/") || url.pathname.endsWith(".html"));

  if (req.mode === "navigate" || isIndexHtml) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE_NAME);
        cache.put("./index.html", fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match("./index.html");
        return cached || caches.match("./") || Response.error();
      }
    })());
    return;
  }

  // 2) Sunete — mereu rețea întâi (evită MP3 lipsă/corupt din cache)
  if (url.origin === location.origin && /\.(mp3|wav|ogg)$/i.test(url.pathname)) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  // 3) Same-origin static => cache first, fallback network
  if (url.origin === location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, fresh.clone());
      return fresh;
    })());
    return;
  }

  // 3) Cross-origin (CDN, ipapi, wttr) => network
  event.respondWith(fetch(req));
});
