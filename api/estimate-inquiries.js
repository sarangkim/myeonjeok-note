const TABLE = "estimate_inquiries";
const COLUMNS = "id,name,phone,address,estimate_url,source,user_agent,referrer,status,memo,created_at";
const DEFAULT_ADMIN_EMAILS = [
  "77happycleaning@gmail.com",
  "hangstore77@gmail.com",
  "onlyghjr@gmail.com",
  "contact@happycleaning.co.kr",
];

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (!["GET", "POST", "PATCH"].includes(req.method)) {
    return res.status(405).json({ ok: false, message: "허용되지 않는 요청 방식입니다." });
  }

  try {
    assertSupabaseEnv();
    if (req.method === "GET") {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ ok: false, message: "로그인이 필요합니다." });
      if (!isAdminUser(user)) return res.status(403).json({ ok: false, message: "관리자만 볼 수 있습니다." });

      const status = clamp(req.query.status, 40);
      const statusFilter = status && status !== "all"
        ? `&status=eq.${encodeURIComponent(status)}`
        : "&status=neq.hidden";
      const rows = await supabaseRequest(`${TABLE}?select=${COLUMNS}${statusFilter}&order=created_at.desc&limit=120`, { method: "GET" });
      return res.status(200).json({ ok: true, inquiries: rows });
    }

    if (req.method === "PATCH") {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ ok: false, message: "로그인이 필요합니다." });
      if (!isAdminUser(user)) return res.status(403).json({ ok: false, message: "관리자만 처리할 수 있습니다." });

      const body = await readJson(req);
      const id = clamp(body.id || req.query.id, 40);
      const status = clamp(body.status, 40);
      if (!id) return res.status(400).json({ ok: false, message: "상담문의 ID가 필요합니다." });
      if (!["new", "checking", "done", "hidden"].includes(status)) {
        return res.status(400).json({ ok: false, message: "상태 값이 올바르지 않습니다." });
      }
      const updated = await supabaseRequest(`${TABLE}?id=eq.${encodeURIComponent(id)}&select=${COLUMNS}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      return res.status(200).json({ ok: true, inquiry: updated[0] || null });
    }

    const body = await readJson(req);
    const name = clamp(body.name, 80);
    const phone = clamp(body.phone, 80);
    const floor = clamp(body.floor, 80);
    const ho = normalizeHo(clamp(body.ho, 80));
    const address = inquiryAddress(body.address, floor, ho);
    const estimateUrl = inquiryEstimateUrl(body.estimateUrl || body.estimate_url, body.address, floor, ho);

    if (!name || !phone) {
      return res.status(400).json({ ok: false, message: "담당자 이름과 연락처가 필요합니다." });
    }

    const row = {
      id: makeId(12),
      name,
      phone,
      address: clamp(address, 500),
      estimate_url: clamp(estimateUrl, 1000),
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
    const inquiry = created[0] || row;
    const telegram = await sendTelegramNotification(inquiry).catch((error) => ({
      ok: false,
      message: error.message || String(error),
    }));

    return res.status(201).json({ ok: true, inquiry, telegram });
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

async function getAuthUser(req) {
  const auth = String(req.headers.authorization || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const base = supabaseBaseUrl();
  const response = await fetch(`${base}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${match[1].trim()}`,
    },
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.id ? user : null;
}

function isAdminUser(user) {
  const email = String(user?.email || "").toLowerCase();
  const configured = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const admins = configured.length ? configured : DEFAULT_ADMIN_EMAILS;
  return admins.includes(email);
}

async function sendTelegramNotification(inquiry) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatId) return { ok: false, skipped: true, message: "텔레그램 환경변수가 없습니다." };

  const text = [
    "새 상담 요청이 접수되었습니다.",
    `접수 ID: ${inquiry.id || "-"}`,
    `출처: ${inquiry.source || "-"}`,
    "개인정보는 Supabase estimate_inquiries 테이블에서 확인하세요.",
  ].join("\n");

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || `Telegram 오류: ${response.status}`);
  }
  return { ok: true };
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

function normalizeHo(value) {
  const text = String(value || "").trim();
  return text ? text.replace(/호$/, "") + "호" : "";
}

function inquiryAddress(address, floor, ho) {
  const base = clamp(address, 500);
  const unit = [floor, ho].filter(Boolean).join(" / ");
  if (!unit) return base;
  if (base.includes(unit)) return base;
  return [base, unit].filter(Boolean).join(" / ");
}

function inquiryEstimateUrl(rawUrl, address, floor, ho) {
  let url;
  try {
    url = new URL(String(rawUrl || "https://area.happycleaning.co.kr/?embed=1"));
  } catch {
    url = new URL("https://area.happycleaning.co.kr/?embed=1");
  }
  url.searchParams.set("embed", "1");
  const baseAddress = clamp(address, 500).split(" / ")[0].trim();
  if (baseAddress) {
    url.searchParams.set("address", baseAddress);
    url.searchParams.set("q", baseAddress);
  }
  if (floor) url.searchParams.set("floor", floor);
  if (ho) url.searchParams.set("ho", ho.replace(/호$/, ""));
  return url.toString();
}

function makeId(length) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
