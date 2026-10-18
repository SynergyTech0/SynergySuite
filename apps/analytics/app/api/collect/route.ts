import { clientIp } from "@/lib/api";
import { record, type Beacon } from "@/lib/collect";
import { allow } from "@/lib/ratelimit";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };
const done = () => new Response(null, { status: 204, headers: CORS });

export const OPTIONS = async () => done();

/**
 * Takes beacons from the tracking script (posted as text, so browsers send them without a
 * preflight). Always answers 204: a bad key, a bot, a wrong origin or a full rate limit is dropped
 * quietly, and a beacon never shows an error on someone's site.
 */
export const POST = async (req: Request): Promise<Response> => {
  try {
    const ip = clientIp(req);
    if (!allow(`ip:${ip}`, 120, 60_000)) return done();
    const raw = await req.text();
    if (raw.length > 8192) return done();
    let b: Beacon;
    try {
      b = JSON.parse(raw || "{}");
    } catch {
      return done();
    }
    if (!b || typeof b !== "object") return done();
    await record(b, { ip, ua: req.headers.get("user-agent") || "", origin: req.headers.get("origin") });
  } catch (err) {
    console.error("[analytics] collect:", (err as Error).message);
  }
  return done();
};
