// Direct GoHighLevel (LeadConnector) API v2 connection: contacts, calendar and media storage.
// Turned on when GHL_API_TOKEN, GHL_LOCATION_ID and GHL_CALENDAR_ID are set in Vercel.
// Every function here is best-effort: a GoHighLevel problem must never block a booking or order.
import { phoneE164, splitName } from "./_ghl.js";

const BASE = (process.env.GHL_API_BASE || "https://services.leadconnectorhq.com").replace(/\/$/, ""); // override only for local tests
const V_CONTACTS = "2021-07-28", V_CAL = "2021-04-15", V_MEDIA = "2021-07-28";
const env = k => (process.env[k] || "").trim();
export const ghlEnabled = () => !!(env("GHL_API_TOKEN") && env("GHL_LOCATION_ID") && env("GHL_CALENDAR_ID"));
export const ghlContactsEnabled = () => !!(env("GHL_API_TOKEN") && env("GHL_LOCATION_ID"));

const TYPE = { initial: "Basic Health Consultation", comprehensive: "Comprehensive Wellness Assessment", followup: "Follow-up" };
const DUR = { initial: 30, comprehensive: 30, followup: 30 };
const APPT_STATUS = { pending_verification: "new", confirmed: "confirmed", payment_issue: "new", cancelled: "cancelled" };

async function call(method, path, { version, json, form, query, timeout = 8000 } = {}) {
  const url = new URL(BASE + path);
  if (query) Object.entries(query).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)));
  const headers = { Authorization: `Bearer ${env("GHL_API_TOKEN")}`, Version: version, Accept: "application/json" };
  let body;
  if (json) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  else if (form) body = form;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { method, headers, body, signal: ctrl.signal });
    const text = await r.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
    if (!r.ok) { const e = new Error(`GHL ${method} ${path} → ${r.status} ${(data && (data.message || data.error)) || ""}`.trim()); e.status = r.status; throw e; }
    return data;
  } finally { clearTimeout(t); }
}

// PHT wall-clock "YYYY-MM-DD" + "HH:MM" → Date
function phtToDate(date, time) { const [y, m, d] = date.split("-").map(Number), [h, mi] = time.split(":").map(Number); return new Date(Date.UTC(y, m - 1, d, h - 8, mi)); }
const isoPHT = dt => new Date(dt.getTime() + 8 * 3600e3).toISOString().slice(0, 19) + "+08:00";
const slotIdOf = dt => { const p = new Date(dt.getTime() + 8 * 3600e3).toISOString(); return `${p.slice(0, 10)}_${p.slice(11, 13)}${p.slice(14, 16)}`; };
const toDate = v => { if (v == null) return null; if (typeof v === "object") v = v.$date || v.date || v.dateTime || v.iso || JSON.stringify(v); const d = new Date(typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v); return isNaN(d) ? null : d; };

/* ---------- Contacts ---------- */
export async function upsertContact({ name, email, phone, dob, address, source, customFields }) {
  const nm = splitName(name);
  const body = { locationId: env("GHL_LOCATION_ID"), firstName: nm.first, lastName: nm.last, name, email: email || undefined, phone: phoneE164(phone) || undefined, source: source || "Dr. Rullan website" };
  if (dob && /^\d{4}-\d{2}-\d{2}$/.test(dob)) body.dateOfBirth = dob;
  if (address) body.address1 = address;
  if (customFields && customFields.length) body.customFields = customFields;
  const r = await call("POST", "/contacts/upsert", { version: V_CONTACTS, json: body });
  return { id: r && r.contact && r.contact.id, isNew: !!(r && r.new) };
}
// Adds tags without removing the contact's existing ones (upsert would overwrite them).
export const addTags = (contactId, tags) => call("POST", `/contacts/${contactId}/tags`, { version: V_CONTACTS, json: { tags } });
export const addNote = (contactId, body) => call("POST", `/contacts/${contactId}/notes`, { version: V_CONTACTS, json: { body: body.slice(0, 5000) } });

