const DEFAULT_ADMIN_EMAILS = [
  "77happycleaning@gmail.com",
  "hangstore77@gmail.com",
  "onlyghjr@gmail.com",
  "contact@happycleaning.co.kr",
];

const PROFILES_TABLE = "user_profiles";
const REQUESTS_TABLE = "field_requests";
const APPLICATIONS_TABLE = "field_request_applications";
const MESSAGES_TABLE = "field_request_messages";
const REPORTS_TABLE = "board_reports";
const POSTS_TABLE = "board_posts";
const COMMENTS_TABLE = "board_comments";

const PROFILE_COLUMNS = "user_id,email,display_name,company_name,phone,service_area,member_role,provider_status,provider_penalty_count,provider_suspended_at,provider_requested_at,updated_at";
const REQUEST_COLUMNS = "id,requester_user_id,public_area,cleaning_type,space_type,address,road,jibun,floor,ho,status,created_at,updated_at";
const APPLICATION_COLUMNS = "id,request_id,applicant_user_id,message,status,report_status,report_text,estimate_amount,created_at,updated_at";
const MESSAGE_COLUMNS = "id,request_id,application_id,sender_user_id,body,status,created_at";
const REPORT_COLUMNS = "id,target_type,post_id,comment_id,reporter_user_id,reason,status,created_at,updated_at";
const POST_COLUMNS = "id,author_user_id,title,category,status,is_pinned,created_at,updated_at";
const COMMENT_COLUMNS = "id,post_id,author_user_id,body,status,created_at,updated_at";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, message: "허용되지 않는 요청 방식입니다." });

  try {
    assertSupabaseEnv();
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ ok: false, message: "로그인이 필요합니다." });
    if (!isAdminUser(user)) return res.status(403).json({ ok: false, message: "관리자만 볼 수 있습니다." });

    const [providers, requests, applications, messages, reports, hiddenPosts, hiddenComments] = await Promise.all([
      optionalSupabaseRequest(`${PROFILES_TABLE}?member_role=eq.provider&select=${PROFILE_COLUMNS}&order=provider_requested_at.desc.nullslast,updated_at.desc&limit=120`),
      optionalSupabaseRequest(`${REQUESTS_TABLE}?select=${REQUEST_COLUMNS}&order=updated_at.desc&limit=60`),
      optionalSupabaseRequest(`${APPLICATIONS_TABLE}?select=${APPLICATION_COLUMNS}&order=updated_at.desc&limit=120`),
      optionalSupabaseRequest(`${MESSAGES_TABLE}?status=eq.active&select=${MESSAGE_COLUMNS}&order=created_at.desc&limit=60`),
      optionalSupabaseRequest(`${REPORTS_TABLE}?status=eq.open&select=${REPORT_COLUMNS}&order=created_at.desc&limit=100`),
      optionalSupabaseRequest(`${POSTS_TABLE}?status=eq.hidden&select=${POST_COLUMNS}&order=updated_at.desc&limit=60`),
      optionalSupabaseRequest(`${COMMENTS_TABLE}?status=eq.hidden&select=${COMMENT_COLUMNS}&order=updated_at.desc&limit=60`),
    ]);

    const userIds = collectUserIds(providers, requests, applications, messages, reports, hiddenPosts, hiddenComments);
    const profiles = await fetchProfiles(userIds);
    const requestMap = mapById(requests);

    const pendingProviders = providers.filter((row) => row.provider_status === "pending");
    const suspendedProviders = providers.filter((row) => row.provider_status === "suspended" || Number(row.provider_penalty_count || 0) > 0);
    const needsReport = applications.filter((row) => row.status === "approved" && !row.report_status);
    const penaltyApplications = applications.filter((row) => row.report_status === "penalty_given" || row.report_status === "no_show");

    return res.status(200).json({
      ok: true,
      generated_at: new Date().toISOString(),
      stats: {
        open_requests: requests.filter((row) => row.status === "open").length,
        pending_applications: applications.filter((row) => row.status === "pending").length,
        report_needed: needsReport.length,
        open_reports: reports.length,
        hidden_items: hiddenPosts.length + hiddenComments.length,
        pending_providers: pendingProviders.length,
        suspended_providers: suspendedProviders.filter((row) => row.provider_status === "suspended").length,
        recent_messages: messages.length,
      },
      field_requests: enrichRequests(requests.slice(0, 12), profiles),
      applications_needing_report: enrichApplications(needsReport.slice(0, 12), requestMap, profiles),
      recent_messages: enrichMessages(messages.slice(0, 12), requestMap, profiles),
      board_reports: enrichReports(reports.slice(0, 12), profiles),
      hidden_posts: enrichAuthors(hiddenPosts.slice(0, 8), profiles),
      hidden_comments: enrichAuthors(hiddenComments.slice(0, 8), profiles),
      pending_providers: pendingProviders.slice(0, 12).map((row) => normalizeProfile(row)),
      penalty_providers: suspendedProviders.slice(0, 12).map((row) => normalizeProfile(row)),
      penalty_applications: enrichApplications(penaltyApplications.slice(0, 12), requestMap, profiles),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: toKoreanError(error) });
  }
};

