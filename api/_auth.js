import { timingSafeEqual } from "node:crypto";
// Header "x-admin-key" must equal the ADMIN_KEY environment variable.
export function authed(req) {
  const want = process.env.ADMIN_KEY || "", got = String(req.headers["x-admin-key"] || "");
  if (!want || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
