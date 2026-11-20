import { createHash } from "node:crypto";
import { store, configured, send } from "./_store.js";
import { authed } from "./_auth.js";
import { notify, phoneE164 } from "./_ghl.js";
import { ghlContactsEnabled, upsertContact, addTags, addNote } from "./_ghlapi.js";
import W from "../webinar.json" with { type: "json" };

// POST /api/webinar { first, last, email, phone, consent }  -> registers for the webinar in webinar.json
// GET  /api/webinar (admin key)                             -> { webinar, registrants:[...] }
// Each registration: saved in Vercel Blob, GHL contact + tags + note, GHL_WEBINAR_WEBHOOK_URL, and WebinarKit (when its API key is set).
const s = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const env = k => (process.env[k] || "").trim();
const pht = iso => new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) + " PHT";

async function webinarKit(reg) {
  const key = env("WEBINARKIT_API_KEY"), id = env("WEBINARKIT_WEBINAR_ID");
  if (!key || !id) return { skipped: true };
  const base = (env("WEBINARKIT_API_BASE") || "https://webinarkit.com/api").replace(/\/$/, "");
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(`${base}/webinar/registration/${encodeURIComponent(id)}`, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ email: reg.email, firstName: reg.first, lastName: reg.last, phoneNumber: phoneE164(reg.phone) || undefined, date: env("WEBINARKIT_DATE") || W.start })
    });
    const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 200) }; }
    if (!r.ok || (j.status && String(j.status).toUpperCase() !== "OK")) return { ok: false, error: `WebinarKit ${r.status} ${j.message || j.error || j.status || j.raw || ""}`.trim() };
    const joinUrl = j.registrantLink || j.joinLink || j.link || j.url || (j.registrant && (j.registrant.link || j.registrant.joinLink)) || "";
    return { ok: true, joinUrl: /^https:\/\//.test(joinUrl) ? joinUrl : "", registrationDate: j.registrationDate || "" };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
  finally { clearTimeout(t); }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    if (!configured()) return send(res, 503, { error: "Storage is not set up yet." });
    if (!process.env.ADMIN_KEY || !authed(req)) return send(res, 401, { error: "Wrong password." });
    const paths = await store.list(`webinar/${W.slug}/`);
    const rows = (await Promise.all(paths.map(p => store.getJSON(p).catch(() => null)))).filter(Boolean)
      .sort((a, b) => String(b.registeredAt).localeCompare(String(a.registeredAt)));
    return send(res, 200, { webinar: W, registrants: rows, webinarKitConfigured: !!(env("WEBINARKIT_API_KEY") && env("WEBINARKIT_WEBINAR_ID")) });
  }
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const b = req.body || {};
  const reg = { first: s(b.first, 60), last: s(b.last, 60), email: s(b.email, 160).toLowerCase(), phone: s(b.phone, 30), consent: b.consent === true };
  const errs = [];
  if (!reg.first || !reg.last) errs.push("name");
  if (!/^\S+@\S+\.\S+$/.test(reg.email)) errs.push("email");
  if (reg.phone.replace(/\D/g, "").length < 10) errs.push("mobile number");
  if (!reg.consent) errs.push("consent");
  if (errs.length) return send(res, 400, { error: "Please check your " + errs.join(", ") + "." });

  const now = new Date().toISOString();
  const name = `${reg.first} ${reg.last}`;
  const path = `webinar/${W.slug}/${createHash("sha256").update(reg.email).digest("hex").slice(0, 32)}.json`;
  let rec = null;
  if (configured()) rec = await store.getJSON(path).catch(() => null);
  rec = { ...(rec || {}), ...reg, name, webinar: W.slug, registeredAt: (rec && rec.registeredAt) || now, updatedAt: now, source: s(b.source, 80) || "webinar page" };

  const wk = await webinarKit(reg);
  if (!wk.skipped) rec.webinarKit = wk;

  if (ghlContactsEnabled()) {
    try {
      const c = await upsertContact({ name, email: reg.email, phone: reg.phone, source: `Webinar: ${W.title}` });
      if (c.id) {
        rec.ghlContactId = c.id;
        await addTags(c.id, ["webinar registrant", `webinar: ${W.title.toLowerCase()}`]).catch(() => {});
        await addNote(c.id, [`Registered for webinar "${W.title}"`, pht(W.start), wk.ok ? `WebinarKit: registered${wk.joinUrl ? " · " + wk.joinUrl : ""}` : wk.skipped ? "" : `WebinarKit: not registered (${wk.error})`].filter(Boolean).join("\n")).catch(() => {});
      }
    } catch (e) { rec.ghlError = String(e.message || e); console.error("GHL webinar", rec.ghlError); }
  }

  const hook = await notify(env("GHL_WEBINAR_WEBHOOK_URL"), {
    event: "webinar.registered", webinar: W.slug, webinar_title: W.title, webinar_start: W.start, webinar_start_label: pht(W.start),
    first_name: reg.first, last_name: reg.last, full_name: name, email: reg.email, phone: phoneE164(reg.phone),
    join_url: wk.joinUrl || "", webinarkit_registered: !!wk.ok, ghl_contact_id: rec.ghlContactId || "", registered_at: rec.registeredAt
  });

  let saved = false;
  if (configured()) { try { await store.putJSON(path, rec, { overwrite: true }); saved = true; } catch (e) { console.error("webinar save", String(e.message || e)); } }
  if (!saved && !rec.ghlContactId && !hook.sent && !wk.ok) return send(res, 503, { error: "Registration is not available right now. Please try again later." });
  send(res, 200, { ok: true, joinUrl: wk.joinUrl || "" });
}
