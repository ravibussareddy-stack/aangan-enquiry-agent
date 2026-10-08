import { timingSafeEqual } from "node:crypto";

/** Cron endpoints require Authorization: Bearer CRON_SECRET. */
export function authorizedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret) return false;
  const a = Buffer.from(`Bearer ${secret}`);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}
