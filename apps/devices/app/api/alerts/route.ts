import { listAlerts } from "@/lib/alerts";
import { route } from "@/lib/api";
import { DETECTIONS } from "@/lib/detections";

/** Admins: every alert. Everyone else: alerts on their own devices. ?status=open|all|new|…&severity=&device= */
export const GET = route(async (me, req) => {
  const u = new URL(req.url).searchParams;
  const alerts = await listAlerts({
    status: u.get("status") ?? undefined,
    severity: u.get("severity") ?? undefined,
    device: u.get("device") ?? undefined,
    owner: me.role === "admin" ? undefined : me.email,
  });
  return { alerts, detections: DETECTIONS };
});
