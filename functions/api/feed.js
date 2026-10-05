// Cloudflare Pages Function: GET /api/feed
// Fetches every feed listed in /site.config.json, merges them, newest first,
// and returns JSON. Responses are cached at the edge for 30 minutes.

const TTL_SECONDS = 1800;
const ERROR_TTL_SECONDS = 120;

export async function onRequestGet(context) {
  const { request, env } = context;
  const cache = caches.default;
  const cacheKey = new Request(new URL("/api/feed", request.url).toString());

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let config = {};
  try {
    const cfgRes = await env.ASSETS.fetch(new URL("/site.config.json", request.url));
    config = await cfgRes.json();
  } catch (err) {
    return json({ items: [], errors: ["Could not read site.config.json"] }, ERROR_TTL_SECONDS);
  }

  const feeds = (config.feeds || []).filter(
    (f) => f && f.url && /^https?:\/\//.test(f.url) && !/YOUR[-_]/.test(f.url)
  );
  const limit = Number(config.feedLimit) || 12;

  const results = await Promise.allSettled(feeds.map(loadFeed));
  const errors = [];
  const seen = new Set();
  let items = [];

  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else errors.push(`${feeds[i].name}: ${r.reason?.message || "failed"}`);
  });

  items = items
    .filter((it) => {
      if (!it.link || seen.has(it.link)) return false;
      seen.add(it.link);
      return true;
    })
    .sort((a, b) => (b.date || 0) - (a.date || 0))
    .slice(0, limit)
    .map((it) => ({ ...it, date: it.date ? new Date(it.date).toISOString() : null }));

  const ttl = items.length ? TTL_SECONDS : ERROR_TTL_SECONDS;
  const res = json({ updated: new Date().toISOString(), items, errors }, ttl);
  context.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

function json(body, ttl) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${ttl}`,
    },
  });
}

async function loadFeed(feed) {
  const res = await fetch(feed.url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; PersonalSiteFeedBot/1.0)",
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    },
    cf: { cacheTtl: 900, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  return parseFeed(xml, feed.name);
}

// ---------- Minimal RSS 2.0 / Atom parser (Workers have no DOMParser) ----------

export function parseFeed(xml, source) {
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  return blocks.map((b) => {
    const title = cleanText(tag(b, "title"));
    const link = findLink(b);
    const rawDate = tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date");
    const parsed = rawDate ? Date.parse(clean(rawDate)) : NaN;
    const body = tag(b, "description") || tag(b, "summary") || tag(b, "content:encoded") || tag(b, "content");
    return {
      title,
      link,
      date: Number.isNaN(parsed) ? null : parsed,
      summary: truncate(clean(body), 220),
      image: findImage(b),
      source,
    };
  }).filter((it) => it.title && it.link);
}

function escapeName(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tag(block, name) {
  const n = escapeName(name);
  const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${n}>`, "i"));
  return m ? stripCdata(m[1]) : "";
}

function attr(tagText, name) {
  const m = tagText.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return m ? decode(m[1]) : "";
}

function findLink(block) {
  const rss = tag(block, "link").trim();
  if (/^https?:\/\//.test(rss)) return decode(rss);
  const links = [...block.matchAll(/<link\b[^>]*\/?>/gi)].map((m) => m[0]);
  const preferred =
    links.find((l) => /rel=["']alternate["']/i.test(l)) || links.find((l) => !/\brel=/i.test(l)) || links[0];
  const href = preferred ? attr(preferred, "href") : "";
  if (/^https?:\/\//.test(href)) return href;
  const guid = clean(tag(block, "guid"));
  return /^https?:\/\//.test(guid) ? guid : "";
}

function findImage(block) {
  const candidates = [
    ...[...block.matchAll(/<enclosure\b[^>]*>/gi)].map((m) => m[0]).filter((t) => /type=["']image\//i.test(t)),
    ...[...block.matchAll(/<media:(?:content|thumbnail)\b[^>]*>/gi)].map((m) => m[0]),
  ];
  for (const c of candidates) {
    const url = attr(c, "url");
    if (/^https:\/\//.test(url)) return url;
  }
  const html = decode(tag(block, "content:encoded") || tag(block, "description") || tag(block, "content"));
  const img = html.match(/<img\b[^>]*\bsrc=["'](https:\/\/[^"']+)["']/i);
  return img ? img[1] : null;
}

function stripCdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", hellip: "…", pound: "£",
};

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

// Plain-text fields (titles): strip any raw tags, then decode entities once.
function cleanText(s) {
  if (!s) return "";
  let t = decode(stripCdata(s).replace(/<[^>]+>/g, " "));
  if (/&(?:amp|quot|#\d+|#x[0-9a-f]+);/i.test(t)) t = decode(t); // Atom type="html" double-encoding
  return t.replace(/\s+/g, " ").trim();
}

// HTML fields (descriptions), which may be entity-encoded HTML.
function clean(s) {
  if (!s) return "";
  let t = decode(stripCdata(s));
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
  return decode(t).replace(/\s+/g, " ").trim();
}

function truncate(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : n).replace(/[,;:.\s]+$/, "") + "…";
}
