const TABLE = "area_notes";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    assertSupabaseEnv();

    if (req.method === "GET") {
      const id = cleanId(req.query.id);
      if (!id) return res.status(400).json({ ok: false, message: "id가 필요합니다." });

      const note = await supabaseRequest(`${TABLE}?id=eq.${encodeURIComponent(id)}&select=id,address,road,jibun,floor,ho,memo,result,created_at,updated_at`, {
        method: "GET",
      });

      if (!note.length) return res.status(404).json({ ok: false, message: "메모를 찾지 못했습니다." });
      return res.status(200).json({ ok: true, note: note[0] });
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const id = makeId(10);
      const editToken = makeId(28);
      const row = normalizeNoteBody(body, { id, edit_token: editToken });

      const created = await supabaseRequest(`${TABLE}?select=id,address,road,jibun,floor,ho,memo,result,created_at,updated_at`, {
        method: "POST",
        body: JSON.stringify(row),
      });

      return res.status(201).json({ ok: true, note: created[0], edit_token: editToken });
    }

    if (req.method === "PATCH") {
      const body = await readJson(req);
      const id = cleanId(body.id);
      const editToken = String(body.edit_token || "").trim();
      if (!id || !editToken) {
        return res.status(400).json({ ok: false, message: "id와 edit_token이 필요합니다." });
      }

      const row = normalizeNoteBody(body, { updated_at: new Date().toISOString() });
      delete row.id;
      delete row.edit_token;

      const updated = await supabaseRequest(`${TABLE}?id=eq.${encodeURIComponent(id)}&edit_token=eq.${encodeURIComponent(editToken)}&select=id,address,road,jibun,floor,ho,memo,result,created_at,updated_at`, {
        method: "PATCH",
        body: JSON.stringify(row),
      });

      if (!updated.length) return res.status(403).json({ ok: false, message: "수정 권한이 없거나 메모를 찾지 못했습니다." });
      return res.status(200).json({ ok: true, note: updated[0] });
    }

    return res.status(405).json({ ok: false, message: "지원하지 않는 요청입니다." });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || String(error) });
  }
};

function assertSupabaseEnv() {
  if (!process.env.SUPABASE_URL) throw new Error("SUPABASE_URL 환경변수가 없습니다.");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
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
        reject(new Error("요청 본문이 너무 큽니다."));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("JSON 본문을 읽지 못했습니다."));
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
