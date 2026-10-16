import { route } from "@/lib/api";
import { listDevices } from "@/lib/devices";

/** Admins: every device (or ?mine=1). Everyone else: their own. */
export const GET = route(async (me, req) => {
  const u = new URL(req.url).searchParams;
  return listDevices(me, {
    q: u.get("q") ?? undefined,
    compliance: u.get("compliance") ?? undefined,
    platform: u.get("platform") ?? undefined,
    mine: u.get("mine") === "1",
  });
});