function enrichRequests(rows, profiles) {
  return rows.map((row) => ({
    ...row,
    requester_profile: normalizeProfile(profiles[row.requester_user_id] || {}),
  }));
}

function enrichApplications(rows, requestMap, profiles) {
  return rows.map((row) => ({
    ...row,
    request: requestMap[row.request_id] || null,
    applicant_profile: normalizeProfile(profiles[row.applicant_user_id] || {}),
  }));
}

function enrichMessages(rows, requestMap, profiles) {
  return rows.map((row) => ({
    ...row,
    request: requestMap[row.request_id] || null,
    sender_profile: normalizeProfile(profiles[row.sender_user_id] || {}),
  }));
}

function enrichReports(rows, profiles) {
  return rows.map((row) => ({
    ...row,
    reporter_profile: normalizeProfile(profiles[row.reporter_user_id] || {}),
  }));
}

function enrichAuthors(rows, profiles) {
  return rows.map((row) => ({
    ...row,
    author_profile: normalizeProfile(profiles[row.author_user_id] || {}),
  }));
}

function collectUserIds(...groups) {
  const ids = new Set();
  for (const rows of groups) {
    for (const row of rows || []) {
      ["user_id", "requester_user_id", "applicant_user_id", "sender_user_id", "reporter_user_id", "author_user_id"].forEach((key) => {
        if (row[key]) ids.add(row[key]);
      });
    }
  }
  return Array.from(ids).filter(Boolean);
}

async function fetchProfiles(userIds) {
  if (!userIds.length) return {};
  const rows = await optionalSupabaseRequest(`${PROFILES_TABLE}?user_id=in.(${userIds.map(encodeURIComponent).join(",")})&select=${PROFILE_COLUMNS}`);
  return rows.reduce((map, row) => {
    map[row.user_id] = row;
    return map;
  }, {});
}

function normalizeProfile(profile) {
  return {
    user_id: profile.user_id || "",
    email: profile.email || "",
    display_name: profile.display_name || "",
    company_name: profile.company_name || "",
    phone: profile.phone || "",
    service_area: profile.service_area || "",
    member_role: profile.member_role || "",
    provider_status: profile.provider_status || "",
    provider_penalty_count: Number(profile.provider_penalty_count || 0),
    provider_suspended_at: profile.provider_suspended_at || null,
    provider_requested_at: profile.provider_requested_at || null,
  };
}

function mapById(rows) {
  return (rows || []).reduce((map, row) => {
    if (row.id) map[row.id] = row;
    return map;
  }, {});
}

async function optionalSupabaseRequest(path, options = { method: "GET" }) {
  try {
    return await supabaseRequest(path, options);
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
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

function isAdminUser(user) {
  const email = String(user?.email || "").toLowerCase();
  const configured = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const admins = configured.length ? configured : DEFAULT_ADMIN_EMAILS;
  return admins.includes(email);
}

function supabaseBaseUrl() {
  return String(process.env.SUPABASE_URL || "")
    .replace(/\r\n|\n|\r/g, "")
    .trim()
    .replace(/\/rest\/v1\/?$/, "")
    .replace(/\/+$/, "");
}

function assertSupabaseEnv() {
  if (!supabaseBaseUrl()) throw new Error("Supabase 주소 설정이 없습니다.");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase 서비스 키 설정이 없습니다.");
}

function isMissingTableError(error) {
  const message = String(error?.message || error || "");
  return message.includes("does not exist") || message.includes("schema cache");
}

function toKoreanError(error) {
  return String(error?.message || error || "") || "처리 중 오류가 발생했습니다.";
}
