const crypto = require("crypto");

const POSTS_TABLE = "board_posts";
const COMMENTS_TABLE = "board_comments";
const PROFILES_TABLE = "user_profiles";
const POST_COLUMNS = "id,author_user_id,title,body,status,created_at,updated_at";
const COMMENT_COLUMNS = "id,post_id,author_user_id,body,status,created_at,updated_at";
const PROFILE_COLUMNS = "user_id,email,display_name,company_name";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    assertSupabaseEnv();
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ ok: false, message: "게시판은 로그인이 필요합니다." });
    const viewerIsAdmin = isBoardAdmin(user);

    if (req.method === "GET") {
      if (String(req.query.detail || "") === "1") {
        const postId = cleanId(req.query.post_id);
        if (!postId) return res.status(400).json({ ok: false, message: "글 ID가 필요합니다." });

        const posts = await supabaseRequest(`${POSTS_TABLE}?id=eq.${encodeURIComponent(postId)}&status=eq.active&select=${POST_COLUMNS}&limit=1`, { method: "GET" });
        if (!posts.length) return res.status(404).json({ ok: false, message: "글을 찾을 수 없습니다." });

        const comments = await supabaseRequest(`${COMMENTS_TABLE}?post_id=eq.${encodeURIComponent(postId)}&status=eq.active&select=${COMMENT_COLUMNS}&order=created_at.asc&limit=200`, { method: "GET" });
        const enrichedPosts = await attachAuthors(posts);
        const enrichedComments = await attachAuthors(comments);
        return res.status(200).json({ ok: true, viewer_user_id: user.id, viewer_is_admin: viewerIsAdmin, post: enrichedPosts[0], comments: enrichedComments });
      }

      const posts = await supabaseRequest(`${POSTS_TABLE}?status=eq.active&select=${POST_COLUMNS}&order=updated_at.desc&limit=100`, { method: "GET" });
      const withAuthors = await attachAuthors(await attachCommentCounts(posts));
      return res.status(200).json({ ok: true, viewer_user_id: user.id, viewer_is_admin: viewerIsAdmin, posts: withAuthors });
    }

    if (req.method === "POST") {
      const body = await readJson(req);

      if (body.action === "comment") {
        const postId = cleanId(body.post_id);
        if (!postId) return res.status(400).json({ ok: false, message: "글 ID가 필요합니다." });

        const parent = await supabaseRequest(`${POSTS_TABLE}?id=eq.${encodeURIComponent(postId)}&status=eq.active&select=id&limit=1`, { method: "GET" });
        if (!parent.length) return res.status(404).json({ ok: false, message: "글을 찾을 수 없습니다." });

        const row = {
          id: makeId(12),
          post_id: postId,
          author_user_id: user.id,
          body: clamp(body.body, 2000),
          status: "active",
        };
        if (!row.body) return res.status(400).json({ ok: false, message: "댓글 내용을 입력해주세요." });

        const created = await supabaseRequest(`${COMMENTS_TABLE}?select=${COMMENT_COLUMNS}`, { method: "POST", body: JSON.stringify(row) });
        await supabaseRequest(`${POSTS_TABLE}?id=eq.${encodeURIComponent(postId)}&select=${POST_COLUMNS}`, {
          method: "PATCH",
          body: JSON.stringify({ updated_at: new Date().toISOString() }),
        });
        const comments = await attachAuthors(created);
        return res.status(201).json({ ok: true, comment: comments[0] });
      }

      const row = {
        id: makeId(12),
        author_user_id: user.id,
        title: clamp(body.title, 120),
        body: clamp(body.body, 5000),
        status: "active",
      };
      if (!row.title || !row.body) return res.status(400).json({ ok: false, message: "제목과 내용을 입력해주세요." });

      const created = await supabaseRequest(`${POSTS_TABLE}?select=${POST_COLUMNS}`, { method: "POST", body: JSON.stringify(row) });
      const posts = await attachAuthors(created);
      return res.status(201).json({ ok: true, post: posts[0] });
    }

    if (req.method === "PATCH") {
      const body = await readJson(req);

      if (body.action === "delete_comment") {
        const commentId = cleanId(body.comment_id);
        if (!commentId) return res.status(400).json({ ok: false, message: "\uB313\uAE00 ID\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4." });

        const comments = await supabaseRequest(COMMENTS_TABLE + "?id=eq." + encodeURIComponent(commentId) + "&status=eq.active&select=" + COMMENT_COLUMNS + "&limit=1", { method: "GET" });
        if (!comments.length) return res.status(404).json({ ok: false, message: "\uB313\uAE00\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." });

        const comment = comments[0];
        const canDeleteComment = viewerIsAdmin || comment.author_user_id === user.id;
        if (!canDeleteComment) return res.status(403).json({ ok: false, message: "\uAD00\uB9AC\uC790\uB098 \uC791\uC131\uC790\uB9CC \uB313\uAE00\uC744 \uC0AD\uC81C\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." });

        const updated = await supabaseRequest(COMMENTS_TABLE + "?id=eq." + encodeURIComponent(commentId) + "&select=" + COMMENT_COLUMNS, {
          method: "PATCH",
          body: JSON.stringify({ status: "deleted", updated_at: new Date().toISOString() }),
        });
        return res.status(200).json({ ok: true, comment: updated[0] });
      }

      const postId = cleanId(body.post_id);
      if (!postId) return res.status(400).json({ ok: false, message: "\uAE00 ID\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4." });

      const posts = await supabaseRequest(POSTS_TABLE + "?id=eq." + encodeURIComponent(postId) + "&status=eq.active&select=" + POST_COLUMNS + "&limit=1", { method: "GET" });
      if (!posts.length) return res.status(404).json({ ok: false, message: "\uAE00\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." });

      const post = posts[0];
      const isOwner = post.author_user_id === user.id;

      if (body.action === "delete") {
        if (!isOwner && !viewerIsAdmin) return res.status(403).json({ ok: false, message: "\uAD00\uB9AC\uC790\uB098 \uC791\uC131\uC790\uB9CC \uAE00\uC744 \uC0AD\uC81C\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." });
        const updated = await supabaseRequest(POSTS_TABLE + "?id=eq." + encodeURIComponent(postId) + "&select=" + POST_COLUMNS, {
          method: "PATCH",
          body: JSON.stringify({ status: "deleted", updated_at: new Date().toISOString() }),
        });
        return res.status(200).json({ ok: true, post: updated[0] });
      }

      if (!isOwner) return res.status(403).json({ ok: false, message: "\uC791\uC131\uC790\uB9CC \uC218\uC815\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." });

      const row = {
        title: clamp(body.title, 120),
        body: clamp(body.body, 5000),
        updated_at: new Date().toISOString(),
      };
      if (!row.title || !row.body) return res.status(400).json({ ok: false, message: "\uC81C\uBAA9\uACFC \uB0B4\uC6A9\uC744 \uC785\uB825\uD574\uC8FC\uC138\uC694." });

      const updated = await supabaseRequest(POSTS_TABLE + "?id=eq." + encodeURIComponent(postId) + "&select=" + POST_COLUMNS, { method: "PATCH", body: JSON.stringify(row) });
      const enriched = await attachAuthors(updated);
      return res.status(200).json({ ok: true, post: enriched[0] });
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

function envList(name) {
  return String(process.env[name] || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isBoardAdmin(user) {
  if (!user) return false;
  const emails = envList("BOARD_ADMIN_EMAILS");
  const ids = envList("BOARD_ADMIN_USER_IDS");
  const email = String(user.email || "").trim().toLowerCase();
  const id = String(user.id || "").trim().toLowerCase();
  return (!!email && emails.includes(email)) || (!!id && ids.includes(id));
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

async function attachCommentCounts(posts) {
  if (!posts.length) return posts;
  const ids = posts.map((post) => post.id).filter(Boolean);
  if (!ids.length) return posts;

  const filter = ids.map((id) => encodeURIComponent(id)).join(",");
  const comments = await supabaseRequest(`${COMMENTS_TABLE}?post_id=in.(${filter})&status=eq.active&select=post_id`, { method: "GET" });
  const counts = new Map();
  for (const comment of comments) counts.set(comment.post_id, (counts.get(comment.post_id) || 0) + 1);
  return posts.map((post) => ({ ...post, comment_count: counts.get(post.id) || 0 }));
}

async function attachAuthors(rows) {
  if (!rows.length) return rows;
  const userIds = [...new Set(rows.map((row) => row.author_user_id).filter(Boolean))];
  const profiles = await getProfiles(userIds);
  const authPairs = await Promise.all(userIds.map(async (id) => [id, await getAuthUserSummary(id)]));
  const authUsers = new Map(authPairs);

  return rows.map((row) => {
    const profile = profiles.get(row.author_user_id) || {};
    const auth = authUsers.get(row.author_user_id) || {};
    return {
      ...row,
      author_name: profile.display_name || profile.company_name || auth.email || "익명 사용자",
      author_email: auth.email || profile.email || "",
    };
  });
}

async function getProfiles(userIds) {
  const profiles = new Map();
  if (!userIds.length) return profiles;
  const filter = userIds.map((id) => encodeURIComponent(id)).join(",");
  try {
    const rows = await supabaseRequest(`${PROFILES_TABLE}?user_id=in.(${filter})&select=${PROFILE_COLUMNS}`, { method: "GET" });
    for (const row of rows) profiles.set(row.user_id, row);
  } catch (error) {
    const msg = String(error?.message || error || "");
    if (!msg.includes("does not exist") && !msg.includes("schema cache")) throw error;
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
  if (!response.ok) return { email: "" };
  const user = await response.json();
  return { email: user?.email || "" };
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
    return "게시판 테이블이 아직 준비되지 않았습니다. board-schema.sql을 Supabase SQL Editor에서 실행해주세요.";
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
