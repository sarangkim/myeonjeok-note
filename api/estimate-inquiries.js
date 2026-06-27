const TABLE = "estimate_inquiries";
const COLUMNS = "id,name,phone,address,estimate_url,source,user_agent,referrer,status,memo,created_at";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "허용되지 않는 요청 방식입니다." });
  }

  try {
    assertSupabaseEnv();
    const body = await readJson(req);
    const name = clamp(body.name, 80);
    const phone = clamp(body.phone, 80);

    if (!name || !phone) {
      return res.status(400).json({ ok: false, message: "담당자 이름과 연락처가 필요합니다." });
    }

    const row = {
      id: makeId(12),
      name,
      phone,
      address: clamp(body.address, 500),
      estimate_url: clamp(body.estimateUrl || body.estimate_url, 1000),
      source: clamp(body.source, 120) || "happycleaning.co.kr",
      memo: clamp(body.memo, 1000),
      user_agent: clamp(req.headers["user-agent"], 500),
      referrer: clamp(req.headers.referer || req.headers.referrer, 1000),
      status: "new",
    };

    const created = await supabaseRequest(`${TABLE}?select=${COLUMNS}`, {
      method: "POST",
      body: JSON.stringify(row),
    });

    return res.status(201).json({ ok: true, inquiry: created[0] || row });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || String(error) });
  }
};

function supabaseBaseUrl() {
  return String(process.env.SUPABASE_URL || "")
    .replace(/\\r\\n|\\n|\\r/g, "")
    .trim()
    .replace(/\/rest\/v1\/?$/, "")
    .replace(/\/+$/, "");
}

function assertSupabaseEnv() {
  if (!supabaseBaseUrl()) throw new Error("Supabase 주소 설정이 없습니다.");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase service role key 설정이 없습니다.");
}

async function supabaseRequest(path, options) {
  const base = supabaseBaseUrl();
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.hint || `Supabase 오류: ${response.status}`);
  }
  return Array.isArray(data) ? data : [];
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        req.destroy();
        reject(new Error("요청 내용이 너무 큽니다."));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("요청 형식이 올바르지 않습니다."));
      }
    });
    req.on("error", reject);
  });
}

function clamp(value, max) {
  const text = String(value || "").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function makeId(length) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
