// Vercel Serverless Function (Node 18+ has global fetch)
// Path: /api/track
export default async function handler(req, res) {
  try {
    const { awb = "", pincode = "", phone = "" } = req.query;

    // --- India validators ---
    const validAwb = v => /^\d{10,14}$/.test(String(v));
    const validPin = v => /^[1-9]\d{5}$/.test(String(v));
    const validPhone = v => /^[6-9]\d{9}$/.test(String(v).replace(/\D/g, ""));

    if (!validAwb(awb)) return res.status(400).json({ error: "Invalid AWB (10–14 digits)" });
    if (pincode && !validPin(pincode)) return res.status(400).json({ error: "Invalid pincode" });
    if (phone && !validPhone(phone)) return res.status(400).json({ error: "Invalid mobile" });

    // --- Config from env ---
    const BASE  = process.env.DELHIVERY_BASE || "https://staging-express.delhivery.com";
    const TOKEN = process.env.DELHIVERY_TOKEN;
    if (!TOKEN) return res.status(500).json({ error: "Server not configured" });

    // --- Call Delhivery (Pull) ---
    const url = `${BASE}/api/v1/packages/json/?token=${encodeURIComponent(TOKEN)}&waybill=${encodeURIComponent(awb)}`;
    const up = await fetch(url, { headers: { accept: "application/json" } });
    if (!up.ok) return res.status(502).json({ error: "Carrier upstream error", status: up.status });

    const payload = await up.json();

    // --- Map Delhivery -> UI schema (adjust when you see real payload) ---
    const pkg = payload?.Shipment || payload?.Package || payload?.Data || payload || {};
    const eventsRaw = pkg.Events || pkg.Scans || pkg.History || [];
    const events = eventsRaw.map(e => ({
      ts: e.time || e.ts || e.scan_time || e.date || e.created_at,
      title: e.status || e.scan || e.event || e.code || "Event",
      note: e.location || e.city || e.remark || e.notes || ""
    }));
    const status = pkg.Status || pkg.status || (events[0]?.title) || "In Transit";
    const progressMap = { "Picked up": 0.25, "In Transit": 0.5, "Arrived at destination facility": 0.7, "Out for Delivery": 0.9, "Delivered": 1 };
    const progress = progressMap[status] ?? (String(status).toLowerCase().includes("deliver") ? 1 : 0.6);

    const ui = {
      carrier: "Delhivery",
      awb: String(awb),
      status,
      progress,
      origin: pkg.origin || pkg.source || pkg.src || "",
      destination: pkg.destination || pkg.dest || "",
      service: pkg.service || "Surface Express",
      pieces: Number(pkg.pieces || pkg.pcs || 1),
      weight: pkg.weight ? `${pkg.weight} kg` : "",
      promised: pkg.promised || pkg.eta || "",
      events
    };

    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
    return res.status(200).json(ui);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
