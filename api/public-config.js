module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, message: "Method not allowed." });

  return res.status(200).json({
    ok: true,
    adsense: {
      client: cleanAdsenseClient(process.env.GOOGLE_ADSENSE_CLIENT),
      topSlot: cleanAdSlot(process.env.GOOGLE_ADSENSE_SLOT_TOP),
    },
  });
};

function cleanAdsenseClient(value) {
  const text = String(value || "").trim();
  return /^ca-pub-\d{12,24}$/.test(text) ? text : "";
}

function cleanAdSlot(value) {
  const text = String(value || "").trim();
  return /^\d{6,24}$/.test(text) ? text : "";
}
