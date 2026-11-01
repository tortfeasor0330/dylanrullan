import { store, configured, send } from "./_store.js";
import { ghlEnabled, busySlots } from "./_ghlapi.js";
// GET /api/availability -> { taken: ["2026-10-26_0930", ...] }  (no personal data)
// Taken = slots booked on the website + appointments/blocked time on the GoHighLevel calendar.
export default async function handler(req, res) {
  if (!configured()) return send(res, 503, { error: "Booking storage is not set up yet." });
  try {
    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    const [paths, ghl] = await Promise.all([
      store.list("slots/"),
      ghlEnabled() ? busySlots(Date.now(), Date.now() + 47 * 864e5).catch(e => { console.error("GHL availability", String(e.message || e)); return new Set(); }) : new Set()
    ]);
    const taken = new Set(paths.map(p => p.slice(6).replace(/\.json$/, "")));
    ghl.forEach(id => taken.add(id));
    send(res, 200, { taken: [...taken].filter(id => id.slice(0, 10) >= today).sort() });
  } catch (e) { send(res, 500, { error: "Could not load availability." }); }
}
