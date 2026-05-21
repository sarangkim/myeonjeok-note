const crypto = require("crypto");

const REQUESTS_TABLE = "field_requests";
const APPLICATIONS_TABLE = "field_request_applications";
const MESSAGES_TABLE = "field_request_messages";
const APPLICATION_COLUMNS = "id,request_id,applicant_user_id,status";
const MESSAGE_COLUMNS = "id,request_id,application_id,sender_user_id,body,status,created_at";

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
      const applicationId = cleanId(req.query.application_id);
      if (!applicationId) return res.status(400).json({ ok: false, message: "신청 ID가 필요합니다." });
      const context = await getMessageContext(applicationId, user.id);
      const messages = await supabaseRequest(`${MESSAGES_TABLE}?application_id=eq.${encodeURIComponent(applicationId)}&status=eq.active&select=${MESSAGE_COLUMNS}&order=created_at.asc&limit=200`, { method: "GET" });
      return res.status(200).json({ ok: true, context, messages });
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const applicationId = cleanId(body.application_id);
      if (!applicationId) return res.status(400).json({ ok: false, message: "신청 ID가 필요합니다." });
      const context = await getMessageContext(applicationId, user.id);
      const row = {
        id: makeId(12),
        request_id: context.request_id,
        application_id: applicationId,
        sender_user_id: user.id,
        body: clamp(body.body, 2000),
        status: "active",
      };
      if (!row.body) return res.status(400).json({ ok: false, message: "쪽지 내용을 입력해주세요." });
      const created = await supabaseRequest(`${MESSAGES_TABLE}?select=${MESSAGE_COLUMNS}`, { method: "POST", body: JSON.stringify(row) });
      return res.status(201).json({ ok: true, message: created[0] });
    }

    return res.status(405).json({ ok: false, message: "허용되지 않는 요청 방식입니다." });
  } catch (error) {
    return res.status(500).json({ ok: false, message: toKoreanError(error) });
  }
};

async function getMessageContext(applicationId, userId) {
  const applications = await supabaseRequest(`${APPLICATIONS_TABLE}?id=eq.${encodeURIComponent(applicationId)}&select=${APPLICATION_COLUMNS}&limit=1`, { method: "GET" });
  if (!applications.length) throw new Error("신청을 찾을 수 없습니다.");
  const application = applications[0];
  if (application.status !== "approved") throw new Error("승인된 신청에서만 쪽지를 사용할 수 있습니다.");

  const ownerRows = await supabaseRequest(`${REQUESTS_TABLE}?id=eq.${encodeURIComponent(application.request_id)}&select=id,requester_user_id&limit=1`, { method: "GET" });
  if (!ownerRows.length) throw new Error("요청을 찾을 수 없습니다.");
  const request = ownerRows[0];
  const isOwner = request.requester_user_id === userId;
  const isApplicant = application.applicant_user_id === userId;
  if (!isOwner && !isApplicant) throw new Error("이 요청의 쪽지를 볼 권한이 없습니다.");

  return {
    request_id: application.request_id,
    application_id: application.id,
    requester_user_id: request.requester_user_id,
    applicant_user_id: application.applicant_user_id,
    viewer_role: isOwner ? "owner" : "applicant",
  };
}

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
    return "쪽지 테이블이 아직 준비되지 않았습니다. request-messages-schema.sql을 Supabase SQL Editor에서 실행해주세요.";
  }
  return message || "처리 중 오류가 발생했습니다.";
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
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}
