import { route } from "@/lib/api";
import { listIncidents } from "@/lib/protection";

export const GET = route("protection", async (_me, req) => {
  const u = new URL(req.url).searchParams;
  return listIncidents({
    status: u.get("status") ?? undefined, app: u.get("app") ?? undefined, action: u.get("action") ?? undefined,
    q: u.get("q") ?? undefined, before: u.get("before") ?? undefined,
  });
});
