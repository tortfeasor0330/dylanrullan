import { store, configured, send } from "./_store.js";
import { authed } from "./_auth.js";
import { notify, phoneE164, splitName } from "./_ghl.js";
import { ghlContactsEnabled, addTags, addNote } from "./_ghlapi.js";
// Shop orders database (admin only).
// GET  /api/orders                        -> { orders:[...] } newest first
// POST /api/orders { ref, action, tracking?, note? }  action: paid | packed | shipped | delivered | cancelled | note
export const STATUSES = ["new", "paid", "packed", "shipped", "delivered", "cancelled"];
const LABEL = { new: "New", paid: "Paid", packed: "Packed", shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled" };
const s = (v, n = 200) => String(v ?? "").trim().slice(0, n);
export default async function handler(req, res) {
  if (!configured()) return send(res, 503, { error: "Storage is not set up yet." });
  if (!process.env.ADMIN_KEY) return send(res, 503, { error: "Set the ADMIN_KEY environment variable in Vercel first." });
  if (!authed(req)) return send(res, 401, { error: "Wrong password." });
  try {
    if (req.method === "GET") {
      const paths = await store.list("orders/");
      const rows = (await Promise.all(paths.map(p => store.getJSON(p).catch(() => null)))).filter(Boolean);
      rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return send(res, 200, { orders: rows });
    }
    if (req.method === "POST") {
      const { ref, action } = req.body || {};
      if (!/^TOH-[\w-]+$/.test(String(ref || ""))) return send(res, 400, { error: "Bad order reference." });
      if (!STATUSES.includes(action) && action !== "note") return send(res, 400, { error: "Unknown action." });
      const path = `orders/${ref}.json`;
      const rec = await store.getJSON(path);
      if (!rec) return send(res, 404, { error: "Order not found." });
      const now = new Date().toISOString(), note = s(req.body.note, 500);
      rec.history = rec.history || [{ status: rec.status || "new", at: rec.createdAt }];
      if (action === "note") { if (!note) return send(res, 400, { error: "Write a note first." }); rec.history.push({ note, at: now }); }
      else {
        if (action === "shipped") rec.tracking = s(req.body.tracking, 120) || rec.tracking || "";
        rec.status = action; rec.history.push({ status: action, at: now, ...(note ? { note } : {}), ...(action === "shipped" && rec.tracking ? { tracking: rec.tracking } : {}) });
      }
      rec.updatedAt = now;
      await store.putJSON(path, rec, { overwrite: true });
      if (action !== "note") {
        if (rec.ghlContactId && ghlContactsEnabled()) {
          await addTags(rec.ghlContactId, [`order ${LABEL[action].toLowerCase()}`]).catch(() => {});
          await addNote(rec.ghlContactId, `Shop order ${rec.ref}: ${LABEL[action]}${rec.tracking && action === "shipped" ? " · tracking " + rec.tracking : ""}${note ? " · " + note : ""}`).catch(() => {});
        }
        const nm = splitName(rec.name);
        await notify(process.env.GHL_ORDER_WEBHOOK_URL, {
          event: "order." + action, ref: rec.ref, status: action, status_label: LABEL[action],
          first_name: nm.first, last_name: nm.last, full_name: rec.name, email: rec.email, phone: phoneE164(rec.phone),
          address: rec.addr, tracking: rec.tracking || "", total: rec.total, currency: "PHP",
          items_summary: (rec.items || []).map(i => `${i.q} × ${i.name}`).join(", "), ghl_contact_id: rec.ghlContactId || "", updated_at: now
        });
      }
      return send(res, 200, { ok: true, order: rec });
    }
    send(res, 405, { error: "Method not allowed." });
  } catch (e) { send(res, 500, { error: "Something went wrong with the orders database." }); }
}
