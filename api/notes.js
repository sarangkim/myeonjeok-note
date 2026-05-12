const crypto = require("crypto");

const TABLE = "area_notes";
const PUBLIC_COLUMNS = "id,address,road,jibun,floor,ho,memo,result,has_password,created_at,updated_at";
const PRIVATE_COLUMNS = `${PUBLIC_COLUMNS},owner_user_id,password_hash,password_salt`;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    assertSupabaseEnv();

    if (req.method === "GET") {
      const user = await getAuthUser(req);
      if (String(req.query.mine || "") === "1") {
        if (!user) return res.status(401).json({ ok: false, message: "Login is required." });

        const rows = await supabaseRequest(`${TABLE}?owner_user_id=eq.${encodeURIComponent(user.id)}&select=${PUBLIC_COLUMNS}&order=updated_at.desc&limit=100`, {
          method: "GET",
        });

        return res.status(200).json({ ok: true, notes: rows });
      }

      const id = cleanId(req.query.id);
      if (!id) return res.status(400).json({ ok: false, message: "id is required." });

      const password = String(req.query.password || "");
      const rows = await supabaseRequest(`${TABLE}?id=eq.${encodeURIComponent(id)}&select=${PRIVATE_COLUMNS}`, {
        method: "GET",
      });

      if (!rows.length) return res.status(404).json({ ok: false, message: "Note not found." });

      const row = rows[0];
      const isOwner = user && row.owner_user_id && String(row.owner_user_id) === String(user.id);
      if (row.has_password && !isOwner && !verifyPassword(password, row.password_salt, row.password_hash)) {
        return res.status(200).json({
          ok: true,
          password_required: true,
          note: publicNote(row, { locked: true }),
        });
      }

      return res.status(200).json({ ok: true, note: publicNote(row) });
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const user = await getAuthUser(req);
      const id = makeId(10);
      const editToken = makeId(28);
      const passwordFields = passwordPayload(body.password);
      const row = normalizeNoteBody(body, {
        id,
        edit_token: editToken,
        ...passwordFields,
      });
      if (user) row.owner_user_id = user.id;

      const created = await supabaseRequest(`${TABLE}?select=${PUBLIC_COLUMNS}`, {
        method: "POST",
        body: JSON.stringify(row),
      });

      return res.status(201).json({ ok: true, note: created[0], edit_token: editToken });
    }

    if (req.method === "PATCH") {
      const body = await readJson(req);
      const user = await getAuthUser(req);
      const id = cleanId(body.id);
      const editToken = String(body.edit_token || "").trim();
      if (!id || (!editToken && !user)) {
        return res.status(400).json({ ok: false, message: "id and edit permission are required." });
      }

      const row = normalizeNoteBody(body, { updated_at: new Date().toISOString() });
      delete row.id;
      delete row.edit_token;

      if (Object.prototype.hasOwnProperty.call(body, "password")) {
        Object.assign(row, passwordPayload(body.password));
      }

      const permissionFilter = user
        ? `owner_user_id=eq.${encodeURIComponent(user.id)}`
        : `edit_token=eq.${encodeURIComponent(editToken)}`;
      const updated = await supabaseRequest(`${TABLE}?id=eq.${encodeURIComponent(id)}&${permissionFilter}&select=${PUBLIC_COLUMNS}`, {
        method: "PATCH",
        body: JSON.stringify(row),
      });

      if (!updated.length) return res.status(403).json({ ok: false, message: "No edit permission or note not found." });
      return res.status(200).json({ ok: true, note: updated[0] });
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
  if (!response.ok) {
    throw new Error(data?.message || data?.hint || `Supabase error: ${response.status}`);
  }
  return Array.isArray(data) ? data : [];
}

async function getAuthUser(req) {
  const auth = String(req.headers.authorization || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const token = match[1].trim();
  if (!token) return null;

  const base = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const response = await fetch(`${base}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${token}`,
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

function normalizeNoteBody(body, extra) {
  return {
    ...extra,
    address: clamp(body.address, 500),
    road: clamp(body.road, 500),
    jibun: clamp(body.jibun, 500),
    floor: clamp(body.floor, 80),
    ho: clamp(body.ho, 80),
    memo: clamp(body.memo, 4000),
    result: body.result && typeof body.result === "object" ? body.result : null,
  };
}

function passwordPayload(password) {
  const clean = String(password || "");
  if (!clean) {
    return {
      has_password: false,
      password_hash: null,
      password_salt: null,
    };
  }

  const salt = makeId(18);
  return {
    has_password: true,
    password_hash: hashPassword(clean, salt),
    password_salt: salt,
  };
}

function verifyPassword(password, salt, expectedHash) {
  if (!password || !salt || !expectedHash) return false;
  const actual = hashPassword(String(password), String(salt));
  const left = Buffer.from(actual);
  const right = Buffer.from(String(expectedHash));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 64).toString("hex");
}

function publicNote(row, options = {}) {
  const locked = !!options.locked;
  return {
    id: row.id,
    address: row.address,
    road: row.road,
    jibun: row.jibun,
    floor: row.floor,
    ho: row.ho,
    memo: locked ? "" : row.memo,
    result: locked ? null : row.result,
    has_password: !!row.has_password,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
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