/* ---------- Media storage ---------- */
export async function uploadMedia(buf, mime, name) {
  const form = new FormData();
  form.append("file", new Blob([buf], { type: mime }), name);
  form.append("name", name);
  form.append("hosted", "false");
  if (env("GHL_MEDIA_FOLDER_ID")) form.append("parentId", env("GHL_MEDIA_FOLDER_ID"));
  const r = await call("POST", "/medias/upload-file", { version: V_MEDIA, form, timeout: 15000 });
  return { id: r && (r.fileId || r._id || r.id), url: r && r.url };
}

/* ---------- Calendar ---------- */
function calendarFor(mode) { return (mode === "online" && env("GHL_CALENDAR_ID_ONLINE")) || env("GHL_CALENDAR_ID"); }
export async function createAppointment(rec, contactId, extra = "") {
  const start = phtToDate(rec.date, rec.time), end = new Date(start.getTime() + (DUR[rec.type] || 30) * 60e3);
  const where = rec.mode === "online" ? `Online video call${rec.platform ? " · " + rec.platform : ""}` : (env("GHL_CLINIC_ADDRESS") || "Face-to-face at the clinic");
  const body = {
    calendarId: calendarFor(rec.mode), locationId: env("GHL_LOCATION_ID"), contactId,
    startTime: isoPHT(start), endTime: isoPHT(end),
    title: `${TYPE[rec.type] || rec.type} · ${rec.mode === "online" ? "Online" : "Face-to-face"} · ${rec.name}`,
    appointmentStatus: APPT_STATUS[rec.status] || "new",
    meetingLocationType: "custom", overrideLocationConfig: true, address: where,
    description: `Ref ${rec.ref}\nConcern: ${rec.concern || "-"}\nFee: ₱${rec.fee}${rec.payment ? ` via ${rec.payment.method}` : ""}${extra ? "\n" + extra : ""}${rec.notes ? "\nPatient notes: " + rec.notes : ""}`,
    // The website already checks its own hours and double bookings, so GHL's slot rules are skipped.
    ignoreFreeSlotValidation: true, ignoreDateRange: true, toNotify: true
  };
  if (env("GHL_ASSIGNED_USER_ID")) body.assignedUserId = env("GHL_ASSIGNED_USER_ID");
  const r = await call("POST", "/calendars/events/appointments", { version: V_CAL, json: body });
  return { id: r && (r.id || (r.event && r.event.id)) };
}
export const updateAppointmentStatus = (id, status) =>
  call("PUT", `/calendars/events/appointments/${id}`, { version: V_CAL, json: { appointmentStatus: APPT_STATUS[status] || "new", ignoreFreeSlotValidation: true } });

// Website slot ids ("2026-11-03_0930") that are busy on the GHL calendar(s): appointments and blocked time.
export async function busySlots(fromMs, toMs) {
  const loc = env("GHL_LOCATION_ID");
  const cals = [...new Set([env("GHL_CALENDAR_ID"), env("GHL_CALENDAR_ID_ONLINE")].filter(Boolean))];
  const jobs = [];
  for (const calendarId of cals) {
    jobs.push(call("GET", "/calendars/events", { version: V_CAL, query: { locationId: loc, calendarId, startTime: fromMs, endTime: toMs }, timeout: 6000 }));
    jobs.push(call("GET", "/calendars/blocked-slots", { version: V_CAL, query: { locationId: loc, calendarId, startTime: fromMs, endTime: toMs }, timeout: 6000 }));
  }
  const out = new Set();
  const results = await Promise.allSettled(jobs);
  if (results.every(r => r.status === "rejected")) throw results[0].reason;
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value) continue;
    for (const ev of r.value.events || []) {
      if (["cancelled", "invalid"].includes(String(ev.appointmentStatus || "").toLowerCase()) || ev.deleted) continue;
      const s = toDate(ev.startTime), e = toDate(ev.endTime);
      if (!s || !e || e <= s) continue;
      // every 30-minute website slot that overlaps the event
      let t = new Date(Math.floor(s.getTime() / 1800e3) * 1800e3);
      for (let i = 0; t < e && i < 96; i++, t = new Date(t.getTime() + 1800e3)) out.add(slotIdOf(t));
    }
  }
  return out;
}

