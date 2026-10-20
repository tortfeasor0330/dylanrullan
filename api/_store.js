// Storage wrapper: Vercel Blob (private) in production, in-memory when MOCK_BLOB=1 for local tests.
let impl;
if (process.env.MOCK_BLOB === "1") {
  const mem = globalThis.__mem || (globalThis.__mem = new Map());
  impl = {
    async exists(p) { return mem.has(p); },
    async putJSON(p, obj, { overwrite = false } = {}) {
      if (!overwrite && mem.has(p)) { const e = new Error("exists"); e.exists = true; throw e; }
      mem.set(p, { body: Buffer.from(JSON.stringify(obj)), type: "application/json" }); return p;
    },
    async putFile(p, buf, type) { const key = p.replace(/(\.\w+)$/, "-" + Math.random().toString(36).slice(2, 8) + "$1"); mem.set(key, { body: buf, type }); return key; },
    async list(prefix) { return [...mem.keys()].filter(k => k.startsWith(prefix)); },
    async getJSON(p) { const v = mem.get(p); return v ? JSON.parse(v.body.toString()) : null; },
    async getFile(p) { const v = mem.get(p); return v ? { body: v.body, type: v.type } : null; },
    async del(p) { mem.delete(p); }
  };
} else {
  const { put, head, list, get, del } = await import("@vercel/blob");
  const readAll = async (stream) => Buffer.from(await new Response(stream).arrayBuffer());
  impl = {
    async exists(p) { try { await head(p); return true; } catch { return false; } },
    async putJSON(p, obj, { overwrite = false } = {}) {
      try {
        const r = await put(p, JSON.stringify(obj), { access: "private", addRandomSuffix: false, allowOverwrite: overwrite, contentType: "application/json" });
        return r.pathname;
      } catch (e) { if (!overwrite && await impl.exists(p)) e.exists = true; throw e; }
    },
    async putFile(p, buf, type) { const r = await put(p, buf, { access: "private", addRandomSuffix: true, contentType: type }); return r.pathname; },
    async list(prefix) {
      const out = []; let cursor;
      do { const r = await list({ prefix, cursor, limit: 1000 }); r.blobs.forEach(b => out.push(b.pathname)); cursor = r.hasMore ? r.cursor : undefined; } while (cursor);
      return out;
    },
    async getJSON(p) { const r = await get(p, { access: "private", useCache: false }); return r && r.stream ? JSON.parse((await readAll(r.stream)).toString()) : null; },
    async getFile(p) { const r = await get(p, { access: "private" }); return r && r.stream ? { body: await readAll(r.stream), type: r.blob.contentType } : null; },
    async del(p) { await del(p); }
  };
}
export const store = impl;
export const configured = () => process.env.MOCK_BLOB === "1" || !!process.env.BLOB_READ_WRITE_TOKEN || !!process.env.BLOB_STORE_ID;
export function send(res, code, obj) { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(obj)); }
