const REQUESTS_TABLE = "field_requests";
const APPLICATIONS_TABLE = "field_request_applications";

const PUBLIC_REQUEST_COLUMNS = "id,public_area,cleaning_type,space_type,area_pyeong,reward_text,preferred_date,description,status,created_at,updated_at";
const OWNER_REQUEST_COLUMNS = `${PUBLIC_REQUEST_COLUMNS},address,road,jibun,floor,ho,requester_user_id`;
const APPLICATION_COLUMNS = "id,request_id,applicant_user_id,message,status,report_status,report_text,estimate_amount,completed_at,created_at,updated_at";

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
        if (!user) return res.status(401).json({ ok: false, message: "Login is required." });
        const requestId = cleanId(req.query.request_id);
        if (!requestId) return res.status(400).json({ ok: false, message: "request_id is required." });

        const ownerRows = await supabaseRequest(`${REQUESTS_TABLE}?id=eq.${encodeURIComponent(requestId)}&requester_user_id=eq.${encodeURIComponent(user.id)}&select=${OWNER_REQUEST_COLUMNS}`, { method: "GET" });
        if (ownerRows.length) return res.status(200).json({ ok: true, request: ownerRows[0], access: "owner" });

        const approvedRows = await supabaseRequest(`${APPLICATIONS_TABLE}?request_id=eq.${encodeURIComponent(requestId)}&applicant_user_id=eq.${encodeURIComponent(user.id)}&status=eq.approved&select=id`, { method: "GET" });
        if (!approvedRows.length) return res.status(403).json({ ok: false, message: "Approved applicants only." });

        const rows = await supabaseRequest(`${REQUESTS_TABLE}?id=eq.${encodeURIComponent(requestId)}&select=${OWNER_REQUEST_COLUMNS}`, { method: "GET" });
        if (!rows.length) return res.status(404).json({ ok: false, message: "Request not found." });
        return res.status(200).json({ ok: true, request: rows[0], access: "approved_applicant" });
      }

      if (String(req.query.mine || "") === "1") {
        if (!user) return res.status(401).json({ ok: false, message: "Login is required." });
        const mine = await supabaseRequest(`${REQUESTS_TABLE}?requester_user_id=eq.${encodeURIComponent(user.id)}&select=${OWNER_REQUEST_COLUMNS}&order=updated_at.desc&limit=100`, { method: "GET" });
        return res.status(200).json({ ok: true, requests: mine });
      }

      if (String(req.query.applications || "") === "1") {
        if (!user) return res.status(401).json({ ok: false, message: "Login is required." });
        const requestId = cleanId(req.query.request_id);
        if (!requestId) return res.status(400).json({ ok: false, message: "request_id is required." });

        const rows = await supabaseRequest(`${REQUESTS_TABLE}?id=eq.${encodeURIComponent(requestId)}&requester_user_id=eq.${encodeURIComponent(user.id)}&select=id`, { method: "GET" });
        if (!rows.length) return res.status(403).json({ ok: false, message: "Only the requester can view applications." });

        const applications = await supabaseRequest(`${APPLICATIONS_TABLE}?request_id=eq.${encodeURIComponent(requestId)}&select=${APPLICATION_COLUMNS}&order=created_at.asc`, { method: "GET" });
        return res.status(200).json({ ok: true, applications });
      }

      if (String(req.query.applied || "") === "1") {
        if (!user) return res.status(401).json({ ok: false, message: "Login is required." });
        const applications = await supabaseRequest(`${APPLICATIONS_TABLE}?applicant_user_id=eq.${encodeURIComponent(user.id)}&select=${APPLICATION_COLUMNS}&order=updated_at.desc&limit=100`, { method: "GET" });
        return res.status(200).json({ ok: true, applications });
      }

      const requests = await supabaseRequest(`${REQUESTS_TABLE}?status=eq.open&select=${PUBLIC_REQUEST_COLUMNS}&order=created_at.desc&limit=100`, { method: "GET" });
      return res.status(200).json({ ok: true, requests });
    }

    if (req.method === "POST") {
      if (!user) return res.status(401).json({ ok: false, message: "Login is required." });
      const body = await readJson(req);

      if (body.action === "apply") {
        const requestId = cleanId(body.request_id);
        if (!requestId) return res.status(400).json({ ok: false, message: "request_id is required." });
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
        return res.status(201).json({ ok: true, application: created[0] });
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
      if (!user) return res.status(401).json({ ok: false, message: "Login is required." });
      const body = await readJson(req);

      if (body.action === "approve") {
        const applicationId = cleanId(body.application_id);
        if (!applicationId) return res.status(400).json({ ok: false, message: "application_id is required." });

        const applicationRows = await supabaseRequest(`${APPLICATIONS_TABLE}?id=eq.${encodeURIComponent(applicationId)}&select=${APPLICATION_COLUMNS}`, { method: "GET" });
        if (!applicationRows.length) return res.status(404).json({ ok: false, message: "Application not found." });

        const app = applicationRows[0];
        const ownerRows = await supabaseRequest(`${REQUESTS_TABLE}?id=eq.${encodeURIComponent(app.request_id)}&requester_user_id=eq.${encodeURIComponent(user.id)}&select=id`, { method: "GET" });
        if (!ownerRows.length) return res.status(403).json({ ok: false, message: "Only the requester can approve." });

        const updated = await supabaseRequest(`${APPLICATIONS_TABLE}?id=eq.${encodeURIComponent(applicationId)}&select=${APPLICATION_COLUMNS}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "approved", updated_at: new Date().toISOString() }),
        });
        return res.status(200).json({ ok: true, application: updated[0] });
      }

      if (body.action === "report") {
        const applicationId = cleanId(body.application_id);
        if (!applicationId) return res.status(400).json({ ok: false, message: "application_id is required." });

        const status = String(body.report_status || "").trim();
        if (!["visited", "quoted", "not_closed"].includes(status)) {
          return res.status(400).json({ ok: false, message: "Invalid report_status." });
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

        if (!updated.length) return res.status(403).json({ ok: false, message: "Approved applicant only." });
        return res.status(200).json({ ok: true, application: updated[0] });
      }

      return res.status(400).json({ ok: false, message: "Unsupported action." });
    }

    return res.status(405).json({ ok: false, message: "Method not allowed." });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || String(error) });
  }
};

function assertSupabaseEnv() {
  if (!process.env.SUPABASE_URL) throw new Error("SUPABASE_URL is missing.");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
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
  if (!response.ok) throw new Error(data?.message || data?.hint || `Supabase error: ${response.status}`);
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
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
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
