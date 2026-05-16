module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, message: "허용되지 않는 요청 방식입니다." });
  }

  return res.status(200).json({
    ok: true,
    kakaoMapJsKey: process.env.KAKAO_MAP_JS_KEY || "",
    supabaseUrl: cleanSupabaseUrl(process.env.SUPABASE_URL),
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  });
};

function cleanSupabaseUrl(value) {
  return String(value || "")
    .replace(/\\r\\n|\\n|\\r/g, "")
    .trim()
    .replace(/\/rest\/v1\/?$/, "")
    .replace(/\/+$/, "");
}

