/* Lune service worker.
 *
 * Lives beside index.html (the build copies it to the site root) so it covers
 * the whole app. What it does, and what it deliberately leaves alone:
 *
 * - Network first, always. Online, every request is answered by the network
 *   exactly as it was before this file existed; the cache is only a copy kept
 *   for when the network fails. Nothing stale is served to someone online.
 * - Same-origin GET only. Sign-in, account data and sync go to Supabase on
 *   another origin; score mirrors and piano samples are other origins too.
 *   None of those are intercepted or stored.
 * - A page load is stored under the site root, never under its own URL, so a
 *   query string on a link can't end up in the cache.
 * - No skipWaiting, no clients.claim. A new version waits until every Lune
 *   tab has closed; nobody is refreshed mid-practice.
 * - Offline with nothing cached: the request fails and the browser shows its
 *   own offline page.
 */
const CACHE = "lune-shell-v1";
const ROOT = self.registration.scope; // e.g. https://lune.page/

async function put(cache, key, response) {
  await cache.put(key, response);
  // A new deploy stamp (?v=…) replaces the old copy of the same file.
  const url = new URL(key);
  if (!url.search) return;
  for (const old of await cache.keys(url.origin + url.pathname, { ignoreSearch: true })) {
    if (old.url !== url.href) await cache.delete(old);
  }
}

/** The app shell is whatever index.html loads: read it there, so no list here can drift. */
async function precache() {
  const cache = await caches.open(CACHE);
  const page = await fetch(ROOT, { cache: "no-cache" });
  if (!page.ok) throw new Error("index unavailable");
  const html = await page.clone().text();
  await cache.put(ROOT, page);

  const urls = new Set([new URL("manifest.webmanifest", ROOT).href]);
  for (const m of html.matchAll(/\s(?:src|href)="(static\/[^"#]+)"/g)) urls.add(new URL(m[1], ROOT).href);

  // fonts are named in the stylesheet, not the page
  const sheet = [...urls].find((u) => /\/styles\.css(\?|$)/.test(u));
  if (sheet) {
    try {
      const css = await (await fetch(sheet)).text();
      for (const m of css.matchAll(/url\(\s*["']?([^"')]+\.woff2)[^)]*\)/g)) urls.add(new URL(m[1], sheet).href);
    } catch {
      /* fonts are cached the first time a page uses them */
    }
  }
  await Promise.all(
    [...urls].map(async (u) => {
      try {
        const res = await fetch(u);
        if (res.status === 200 && res.type === "basic") await put(cache, u, res);
      } catch {
        /* one missing file must not block install */
      }
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith("lune-shell-") && n !== CACHE).map((n) => caches.delete(n))))
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (!req.url.startsWith(ROOT)) return; // other origins: untouched
  if (req.headers.has("authorization") || req.headers.has("range")) return;
  if (req.url.startsWith(ROOT + "api/")) return; // local Python server: always live
  const key = req.mode === "navigate" ? ROOT : req.url;

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        if (res.status === 200 && res.type === "basic" && !res.redirected) {
          const copy = res.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => put(cache, key, copy)).catch(() => {}));
        }
        return res;
      } catch (err) {
        const cache = await caches.open(CACHE);
        // offline: the copy from the last visit, even if its deploy stamp differs
        const hit = (await cache.match(key)) || (await cache.match(key, { ignoreSearch: true }));
        if (hit) return hit;
        throw err;
      }
    })()
  );
});
