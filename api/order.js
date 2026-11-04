import { store, configured, send } from "./_store.js";
import { notify, phoneE164, splitName } from "./_ghl.js";
import { ghlContactsEnabled, upsertContact, addTags, addNote } from "./_ghlapi.js";
const s = (v, n = 200) => String(v ?? "").trim().slice(0, n);
// Prices are set here, on the server, so a customer can't change them in the browser. Keep in step with SHOP in shop.html.
export const CATALOG = {
  fx: { name: "The Triangle of Health Nitro FX", price: 10500 },
  xtreme: { name: "The Triangle of Health Nitro Xtreme", price: 10500 },
  m3x: { name: "3-Month Triangle of Health Nitro Xtreme", price: 29900 },
  sunrise: { name: "Sunrise", price: 2650 },
  nitro: { name: "Nitro Xtreme", price: 1650 },
  sunset: { name: "Sunset", price: 1850 }
};
const FREE_SHIP_FROM = 5000, SHIPPING_FEE = 150;
// POST /api/order  { order: { items:[{id,name,q,price}], subtotal, shipping, name, phone, email, addr, pay, notes } }
// Saves the order (when storage is set up) and sends it to the GoHighLevel order webhook.
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const o = (req.body && req.body.order) || {};
  const items = (Array.isArray(o.items) ? o.items.slice(0, 30) : []).filter(i => CATALOG[s(i.id, 30)]).map(i => { const id = s(i.id, 30); return { id, name: CATALOG[id].name, q: Math.max(1, Math.min(99, parseInt(i.q) || 1)), price: CATALOG[id].price }; });
  const errs = [];
  if (!items.length) errs.push("items");
  if (s(o.name).length < 2) errs.push("name");
  if (s(o.phone).replace(/\D/g, "").length < 7) errs.push("mobile");
  if (s(o.addr).length < 5) errs.push("address");
  if (o.email && !/^\S+@\S+\.\S+$/.test(s(o.email))) errs.push("email");
  if (errs.length) return send(res, 400, { error: "Please check: " + errs.join(", ") + "." });
  const subtotal = items.reduce((t, i) => t + i.price * i.q, 0), shipping = subtotal >= FREE_SHIP_FROM ? 0 : SHIPPING_FEE;
  const d = new Date(Date.now() + 8 * 3600e3);
  const ref = "TOH-" + d.toISOString().slice(2, 10).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  const createdAt = new Date().toISOString();
  const record = { ref, status: "new", items, subtotal, shipping, total: subtotal + shipping, name: s(o.name, 120), phone: s(o.phone, 40), email: s(o.email, 160), addr: s(o.addr, 300), pay: ["GCash", "Bank transfer", "Cash on delivery"].includes(o.pay) ? o.pay : "GCash", notes: s(o.notes, 1000), tracking: "", history: [{ status: "new", at: createdAt }], createdAt };
  let saved = false;
  if (configured()) { try { await store.putJSON(`orders/${ref}.json`, record); saved = true; } catch {} }
  if (ghlContactsEnabled()) { // shop customer → GHL contact with the order as a note
    try {
      const c = await upsertContact({ name: record.name, email: record.email, phone: record.phone, address: record.addr, source: "Dr. Rullan shop" });
      if (c.id) {
        record.ghlContactId = c.id;
        await addTags(c.id, ["shop order", "triangle of health"]).catch(() => {});
        await addNote(c.id, [`Shop order ${ref}`, ...items.map(i => `${i.q} × ${i.name} (₱${i.price.toLocaleString("en-PH")})`), `Total ₱${(subtotal + shipping).toLocaleString("en-PH")}${shipping ? " incl. shipping" : ""}`, `Payment: ${record.pay || "-"}`, `Address: ${record.addr}`, record.notes ? `Notes: ${record.notes}` : ""].filter(Boolean).join("\n")).catch(() => {});
        if (saved) await store.putJSON(`orders/${ref}.json`, record, { overwrite: true }).catch(() => {});
      }
    } catch (e) { console.error("GHL order contact", String(e.message || e)); }
  }
  const nm = splitName(record.name);
  const hook = await notify(process.env.GHL_ORDER_WEBHOOK_URL, {
    event: "order.created", ref, status: "new",
    first_name: nm.first, last_name: nm.last, full_name: record.name, email: record.email, phone: phoneE164(record.phone),
    address: record.addr, payment_method: record.pay, notes: record.notes,
    items_summary: items.map(i => `${i.q} × ${i.name}`).join(", "), item_count: items.reduce((t, i) => t + i.q, 0),
    subtotal, shipping, total: subtotal + shipping, currency: "PHP", items,
    ghl_contact_id: record.ghlContactId || "", source: "Dr. Rullan shop", created_at: createdAt
  });
  if (!saved && !hook.sent && !record.ghlContactId) return send(res, 503, { error: "Orders can't be received online right now." });
  send(res, 200, { ok: true, ref, total: record.total });
}
