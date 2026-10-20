import { store, configured, send } from "./_store.js";
import { notify, bookingPayload } from "./_ghl.js";
const TYPES = { initial: 500, followup: 500, discovery: 0 };
const s = (v, n = 200) => String(v ?? "").trim().slice(0, n);
// POST /api/book  { booking:{...}, payment:{ method, refNo, screenshot:"data:image/jpeg;base64,..." } }
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  if (!configured()) return send(res, 503, { error: "Booking storage is not set up yet." });
  const { booking: b = {}, payment: p = {} } = req.body || {};
  const date = s(b.date, 10), time = s(b.time, 5), mode = s(b.mode, 10), type = s(b.type, 12);
  const errs = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errs.push("date");
  if (!/^\d{2}:(00|30)$/.test(time)) errs.push("time");
  if (!["clinic", "online"].includes(mode)) errs.push("mode");
  if (!(type in TYPES)) errs.push("type");
  if (s(b.name).length < 2) errs.push("name");
  if (!/^\S+@\S+\.\S+$/.test(s(b.email))) errs.push("email");
  if (s(b.phone).replace(/\D/g, "").length < 7) errs.push("phone");
  const fee = TYPES[type] ?? 0;
  let shot = null;
  if (fee > 0) {
    if (!["GCash", "Maya"].includes(p.method)) errs.push("payment method");
    const m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(p.screenshot || ""));
    if (!m) errs.push("payment screenshot");
    else { shot = { type: m[1], ext: m[2] === "jpeg" ? "jpg" : m[2], buf: Buffer.from(m[3], "base64") }; if (shot.buf.length > 3.5e6) errs.push("screenshot too large"); }
  }
  if (errs.length) return send(res, 400, { error: "Please check: " + errs.join(", ") + "." });
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  if (date <= today) return send(res, 400, { error: "Please choose a date from tomorrow onward." });

  const id = `${date}_${time.replace(":", "")}`;
  const ref = `DR-${date.replace(/-/g, "").slice(2)}-${time.replace(":", "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const createdAt = new Date().toISOString();
  const slotPath = `slots/${id}.json`;
  if (await store.exists(slotPath)) return send(res, 409, { error: "That time was just booked. Please choose another slot." });
  try { await store.putJSON(slotPath, { ref, date, time, mode, createdAt }); }
  catch (e) { return e.exists ? send(res, 409, { error: "That time was just booked. Please choose another slot." }) : send(res, 500, { error: "Could not reserve the slot. Please try again." }); }
  try {
    const screenshot = shot ? await store.putFile(`payments/${ref}.${shot.ext}`, shot.buf, shot.type) : null;
    const record = {
      ref, id, date, time, mode, type, fee, status: fee > 0 ? "pending_verification" : "confirmed",
      concern: s(b.concern, 80), name: s(b.name, 120), email: s(b.email, 160), phone: s(b.phone, 40), dob: s(b.dob, 10),
      platform: mode === "online" ? s(b.platform, 40) : "", notes: s(b.notes, 1500),
      payment: fee > 0 ? { method: p.method, refNo: s(p.refNo, 60), screenshot } : null, createdAt
    };
    await store.putJSON(`bookings/${ref}.json`, record);
    await notify(process.env.GHL_BOOKING_WEBHOOK_URL, bookingPayload("booking.created", record, req));
    send(res, 200, { ok: true, ref, status: record.status });
  } catch (e) {
    try { await store.del(slotPath); } catch {}
    send(res, 500, { error: "Could not save the booking. Please try again." });
  }
}
