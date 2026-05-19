const PROFILES_TABLE = "user_profiles";
const APPLICATIONS_TABLE = "field_request_applications";
const REQUESTS_TABLE = "field_requests";

const BASE_PROFILE_COLUMNS = "user_id,email,display_name,company_name,phone,service_area,bio,created_at,updated_at";
const PROFILE_COLUMNS = `${BASE_PROFILE_COLUMNS},member_role,provider_status,provider_requested_at,provider_approved_at`;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    assertSupabaseEnv();
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ ok: false, message: "로그인이 필요합니다." });

    if (req.method === "GET") {
      const profile = await getProfile(user);
      profile.avatar_url = getAvatarUrl(user);
      const stats = await getApplicantStats(user.id);
      Object.assign(stats, await getNotificationStats(user.id));
      return res.status(200).json({ ok: true, is_admin: isAdminUser(user), profile, stats });
    }

    if (req.method === "PATCH") {
      if (!isAdminUser(user)) return res.status(403).json({ ok: false, message: "\uAD00\uB9AC\uC790\uB9CC \uCC98\uB9AC\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." });
      const body = await readJson(req);

      if (body.action === "list_providers") {
        const status = normalizeProviderStatus(body.status || "pending");
        const rows = await listProviderProfiles(status);
        return res.status(200).json({ ok: true, providers: rows });
      }

      if (body.action === "set_provider_status") {
        const userId = cleanUuid(body.user_id);
        const status = normalizeProviderStatus(body.provider_status);
        if (!userId) return res.status(400).json({ ok: false, message: "\uD68C\uC6D0 ID\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4." });
        if (!["approved", "rejected", "pending"].includes(status)) return res.status(400).json({ ok: false, message: "\uC2B9\uC778 \uC0C1\uD0DC\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." });
        const row = {
          provider_status: status,
          provider_approved_at: status === "approved" ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        };
        const updated = await supabaseRequest(PROFILES_TABLE + "?user_id=eq." + encodeURIComponent(userId) + "&select=" + PROFILE_COLUMNS, {
          method: "PATCH",
          body: JSON.stringify(row),
        });
        return res.status(200).json({ ok: true, profile: normalizeProfileDefaults(updated[0] || {}) });
      }

      return res.status(400).json({ ok: false, message: "\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uC791\uC5C5\uC785\uB2C8\uB2E4." });
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const requestedRole = normalizeMemberRole(body.member_role);
      const currentProfile = await getProfile(user);
      const row = {
        user_id: user.id,
        email: clamp(user.email, 320),
        display_name: clamp(body.display_name, 80),
        company_name: clamp(body.company_name, 120),
        phone: clamp(body.phone, 60),
        service_area: clamp(body.service_area, 160),
        bio: clamp(body.bio, 800),
        member_role: requestedRole,
        provider_status: nextProviderStatus(currentProfile, requestedRole),
        provider_requested_at: requestedRole === "provider" && currentProfile.provider_status !== "approved" ? new Date().toISOString() : (currentProfile.provider_requested_at || null),
        provider_approved_at: currentProfile.provider_approved_at || null,
        updated_at: new Date().toISOString(),
      };

      const updated = await upsertProfile(row);

      const stats = await getApplicantStats(user.id);
      Object.assign(stats, await getNotificationStats(user.id));
      const profile = normalizeProfileDefaults(updated[0] || row);
      profile.avatar_url = getAvatarUrl(user);
      return res.status(200).json({ ok: true, is_admin: isAdminUser(user), profile, stats });
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

async function getProfile(user) {
  const rows = await fetchProfileRows(user.id);
  if (rows.length) return normalizeProfileDefaults(rows[0]);
  return {
    user_id: user.id,
    email: user.email || "",
    display_name: "",
    company_name: "",
    phone: "",
    service_area: "",
    bio: "",
    avatar_url: getAvatarUrl(user),
    member_role: "customer",
    provider_status: "none",
    provider_requested_at: null,
    provider_approved_at: null,
  };
}

function envList(name) {
  return String(process.env[name] || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminUser(user) {
  if (!user) return false;
  const emails = [...envList("ADMIN_EMAILS"), ...envList("BOARD_ADMIN_EMAILS")];
  const email = String(user.email || "").trim().toLowerCase();
  return !!email && emails.includes(email);
}

function normalizeProviderStatus(value) {
  const status = String(value || "pending").trim();
  return ["none", "pending", "approved", "rejected"].includes(status) ? status : "pending";
}

function cleanUuid(value) {
  const id = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : "";
}

async function listProviderProfiles(status) {
  const filter = status === "none" ? "" : "&provider_status=eq." + encodeURIComponent(status);
  try {
    return await supabaseRequest(PROFILES_TABLE + "?member_role=eq.provider" + filter + "&select=" + PROFILE_COLUMNS + "&order=provider_requested_at.desc.nullslast,updated_at.desc&limit=100", { method: "GET" });
  } catch (error) {
    if (!isMissingProfileRoleColumns(error)) throw error;
    return [];
  }
}
function normalizeMemberRole(value) {
  return String(value || "customer") === "provider" ? "provider" : "customer";
}

function nextProviderStatus(current, role) {
  if (role !== "provider") return "none";
  if (current && current.provider_status === "approved") return "approved";
  return "pending";
}

function normalizeProfileDefaults(profile) {
  return {
    ...profile,
    member_role: profile.member_role || "customer",
    provider_status: profile.provider_status || (profile.member_role === "provider" ? "pending" : "none"),
    provider_requested_at: profile.provider_requested_at || null,
    provider_approved_at: profile.provider_approved_at || null,
  };
}

async function fetchProfileRows(userId) {
  try {
    return await supabaseRequest(PROFILES_TABLE + "?user_id=eq." + encodeURIComponent(userId) + "&select=" + PROFILE_COLUMNS + "&limit=1", { method: "GET" });
  } catch (error) {
    if (!isMissingProfileRoleColumns(error)) throw error;
    return await supabaseRequest(PROFILES_TABLE + "?user_id=eq." + encodeURIComponent(userId) + "&select=" + BASE_PROFILE_COLUMNS + "&limit=1", { method: "GET" });
  }
}

async function upsertProfile(row) {
  try {
    return await supabaseRequest(PROFILES_TABLE + "?on_conflict=user_id&select=" + PROFILE_COLUMNS, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row),
    });
  } catch (error) {
    if (!isMissingProfileRoleColumns(error)) throw error;
    const fallback = { ...row };
    delete fallback.member_role;
    delete fallback.provider_status;
    delete fallback.provider_requested_at;
    delete fallback.provider_approved_at;
    return await supabaseRequest(PROFILES_TABLE + "?on_conflict=user_id&select=" + BASE_PROFILE_COLUMNS, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(fallback),
    });
  }
}

