/* MealMate service worker — lets the website and the Android/iPhone app open
   without internet.

   - App files (/_next/static, fonts, icons) are kept after the first visit and
     served from the device (they never change: every build gets new names).
   - Pages (/app, /login, …) always try the internet first and fall back to the
     copy saved on the device when there is no connection.
   - Supabase and every other site are never touched: the mess data itself is
     kept and synced by the app (see components/AppHost.tsx and lib/engine/sync.js).

   Bump VERSION to throw away old copies. */
const VERSION = "mm-v1";
const STATIC = VERSION + "-static";
const PAGES = VERSION + "-pages";
const START_PAGES = ["/app", "/login", "/"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(PAGES).then((c) =>
      Promise.all(START_PAGES.map((u) => fetch(u, { credentials: "same-origin" }).then((r) => (r.ok ? c.put(u, r.clone()).then(() => cacheAssetsOf(r)) : null)).catch(() => null)))
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Save the scripts/styles a page needs, so it can start offline. */
async function cacheAssetsOf(res) {
  try {
    const html = await res.text();
    const urls = new Set();
    const re = /(?:src|href)="(\/_next\/static\/[^"]+)"/g;
    let m;
    while ((m = re.exec(html))) urls.add(m[1]);
    await cacheUrls(Array.from(urls));
  } catch (e) {}
}
async function cacheUrls(urls) {
  const c = await caches.open(STATIC);
  await Promise.all(
    urls.map(async (u) => {
      try {
        const url = new URL(u, self.location.origin);
        if (url.origin !== self.location.origin) return;
        if (await c.match(url.href)) return;
        const r = await fetch(url.href, { credentials: "same-origin" });
        if (r.ok) await c.put(url.href, r);
      } catch (e) {}
    })
  );
}

/* The page tells us which files it loaded (including ones loaded later,
   like the main app code), so those are kept too. */
self.addEventListener("message", (event) => {
  const d = event.data || {};
  if (d.type === "cache-urls" && Array.isArray(d.urls)) {
    const statics = d.urls.filter((u) => /\/_next\/static\/|\/fonts\/|\.(png|ico|webmanifest)$/.test(u));
    const pages = d.urls.filter((u) => !statics.includes(u));
    event.waitUntil(
      Promise.all([
        cacheUrls(statics),
        caches.open(PAGES).then((c) =>
          Promise.all(
            pages.map((p) =>
              fetch(p, { credentials: "same-origin" })
                .then((r) => (r.ok && r.headers.get("content-type") && r.headers.get("content-type").includes("text/html") ? c.put(new URL(p, self.location.origin).pathname, r) : null))
                .catch(() => null)
            )
          )
        ),
      ])
    );
  }
});

function isStatic(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/fonts/") || /\.(png|jpg|svg|ico|woff2?|webmanifest)$/.test(url.pathname);
}

async function cacheFirst(req) {
  const c = await caches.open(STATIC);
  const hit = await c.match(req, { ignoreSearch: false });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) c.put(req, res.clone()).catch(() => {});
  return res;
}

/* Internet first (with a short wait), saved copy if that fails. */
async function networkFirstPage(req) {
  const url = new URL(req.url);
  const c = await caches.open(PAGES);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 6000)),
    ]);
    if (res && res.ok && (res.headers.get("content-type") || "").includes("text/html")) {
      c.put(url.pathname, res.clone()).catch(() => {});
    }
    return res;
  } catch (e) {
    const hit = (await c.match(url.pathname)) || (url.pathname.startsWith("/app") || url.pathname === "/dashboard" ? await c.match("/app") : null) || (await c.match("/app")) || (await c.match("/login"));
    if (hit) return hit;
    throw e;
  }
}

async function networkFirstOther(req) {
  const c = await caches.open(PAGES);
  try {
    const res = await fetch(req);
    if (res.ok) c.put(req, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const hit = await c.match(req);
    if (hit) return hit;
    throw e;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, fonts.googleapis, etc.
  if (url.pathname === "/sw.js") return;
  if (url.pathname.startsWith("/api/")) return;
  if (isStatic(url)) {
    event.respondWith(cacheFirst(req));
  } else if (req.mode === "navigate") {
    event.respondWith(networkFirstPage(req));
  } else {
    event.respondWith(networkFirstOther(req));
  }
});
