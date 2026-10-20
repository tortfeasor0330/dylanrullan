// Sends an event to a GoHighLevel "Inbound Webhook" workflow trigger.
// Never throws: a webhook problem must not block a booking or order.
export async function notify(url, payload) {
  if (!url) return { sent: false, reason: "no url" };
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: ctrl.signal });
    clearTimeout(t);
    return { sent: r.ok, status: r.status };
  } catch (e) { return { sent: false, reason: String(e && e.message || e) }; }
}
// Philippine numbers to +63 format so GoHighLevel matches SMS/WhatsApp contacts.
export function phoneE164(p) {
  const d = String(p || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (/^09\d{9}$/.test(d)) return "+63" + d.slice(1);
  if (/^639\d{9}$/.test(d)) return "+" + d;
  return d;
}
export function splitName(n) { const p = String(n || "").trim().split(/\s+/); return { first: p[0] || "", last: p.slice(1).join(" ") }; }
const TYPE = { initial: "Initial consultation", followup: "Follow-up", discovery: "Discovery call" };
const STATUS = { pending_verification: "Payment under review", confirmed: "Confirmed", payment_issue: "Payment issue", cancelled: "Cancelled" };
const DUR = { initial: 30, followup: 30, discovery: 15 };
export function bookingPayload(event, r, req) {
  const host = req && req.headers && (req.headers["x-forwarded-host"] || req.headers.host);
  const [h, m] = r.time.split(":").map(Number);
  const start = new Date(Date.UTC(...r.date.split("-").map((v, i) => i === 1 ? v - 1 : +v), h - 8, m));
  const nm = splitName(r.name);
  return {
    event, ref: r.ref, status: r.status, status_label: STATUS[r.status] || r.status,
    first_name: nm.first, last_name: nm.last, full_name: r.name, email: r.email, phone: phoneE164(r.phone), date_of_birth: r.dob || "",
    appointment_type: r.type, appointment_type_label: TYPE[r.type] || r.type, duration_min: DUR[r.type] || 30,
    format: r.mode === "online" ? "Online" : "Face-to-face", video_platform: r.platform || "",
    date: r.date, time: r.time,
    date_label: start.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }),
    time_label: start.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }) + " PHT",
    start_iso: start.toISOString(), timezone: "Asia/Manila",
    concern: r.concern || "", notes: r.notes || "",
    fee: r.fee, currency: "PHP", payment_method: r.payment ? r.payment.method : "", payment_ref: r.payment ? r.payment.refNo || "" : "",
    has_payment_screenshot: !!(r.payment && r.payment.screenshot),
    admin_url: host ? `https://${host}/admin` : "", source: "Dr. Rullan website", created_at: r.createdAt, updated_at: r.updatedAt || r.createdAt
  };
}
