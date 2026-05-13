const PROFILES_TABLE = "user_profiles";
const APPLICATIONS_TABLE = "field_request_applications";

const PROFILE_COLUMNS = "user_id,email,display_name,company_name,phone,service_area,bio,created_at,updated_at";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    assertSupabaseEnv();
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ ok: false, message: "로그인이 필요합니다." });

    if (req.method === "GET") {
      const profile = await getProfile(user);
      const stats = await getApplicantStats(user.id);
      return res.status(200).json({ ok: true, profile, stats });
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const row = {
        user_id: user.id,
        email: clamp(user.email, 320),
        display_name: clamp(body.display_name, 80),
        company_name: clamp(body.company_name, 120),
        phone: clamp(body.phone, 60),
        service_area: clamp(body.service_area, 160),
        bio: clamp(body.bio, 800),
        updated_at: new Date().toISOString(),
      };

      const updated = await supabaseRequest(`${PROFILES_TABLE}?on_conflict=user_id&select=${PROFILE_COLUMNS}`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(row),
      });

      const stats = await getApplicantStats(user.id);
      return res.status(200).json({ ok: true, profile: updated[0], stats });
    }

    return res.status(405).json({ ok: false, message: "허용되지 않는 요청 방식입니다." });
  } catch (error) {
    return res.status(500).json({ ok: false, message: toKoreanError(error) });
  }
};

function assertSupabaseEnv() {
  if (!process.env.SUPABASE_URL) throw new Error("Supabase 주소 설정이 없습니다.");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase 서비스 키 설정이 없습니다.");
}

async function getProfile(user) {
  const rows = await supabaseRequest(`${PROFILES_TABLE}?user_id=eq.${encodeURIComponent(user.id)}&select=${PROFILE_COLUMNS}&limit=1`, { method: "GET" });
  if (rows.length) return rows[0];
  return {
    user_id: user.id,
    email: user.email || "",
    display_name: "",
    company_name: "",
    phone: "",
    service_area: "",
    bio: "",
  };
}

async function getApplicantStats(userId) {
  const rows = await supabaseRequest(`${APPLICATIONS_TABLE}?applicant_user_id=eq.${encodeURIComponent(userId)}&select=status,report_status`, { method: "GET" });
  const stats = {
    applied_count: 0,
    approved_count: 0,
    completed_count: 0,
    quoted_count: 0,
    not_closed_count: 0,
  };
  for (const row of rows) {
    stats.applied_count += 1;
    if (row.status === "approved") stats.approved_count += 1;
    if (row.report_status) stats.completed_count += 1;
    if (row.report_status === "quoted") stats.quoted_count += 1;
    if (row.report_status === "not_closed") stats.not_closed_count += 1;
  }
  return stats;
}

async function supabaseRequest(path, options) {
  const base = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
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
  if (!response.ok) throw new Error(data?.message || data?.hint || `Supabase 오류: ${response.status}`);
  return Array.isArray(data) ? data : [];
}

async function getAuthUser(req) {
  const auth = String(req.headers.authorization || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const base = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
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

function toKoreanError(error) {
  const message = String(error?.message || error || "");
  if (message.includes("does not exist") || message.includes("schema cache")) {
    return "프로필 테이블이 아직 준비되지 않았습니다. Supabase SQL을 실행해주세요.";
  }
  return message || "처리 중 오류가 발생했습니다.";
}

function clamp(value, max) {
  return String(value || "").trim().slice(0, max);
}
