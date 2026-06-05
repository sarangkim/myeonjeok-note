const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_ITEMS = 24;

let cachedAt = 0;
let cachedPayload = null;

const queries = [
  "청소업체",
  "사무실 청소",
  "상가 청소",
  "병원 청소",
  "건물 청소 관리",
  "청소 위생관리",
  "에어컨 청소",
  "입주청소",
  "시설관리 청소"
];

module.exports = async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=1800");

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, message: "GET only" });
    return;
  }

  const refresh = request.query && request.query.refresh === "1";
  const now = Date.now();
  if (!refresh && cachedPayload && now - cachedAt < CACHE_TTL_MS) {
    response.status(200).json({ ...cachedPayload, cached: true });
    return;
  }

  try {
    const feeds = await Promise.allSettled(queries.map(fetchFeed));
    const items = feeds
      .flatMap((result) => result.status === "fulfilled" ? result.value : [])
      .filter(Boolean);
    const normalized = dedupeAndSort(items).slice(0, MAX_ITEMS);
    const payload = {
      ok: true,
      source: "Google News RSS",
      updated_at: new Date().toISOString(),
      items: normalized
    };

    cachedAt = now;
    cachedPayload = payload;
    response.status(200).json(payload);
  } catch (error) {
    response.status(502).json({
      ok: false,
      message: "청소뉴스를 불러오지 못했습니다.",
      detail: error && error.message ? error.message : String(error)
    });
  }
};

async function fetchFeed(query) {
  const url = "https://news.google.com/rss/search?q=" +
    encodeURIComponent(query + " when:30d") +
    "&hl=ko&gl=KR&ceid=KR:ko";
  const result = await fetch(url, {
    headers: {
      "User-Agent": "EstimateNote/1.0 (+https://area.happycleaning.co.kr)"
    }
  });
  if (!result.ok) throw new Error("RSS fetch failed: " + result.status);
  const xml = await result.text();
  return extractItems(xml, query);
}

function extractItems(xml, query) {
  const matches = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return matches.map((itemXml) => {
    const title = cleanText(readTag(itemXml, "title"));
    const rawLink = cleanText(readTag(itemXml, "link"));
    const description = cleanText(readTag(itemXml, "description"));
    const pubDate = cleanText(readTag(itemXml, "pubDate"));
    const source = cleanText(readTag(itemXml, "source"));
    const link = sanitizeLink(rawLink);

    if (!title || !link) return null;
    return {
      title: trimText(title, 120),
      link,
      source: source || parseSource(title) || "Google News",
      published_at: toIsoDate(pubDate),
      summary: trimText(description, 150),
      keyword: query
    };
  }).filter(Boolean);
}

function readTag(xml, tag) {
  const pattern = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + tag + ">", "i");
  const match = xml.match(pattern);
  return match ? decodeXml(match[1]) : "";
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimText(value, max) {
  const text = cleanText(value);
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trim() + "…";
}

function sanitizeLink(link) {
  try {
    const url = new URL(link);
    if (!/^https?:$/.test(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function toIsoDate(value) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function parseSource(title) {
  const parts = String(title || "").split(" - ");
  return parts.length > 1 ? parts[parts.length - 1].trim() : "";
}

function dedupeAndSort(items) {
  const seen = new Set();
  return items
    .filter((item) => {
      const key = (item.link || item.title || "").toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const left = Date.parse(a.published_at || "") || 0;
      const right = Date.parse(b.published_at || "") || 0;
      return right - left;
    });
}
