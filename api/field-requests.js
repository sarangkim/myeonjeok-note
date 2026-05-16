const REQUESTS_TABLE = "field_requests";
const APPLICATIONS_TABLE = "field_request_applications";
const PROFILES_TABLE = "user_profiles";

const PUBLIC_REQUEST_COLUMNS = "id,public_area,cleaning_type,space_type,area_pyeong,reward_text,preferred_date,description,status,created_at,updated_at";
const OWNER_REQUEST_COLUMNS = `${PUBLIC_REQUEST_COLUMNS},address,road,jibun,floor,ho,requester_user_id`;
const APPLICATION_COLUMNS = "id,request_id,applicant_user_id,message,status,report_status,report_text,estimate_amount,completed_at,created_at,updated_at";
const PROFILE_COLUMNS = "user_id,email,display_name,company_name,phone,service_area,bio";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    assertSupabaseEnv();
    const user = await getAuthUser(req);

    if (req.method === "GET") {
      if (String(req.query.detail || "") === "1") {
        if (!user) return res.status(401).json({ ok: false, message: "로그인이 필요합니다." });
        const requestId = cleanId(req.query.request_id);
        if (!requestId) return res.status(400).json({ ok: false, message: "요청 ID가 필요합니다." });

        const ownerRows = await supabaseRequest(`${REQUESTS_TABLE}?id=eq.${encodeURIComponent(requestId)}&requester_user_id=eq.${encodeURIComponent(user.id)}&select=${OWNER_REQUEST_COLUMNS}`, { method: "GET" });
        if (ownerRows.length) return res.status(200).json({ ok: true, request: ownerRows[0], access: "owner" });

        const approvedRows = await supabaseRequest(`${APPLICATIONS_TABLE}?request_id=eq.${encodeURIComponent(requestId)}&applicant_user_id=eq.${encodeURIComponent(user.id)}&status=eq.approved&select=id`, { method: "GET" });
        if (!approvedRows.length) return res.status(403).json({ ok: false, message: "승인된 신청자만 상세주소를 볼 수 있습니다." });

        const rows = await supabaseRequest(`${REQUESTS_TABLE}?id=eq.${encodeURIComponent(requestId)}&select=${OWNER_REQUEST_COLUMNS}`, { method: "GET" });
        if (!rows.length) return res.status(404).json({ ok: false, message: "요청을 찾을 수 없습니다." });
        return res.status(200).json({ ok: true, request: rows[0], access: "approved_applicant" });
      }

      if (String(req.query.mine || "") === "1") {
        if (!user) return res.status(401).json({ ok: false, message: "로그인이 필요합니다." });
        const mine = await supabaseRequest(`${REQUESTS_TABLE}?requester_user_id=eq.${encodeURIComponent(user.id)}&select=${OWNER_REQUEST_COLUMNS}&order=updated_at.desc&limit=100`, { method: "GET" });
        return res.status(200).json({ ok: true, requests: await attachApplicationCounts(mine) });
      }

      if (String(req.query.applications || "") === "1") {
        if (!user) return res.status(401).json({ ok: false, message: "로그인이 필요합니다." });
        const requestId = cleanId(req.query.request_id);
        if (!requestId) return res.status(400).json({ ok: false, message: "요청 ID가 필요합니다." });

        const rows = await supabaseRequest(`${REQUESTS_TABLE}?id=eq.${encodeURIComponent(requestId)}&requester_user_id=eq.${encodeURIComponent(user.id)}&select=id`, { method: "GET" });
        if (!rows.length) return res.status(403).json({ ok: false, message: "요청 작성자만 신청자를 볼 수 있습니다." });

        const applications = await supabaseRequest(`${APPLICATIONS_TABLE}?request_id=eq.${encodeURIComponent(requestId)}&select=${APPLICATION_COLUMNS}&order=created_at.asc`, { method: "GET" });
        return res.status(200).json({ ok: true, applications: await attachApplicantDetails(applications) });
      }

      if (String(req.query.applied || "") === "1") {
        if (!user) return res.status(401).json({ ok: false, message: "로그인이 필요합니다." });
        const applications = await supabaseRequest(`${APPLICATIONS_TABLE}?applicant_user_id=eq.${encodeURIComponent(user.id)}&select=${APPLICATION_COLUMNS}&order=updated_at.desc&limit=100`, { method: "GET" });
        return res.status(200).json({ ok: true, applications: await attachApplicantDetails(applications) });
      }

      const requests = await supabaseRequest(`${REQUESTS_TABLE}?status=eq.open&select=${PUBLIC_REQUEST_COLUMNS}&order=created_at.desc&limit=100`, { method: "GET" });
      return res.status(200).json({ ok: true, requests: await attachApplicationCounts(requests) });
    }

    if (req.method === "POST") {
      if (!user) return res.status(401).json({ ok: false, message: "로그인이 필요합니다." });
      const body = await readJson(req);

      if (body.action === "apply") {
        const requestId = cleanId(body.request_id);
        if (!requestId) return res.status(400).json({ ok: false, message: "요청 ID가 필요합니다." });
        const row = {
          id: makeId(10),
          request_id: requestId,
          applicant_user_id: user.id,
          message: clamp(body.message, 1000),
          status: "pending",
        };
        const created = await supabaseRequest(`${APPLICATIONS_TABLE}?select=${APPLICATION_COLUMNS}`, {
          method: "POST",
          body: JSON.stringify(row),
        });
        const application = created[0] ? { ...created[0], applicant_email: user.email || "" } : null;
        return res.status(201).json({ ok: true, application });
      }

      const row = normalizeRequestBody(body, {
        id: makeId(10),
        requester_user_id: user.id,
        status: "open",
      });
      const created = await supabaseRequest(`${REQUESTS_TABLE}?select=${OWNER_REQUEST_COLUMNS}`, {
        method: "POST",
        body: JSON.stringify(row),
      });
      return res.status(201).json({ ok: true, request: created[0] });
    }

    if (req.method === "PATCH") {
      if (!user) return res.status(401).json({ ok: false, message: "로그인이 필요합니다." });
      const body = await readJson(req);

      if (body.action === "approve") {
        const applicationId = cleanId(body.application_id);
        if (!applicationId) return res.status(400).json({ ok: false, message: "신청 ID가 필요합니다." });

        const applicationRows = await supabaseRequest(`${APPLICATIONS_TABLE}?id=eq.${encodeURIComponent(applicationId)}&select=${APPLICATION_COLUMNS}`, { method: "GET" });
        if (!applicationRows.length) return res.status(404).json({ ok: false, message: "신청을 찾을 수 없습니다." });

        const app = applicationRows[0];
        const ownerRows = await supabaseRequest(`${REQUESTS_TABLE}?id=eq.${encodeURIComponent(app.request_id)}&requester_user_id=eq.${encodeURIComponent(user.id)}&select=id`, { method: "GET" });
        if (!ownerRows.length) return res.status(403).json({ ok: false, message: "요청 작성자만 승인할 수 있습니다." });

        const updated = await supabaseRequest(`${APPLICATIONS_TABLE}?id=eq.${encodeURIComponent(applicationId)}&select=${APPLICATION_COLUMNS}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "approved", updated_at: new Date().toISOString() }),
        });
        return res.status(200).json({ ok: true, application: updated[0] });
      }

      if (body.action === "report") {
        const applicationId = cleanId(body.application_id);
        if (!applicationId) return res.status(400).json({ ok: false, message: "신청 ID가 필요합니다." });

        const status = String(body.report_status || "").trim();
        if (!["visited", "quoted", "not_closed"].includes(status)) {
          return res.status(400).json({ ok: false, message: "보고 상태가 올바르지 않습니다." });
        }

        const updated = await supabaseRequest(`${APPLICATIONS_TABLE}?id=eq.${encodeURIComponent(applicationId)}&applicant_user_id=eq.${encodeURIComponent(user.id)}&status=eq.approved&select=${APPLICATION_COLUMNS}`, {
          method: "PATCH",
          body: JSON.stringify({
            report_status: status,
            report_text: clamp(body.report_text, 2000),
            estimate_amount: clamp(body.estimate_amount, 120),
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        });

        if (!updated.length) return res.status(403).json({ ok: false, message: "승인된 신청자만 보고할 수 있습니다." });
        return res.status(200).json({ ok: true, application: updated[0] });
      }

      return res.status(400).json({ ok: false, message: "지원하지 않는 작업입니다." });
    }

    return res.status(405).json({ ok: false, message: "허용되지 않는 요청 방식입니다." });
  } catch (error) {
    return res.status(500).json({ ok: false, message: toKoreanError(error) });
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
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase 서비스 키 설정이 없습니다.");
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
  if (!response.ok) throw new Error(data?.message || data?.hint || `Supabase 오류: ${response.status}`);
  return Array.isArray(data) ? data : [];
}

async function attachApplicantDetails(applications) {
  if (!applications.length) return applications;
  const uniqueIds = [...new Set(applications.map((app) => app.applicant_user_id).filter(Boolean))];
  const authPairs = await Promise.all(uniqueIds.map(async (id) => [id, await getAuthUserSummary(id)]));
  const authUsers = new Map(authPairs);
  const stats = await getApplicantStats(uniqueIds);
  const profiles = await getProfiles(uniqueIds);
  return applications.map((app) => ({
    ...app,
    applicant_email: authUsers.get(app.applicant_user_id)?.email || "",
    applicant_avatar_url: authUsers.get(app.applicant_user_id)?.avatar_url || "",
    applicant_profile: profiles.get(app.applicant_user_id) || null,
    applicant_stats: stats.get(app.applicant_user_id) || {
      applied_count: 0,
      approved_count: 0,
      completed_count: 0,
      quoted_count: 0,
      not_closed_count: 0,
    },
  }));
}

async function getApplicantStats(userIds) {
  const stats = new Map();
  for (const id of userIds) {
    stats.set(id, {
      applied_count: 0,
      approved_count: 0,
      completed_count: 0,
      quoted_count: 0,
      not_closed_count: 0,
    });
  }
  if (!userIds.length) return stats;

  const filter = userIds.map((id) => encodeURIComponent(id)).join(",");
  const rows = await supabaseRequest(`${APPLICATIONS_TABLE}?applicant_user_id=in.(${filter})&select=applicant_user_id,status,report_status`, { method: "GET" });
  for (const row of rows) {
    const current = stats.get(row.applicant_user_id);
    if (!current) continue;
    current.applied_count += 1;
    if (row.status === "approved") current.approved_count += 1;
    if (row.report_status) current.completed_count += 1;
    if (row.report_status === "quoted") current.quoted_count += 1;
    if (row.report_status === "not_closed") current.not_closed_count += 1;
  }
  return stats;
}

async function getProfiles(userIds) {
  const profiles = new Map();
  if (!userIds.length) return profiles;

  const filter = userIds.map((id) => encodeURIComponent(id)).join(",");
  try {
    const rows = await supabaseRequest(`${PROFILES_TABLE}?user_id=in.(${filter})&select=${PROFILE_COLUMNS}`, { method: "GET" });
    for (const row of rows) profiles.set(row.user_id, row);
  } catch (error) {
    if (!String(error?.message || error).includes("does not exist") && !String(error?.message || error).includes("schema cache")) throw error;
  }
  return profiles;
}

async function getAuthUserSummary(userId) {
  const base = supabaseBaseUrl();
  const response = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!response.ok) return { email: "", avatar_url: "" };
  const user = await response.json();
  const metadata = user?.user_metadata || {};
  return {
    email: user?.email || "",
    avatar_url: metadata.avatar_url || metadata.picture || "",
  };
}

async function attachApplicationCounts(requests) {
  if (!requests.length) return requests;
  const ids = requests.map((request) => request.id).filter(Boolean);
  if (!ids.length) return requests;

  const filter = ids.map((id) => encodeURIComponent(id)).join(",");
  const applications = await supabaseRequest(`${APPLICATIONS_TABLE}?request_id=in.(${filter})&select=request_id`, { method: "GET" });
  const counts = new Map();
  for (const application of applications) {
    counts.set(application.request_id, (counts.get(application.request_id) || 0) + 1);
  }
  return requests.map((request) => ({
    ...request,
    application_count: counts.get(request.id) || 0,
  }));
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
    return "데이터베이스 구조가 아직 맞지 않습니다. 잠시 후 다시 시도해주세요.";
  }
  if (message.toLowerCase().includes("duplicate")) return "이미 신청한 요청입니다.";
  return message || "처리 중 오류가 발생했습니다.";
}

function normalizeRequestBody(body, extra) {
  return {
    ...extra,
    address: clamp(body.address, 500),
    road: clamp(body.road, 500),
    jibun: clamp(body.jibun, 500),
    floor: clamp(body.floor, 80),
    ho: clamp(body.ho, 80),
    public_area: clamp(body.public_area, 200),
    cleaning_type: clamp(body.cleaning_type, 80),
    space_type: clamp(body.space_type, 80),
    area_pyeong: toNullableNumber(body.area_pyeong),
    reward_text: clamp(body.reward_text, 200),
    preferred_date: clamp(body.preferred_date, 80),
    description: clamp(body.description, 2000),
  };
}

function toNullableNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanId(value) {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{6,40}$/.test(id) ? id : "";
}

function clamp(value, max) {
  return String(value || "").trim().slice(0, max);
}

function makeId(length) {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = require("crypto").randomBytes(length);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

