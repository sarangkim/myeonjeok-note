const TABLE = "app_keepalive";

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ ok: false, message: "GET 또는 POST만 지원합니다." });
  }

  try {
    assertSupabaseEnv();
    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, message: "인증이 필요합니다." });
    }

    const checkedAt = new Date().toISOString();
    let mode = "upsert";
    let row = null;

    try {
      const rows = await supabaseRequest(`${TABLE}?on_conflict=id&select=id,last_seen_at,note,updated_at`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          id: "supabase",
          last_seen_at: checkedAt,
          note: "vercel-cron",
          updated_at: checkedAt,
        }),
      });
      row = rows[0] || null;
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
      mode = "fallback-read";
      await supabaseRequest("estimate_inquiries?select=id&limit=1", { method: "GET" });
    }

    return res.status(200).json({ ok: true, mode, checked_at: checkedAt, row });
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

function isAuthorized(req) {
  const secret = String(process.env.KEEPALIVE_SECRET || process.env.CRON_SECRET || "").trim();
  if (!secret) return true;

  const auth = String(req.headers.authorization || "");
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  const querySecret = String(req.query?.secret || "").trim();
  return (bearer && bearer[1].trim() === secret) || querySecret === secret;
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
    const message = data?.message || data?.hint || `Supabase 오류: ${response.status}`;
    const error = new Error(message);
    error.code = data?.code;
    error.details = data?.details;
    throw error;
  }
  return Array.isArray(data) ? data : [];
}

function isMissingTableError(error) {
  return error?.code === "42P01" || /relation .* does not exist|Could not find the table/i.test(error?.message || "");
}
