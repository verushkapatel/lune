/* Lune — free allowlisted MusicXML fetch-on-open (static site + local).
 *
 * Only https hosts on the allowlist (raw.githubusercontent.com).
 * MusicXML / MXL only — never PDF. No paid APIs. Credits required.
 */
window.LuneFetchScore = (function () {
  const CATALOG_URL = () =>
    typeof luneUrl === "function"
      ? luneUrl("/static/remote-catalog.json?v=fetch02")
      : "static/remote-catalog.json?v=fetch02";

  let catalogPromise = null;
  const xmlCache = new Map();

  function fold(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function loadCatalog() {
    if (!catalogPromise) {
      catalogPromise = fetch(CATALOG_URL(), { cache: "force-cache" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data || !Array.isArray(data.items)) return { items: [], allowlistHosts: [] };
          return data;
        })
        .catch(() => ({ items: [], allowlistHosts: [] }));
    }
    return catalogPromise;
  }

  function hostAllowed(url, allowlist) {
    try {
      const u = new URL(url);
      if (u.protocol !== "https:") return false;
      const hosts = allowlist && allowlist.length ? allowlist : ["raw.githubusercontent.com"];
      return hosts.includes(u.hostname);
    } catch {
      return false;
    }
  }

  function scoreEntry(needle, entry) {
    if (!needle) return 0;
    const title = fold(entry.title);
    const composer = fold(entry.composer);
    const query = fold(entry.query);
    const hay = fold(entry.hay || `${entry.title} ${entry.composer} ${entry.query}`);
    let s = 0;
    if (query && (needle === query || query.includes(needle) || needle.includes(query))) s += 28;
    if (title && (needle === title || title.includes(needle) || needle.includes(title))) s += 22;
    if (composer && needle.includes(composer)) s += 6;
    if (hay.includes(needle)) s += 10;
    const words = needle.split(/\s+/).filter((w) => w.length > 2);
    let hits = 0;
    for (const w of words) if (hay.includes(w)) hits += 1;
    if (words.length) s += Math.round((hits / words.length) * 12);
    return s;
  }

  async function match(body) {
    const cat = await loadCatalog();
    const needle = fold(body.query || body.title || "");
    if (!needle) return null;
    // A link or a typeahead pick names one catalogue entry exactly: honour it
    // before any fuzzy matching, or a similar title can open the wrong piece.
    const wanted = String(body.query || "").trim().toLowerCase();
    const exact = (cat.items || []).find((e) => e.id === wanted || e.query === wanted);
    if (exact) return hostAllowed(exact.url, cat.allowlistHosts) ? exact : null;
    let best = null;
    let bestScore = 0;
    for (const entry of cat.items || []) {
      const s = scoreEntry(needle, entry);
      const cNeedle = fold(body.composer || "");
      const boost = cNeedle && fold(entry.composer).includes(cNeedle) ? 4 : 0;
      if (s + boost > bestScore) {
        bestScore = s + boost;
        best = entry;
      }
    }
    if (!best || bestScore < 10) return null;
    if (!hostAllowed(best.url, cat.allowlistHosts)) return null;
    return best;
  }

  async function bytesToMusicXml(buffer, url) {
    const head = new Uint8Array(buffer.slice(0, 4));
    const isZip = head[0] === 0x50 && head[1] === 0x4b;
    const looksMxl = /\.mxl(\?|$)/i.test(url) || isZip;
    if (looksMxl) {
      if (!window.LuneLite?.readScoreFile) throw new Error("MXL support unavailable");
      // Reuse Lite unzip via a fake File
      const file = new File([buffer], "score.mxl", { type: "application/vnd.recordare.musicxml" });
      return window.LuneLite.readScoreFile(file);
    }
    const text = new TextDecoder().decode(buffer);
    if (window.LuneLite?.validateMusicXml) return window.LuneLite.validateMusicXml(text);
    if (!/<score-partwise/i.test(text)) throw new Error("Not MusicXML");
    return text;
  }

  async function fetchMusicXml(entry, allowlist) {
    if (!hostAllowed(entry.url, allowlist)) throw new Error("Source not allowlisted");
    if (xmlCache.has(entry.url)) return xmlCache.get(entry.url);
    const res = await fetch(entry.url, {
      mode: "cors",
      credentials: "omit",
      cache: "force-cache",
    });
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength < 200) throw new Error("Empty score");
    // Refuse HTML error pages
    const sniff = new TextDecoder().decode(buffer.slice(0, 80)).toLowerCase();
    // (MusicXML has a DOCTYPE of its own, so only an HTML one is refused.)
    if (sniff.includes("<!doctype html") || sniff.includes("<html")) throw new Error("Not a score file");
    const xml = await bytesToMusicXml(buffer, entry.url);
    xmlCache.set(entry.url, xml);
    return xml;
  }

  async function tryOpenRemote(body) {
    const cat = await loadCatalog();
    const entry = await match(body);
    if (!entry) return null;
    try {
      const musicxml = await fetchMusicXml(entry, cat.allowlistHosts);
      const credit = entry.credit || (cat.credits && cat.credits[entry.source]) || {
        source: entry.source || "Open free source",
        sourceUrl: entry.url,
        license: "Open / public-domain edition",
        licenseUrl: "",
      };
      return {
        kind: "score",
        opened: true,
        needsAnalysis: true,
        title: entry.title || body.title || body.query,
        composer: entry.composer || body.composer || "",
        filename: (entry.url || "").split("/").pop() || "score.musicxml",
        musicxml,
        overview: {},
        epoch: entry.epoch || "",
        era: entry.era || "",
        source: entry.source || "remote",
        downloadName: `${String(entry.title || "score")
          .replace(/[^A-Za-z0-9._-]+/g, "_")
          .slice(0, 80)}.musicxml`,
        id: entry.id || "",
        credit: {
          source: credit.source,
          sourceUrl: credit.sourceUrl || entry.url,
          license: credit.license,
          licenseUrl: credit.licenseUrl || "",
        },
        openQuery: body.query || "",
        remoteFetched: true,
        fallbackNote: `Fetched from ${credit.source}${credit.license ? ` · ${credit.license}` : ""}.`,
      };
    } catch (err) {
      console.warn("[lune] remote fetch failed", entry.url, err);
      return {
        kind: "catalogue",
        opened: false,
        title: entry.title || body.title || body.query,
        composer: entry.composer || body.composer || "",
        message:
          "A free MusicXML listing exists, but the file could not be fetched right now. Try again, or upload your own MusicXML.",
      };
    }
  }

  return { loadCatalog, match, tryOpenRemote };
})();
