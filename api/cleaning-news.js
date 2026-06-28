const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_ITEMS = 24;

let cachedAt = 0;
let cachedPayload = null;

const queries = [
  { keyword: "청소업체", category: "industry" },
  { keyword: "사무실청소 업체", category: "industry" },
  { keyword: "상가청소 업체", category: "industry" },
  { keyword: "병원청소 업체", category: "industry" },
  { keyword: "입주청소", category: "industry" },
  { keyword: "건물 청소 관리", category: "facility" },
  { keyword: "청소 위생관리", category: "facility" },
  { keyword: "시설관리 청소", category: "facility" },
  { keyword: "에어컨 청소", category: "aircon" },
  { keyword: "소상공인 지원금 청소업", category: "support" },
  { keyword: "청소업 소상공인 정부지원", category: "support" },
  { keyword: "자영업자 지원금", category: "support" },
  { keyword: "소상공인 정책자금", category: "support" },
  { keyword: "소상공인 고용지원금", category: "support" }
];

const categoryTerms = {
  industry: ["청소", "청소업", "청소업체", "클리닝", "미화", "위생", "방역", "입주청소", "사무실청소", "상가청소", "병원청소"],
  facility: ["청소", "시설관리", "시설 관리", "건물관리", "건물 관리", "위생", "환경정비", "환경 정비", "폐기물", "노후"],
  aircon: ["에어컨", "냉난방", "공조", "실외기", "필터", "냉방"],
  support: ["소상공인", "자영업자", "정책자금", "지원금", "고용지원", "정부지원", "보조금", "대출", "금융지원"]
};

const blockedTerms = [
  "대통령", "연예", "드라마", "배우", "아이돌", "스타벅스 알바생", "알바생에게 벌어진", "100%실화",
  "동생에게 싸주고", "관급공사", "연극영화과", "부모님은요", "스포츠", "야구", "축구"
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
  const keyword = query.keyword || query;
  const url = "https://news.google.com/rss/search?q=" +
    encodeURIComponent(keyword + " when:30d") +
    "&hl=ko&gl=KR&ceid=KR:ko";
  const result = await fetch(url, {
    headers: {
      "User-Agent": "EstimateNote/1.0 (+https://area.happycleaning.co.kr)"
    }
  });
  if (!result.ok) throw new Error("RSS fetch failed: " + result.status);
  const xml = await result.text();
  return extractItems(xml, keyword, query.category || "industry");
}

function extractItems(xml, query, category) {
  const matches = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return matches.map((itemXml) => {
    const title = cleanText(readTag(itemXml, "title"));
    const rawLink = cleanText(readTag(itemXml, "link"));
    const description = cleanText(readTag(itemXml, "description"));
    const pubDate = cleanText(readTag(itemXml, "pubDate"));
    const source = cleanText(readTag(itemXml, "source"));
    const link = sanitizeLink(rawLink);

    if (!title || !link) return null;
    const news = {
      title: trimText(title, 120),
      link,
      source: source || parseSource(title) || "Google News",
      published_at: toIsoDate(pubDate),
      summary: trimText(description, 150),
      keyword: query,
      category
    };
    return isRelevantNews(news) ? news : null;
  }).filter(Boolean);
}

function isRelevantNews(item) {
  const text = normalizeNewsText([item.title, item.summary, item.source].filter(Boolean).join(" "));
  const titleText = normalizeNewsText(item.title || "");
  const summaryText = normalizeNewsText(item.summary || "");
  if (!text) return false;

  if (blockedTerms.some((term) => text.includes(normalizeNewsText(term)))) return false;

  const terms = categoryTerms[item.category] || categoryTerms.industry;
  const hasCategoryTerm = terms.some((term) => text.includes(normalizeNewsText(term)));
  if (!hasCategoryTerm) return false;

  if (item.category === "support") {
    return ["소상공인", "자영업자", "지원금", "정책자금", "고용지원", "정부지원", "보조금", "대출"].some((term) => text.includes(term));
  }

  if (item.category === "aircon") return text.includes("에어컨") || text.includes("냉난방") || text.includes("공조");

  return titleText.includes("청소") ||
    titleText.includes("위생") ||
    titleText.includes("시설관리") ||
    titleText.includes("환경정비") ||
    summaryText.includes("청소") ||
    summaryText.includes("위생") ||
    summaryText.includes("시설관리") ||
    summaryText.includes("환경정비");
}

function normalizeNewsText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
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