function isMissingProfileRoleColumns(error) {
  const msg = String(error?.message || error || "");
  return msg.includes("member_role") || msg.includes("provider_status") || msg.includes("provider_requested_at") || msg.includes("provider_approved_at") || msg.includes("schema cache");
}

function getAvatarUrl(user) {
  const metadata = user?.user_metadata || {};
  return metadata.avatar_url || metadata.picture || "";
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

async function getNotificationStats(userId) {
  const myRequests = await supabaseRequest(`${REQUESTS_TABLE}?requester_user_id=eq.${encodeURIComponent(userId)}&select=id`, { method: "GET" });
  const requestIds = myRequests.map((request) => request.id).filter(Boolean);
  let pending_application_count = 0;

  if (requestIds.length) {
    const filter = requestIds.map((id) => encodeURIComponent(id)).join(",");
    const pendingRows = await supabaseRequest(`${APPLICATIONS_TABLE}?request_id=in.(${filter})&status=eq.pending&select=id`, { method: "GET" });
    pending_application_count = pendingRows.length;
  }

  const approvedRows = await supabaseRequest(`${APPLICATIONS_TABLE}?applicant_user_id=eq.${encodeURIComponent(userId)}&status=eq.approved&select=id,report_status`, { method: "GET" });
  const report_needed_count = approvedRows.filter((row) => !row.report_status).length;

  return {
    pending_application_count,
    report_needed_count,
    notification_count: pending_application_count + report_needed_count,
  };
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
    return "프로필 테이블이 아직 준비되지 않았습니다. Supabase SQL을 실행해주세요.";
  }
  return message || "처리 중 오류가 발생했습니다.";
}

function clamp(value, max) {
  return String(value || "").trim().slice(0, max);
}