/* ---------- One-call sync for a booking ---------- */
// Pushes the patient, payment screenshot and appointment to GHL. Returns what was created; never throws.
export async function syncBooking(rec, shot, adminUrl) {
  const g = { ...(rec.ghl || {}) }, errors = [];
  if (!ghlEnabled()) return { ...g, skipped: "GHL API not configured" };
  try {
    if (shot && !g.mediaUrl) {
      const m = await uploadMedia(shot.buf, shot.type, `${rec.ref}-payment-${(rec.payment && rec.payment.method || "").toLowerCase()}.${shot.ext}`);
      g.mediaId = m.id; g.mediaUrl = m.url;
    }
  } catch (e) { errors.push(String(e.message || e)); }
  try {
    if (!g.contactId) {
      const cf = [];
      if (g.mediaUrl && env("GHL_PAYMENT_FIELD_KEY")) cf.push({ key: env("GHL_PAYMENT_FIELD_KEY"), fieldValue: g.mediaUrl });
      const c = await upsertContact({ name: rec.name, email: rec.email, phone: rec.phone, dob: rec.dob, customFields: cf });
      g.contactId = c.id;
    }
  } catch (e) { errors.push(String(e.message || e)); }
  if (g.contactId) {
    const tags = ["website booking", TYPE[rec.type] || rec.type, rec.mode === "online" ? "online consult" : "face-to-face consult", rec.fee > 0 ? "payment under review" : "no payment"].map(t => t.toLowerCase());
    await addTags(g.contactId, tags).catch(e => errors.push(String(e.message || e)));
    if (!g.appointmentId) {
      try { g.appointmentId = (await createAppointment(rec, g.contactId, g.mediaUrl ? `Payment screenshot: ${g.mediaUrl}` : "")).id; }
      catch (e) { errors.push(String(e.message || e)); }
    }
    if (!g.noteAdded) {
      const lines = [
        `Website booking ${rec.ref}`,
        `${TYPE[rec.type] || rec.type} · ${rec.mode === "online" ? "Online" + (rec.platform ? " (" + rec.platform + ")" : "") : "Face-to-face"}`,
        `${rec.date} ${rec.time} PHT`,
        `Concern: ${rec.concern || "-"}`,
        rec.fee > 0 ? `Fee ₱${rec.fee} via ${rec.payment ? rec.payment.method : "-"}${rec.payment && rec.payment.refNo ? " · ref " + rec.payment.refNo : ""}` : "No fee",
        g.mediaUrl ? `Payment screenshot: ${g.mediaUrl}` : (rec.fee > 0 ? "Payment screenshot: see website admin" : ""),
        rec.notes ? `Patient notes: ${rec.notes}` : "",
        adminUrl ? `Verify payment: ${adminUrl}` : ""
      ].filter(Boolean);
      try { await addNote(g.contactId, lines.join("\n")); g.noteAdded = true; } catch (e) { errors.push(String(e.message || e)); }
    }
  }
  g.syncedAt = new Date().toISOString();
  g.errors = errors.length ? errors : undefined;
  if (errors.length) console.error("GHL sync", rec.ref, errors);
  return g;
}

// After an admin action: move the GHL appointment to the new status and log it on the contact.
export async function syncStatus(rec, label) {
  const g = { ...(rec.ghl || {}) }, errors = [];
  if (!ghlEnabled()) return g;
  if (g.appointmentId) await updateAppointmentStatus(g.appointmentId, rec.status).catch(e => errors.push(String(e.message || e)));
  if (g.contactId) {
    const swap = { confirmed: "payment verified", payment_issue: "payment issue", cancelled: "booking cancelled" }[rec.status];
    if (swap) {
      await addTags(g.contactId, [swap]).catch(e => errors.push(String(e.message || e)));
      await call("DELETE", `/contacts/${g.contactId}/tags`, { version: V_CONTACTS, json: { tags: ["payment under review"] } }).catch(() => {});
    }
    await addNote(g.contactId, `Booking ${rec.ref}: ${label}`).catch(e => errors.push(String(e.message || e)));
  }
  g.errors = errors.length ? errors : undefined;
  if (errors.length) console.error("GHL status", rec.ref, errors);
  return g;
}

export { phtToDate, slotIdOf };
