import { route } from "@/lib/api";
import { suggest } from "@/lib/directory";

/** Recipient suggestions; Mail calls this from its server for the To, Cc and Bcc boxes. */
export const GET = route(async (me, req) => {
  const u = new URL(req.url);
  return suggest(me.email, u.searchParams.get("q") ?? "", Math.min(20, Number(u.searchParams.get("limit")) || 8));
});
