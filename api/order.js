import { store, configured, send } from "./_store.js";
import { notify, phoneE164, splitName } from "./_ghl.js";
const s = (v, n = 200) => String(v ?? "").trim().slice(0, n);
// POST /api/order  { order: { items:[{id,name,q,price}], subtotal, shipping, name, phone, email, addr, pay, notes } }
// Saves the order (when storage is set up) and sends it to the GoHighLevel order webhook.
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const o = (req.body && req.body.order) || {};
  const items = Array.isArray(o.items) ? o.items.slice(0, 30).map(i => ({ id: s(i.id, 30), name: s(i.name, 80), q: Math.max(1, Math.min(99, parseInt(i.q) || 1)), price: Math.max(0, Number(i.price) || 0) })) : [];
  const errs = [];
  if (!items.length) errs.push("items");
  if (s(o.name).length < 2) errs.push("name");
  if (s(o.phone).replace(/\D/g, "").length < 7) errs.push("mobile");
  if (s(o.addr).length < 5) errs.push("address");
  if (o.email && !/^\S+@\S+\.\S+$/.test(s(o.email))) errs.push("email");
  if (errs.length) return send(res, 400, { error: "Please check: " + errs.join(", ") + "." });
  const subtotal = items.reduce((t, i) => t + i.price * i.q, 0), shipping = Math.max(0, Number(o.shipping) || 0);
  const d = new Date(Date.now() + 8 * 3600e3);
  const ref = "TOH-" + d.toISOString().slice(2, 10).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  const createdAt = new Date().toISOString();
  const record = { ref, status: "new", items, subtotal, shipping, total: subtotal + shipping, name: s(o.name, 120), phone: s(o.phone, 40), email: s(o.email, 160), addr: s(o.addr, 300), pay: s(o.pay, 40), notes: s(o.notes, 1000), createdAt };
  let saved = false;
  if (configured()) { try { await store.putJSON(`orders/${ref}.json`, record); saved = true; } catch {} }
  const nm = splitName(record.name);
  const hook = await notify(process.env.GHL_ORDER_WEBHOOK_URL, {
    event: "order.created", ref, status: "new",
    first_name: nm.first, last_name: nm.last, full_name: record.name, email: record.email, phone: phoneE164(record.phone),
    address: record.addr, payment_method: record.pay, notes: record.notes,
    items_summary: items.map(i => `${i.q} × ${i.name}`).join(", "), item_count: items.reduce((t, i) => t + i.q, 0),
    subtotal, shipping, total: subtotal + shipping, currency: "PHP", items,
    source: "Dr. Rullan shop", created_at: createdAt
  });
  if (!saved && !hook.sent) return send(res, 503, { error: "Orders can't be received online right now." });
  send(res, 200, { ok: true, ref });
}
