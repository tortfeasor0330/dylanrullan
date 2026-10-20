import { timingSafeEqual } from "node:crypto";
import { store, configured, send } from "./_store.js";
// Clinic-only endpoint. Header "x-admin-key" must equal the ADMIN_KEY environment variable.
function authed(req) {
  const want = process.env.ADMIN_KEY || "", got = String(req.headers["x-admin-key"] || "");
  if (!want || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
export default async function handler(req, res) {
  if (!configured()) return send(res, 503, { error: "Booking storage is not set up yet." });
  if (!process.env.ADMIN_KEY) return send(res, 503, { error: "Set the ADMIN_KEY environment variable in Vercel first." });
  if (!authed(req)) return send(res, 401, { error: "Wrong password." });
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && url.searchParams.get("file")) {
      const p = url.searchParams.get("file");
      if (!p.startsWith("payments/")) return send(res, 400, { error: "Bad file." });
      const f = await store.getFile(p);
      if (!f) return send(res, 404, { error: "Not found." });
      res.statusCode = 200; res.setHeader("Content-Type", f.type); res.setHeader("Cache-Control", "private, no-store"); return res.end(f.body);
    }
    if (req.method === "GET") {
      const paths = await store.list("bookings/");
      const rows = (await Promise.all(paths.map(p => store.getJSON(p).catch(() => null)))).filter(Boolean);
      rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      return send(res, 200, { bookings: rows });
    }
    if (req.method === "POST") {
      const { action, ref } = req.body || {};
      if (!/^DR-[\w-]+$/.test(String(ref || ""))) return send(res, 400, { error: "Bad reference." });
      const path = `bookings/${ref}.json`;
      const rec = await store.getJSON(path);
      if (!rec) return send(res, 404, { error: "Booking not found." });
      if (action === "verify") rec.status = "confirmed";
      else if (action === "reject") rec.status = "payment_issue";
      else if (action === "cancel") { rec.status = "cancelled"; try { await store.del(`slots/${rec.id}.json`); } catch {} }
      else return send(res, 400, { error: "Unknown action." });
      rec.updatedAt = new Date().toISOString();
      await store.putJSON(path, rec, { overwrite: true });
      return send(res, 200, { ok: true, status: rec.status });
    }
    send(res, 405, { error: "Method not allowed." });
  } catch (e) { send(res, 500, { error: "Something went wrong reading bookings." }); }
}
