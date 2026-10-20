import { store, configured, send } from "./_store.js";
// GET /api/availability -> { taken: ["2026-10-26_0930", ...] }  (no personal data)
export default async function handler(req, res) {
  if (!configured()) return send(res, 503, { error: "Booking storage is not set up yet." });
  try {
    const paths = await store.list("slots/");
    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    const taken = paths.map(p => p.slice(6).replace(/\.json$/, "")).filter(id => id.slice(0, 10) >= today);
    send(res, 200, { taken });
  } catch (e) { send(res, 500, { error: "Could not load availability." }); }
}
