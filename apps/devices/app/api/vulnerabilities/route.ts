import { adminRoute } from "@/lib/api";
import { fleetVulns } from "@/lib/devices";
import { osvBase } from "@/lib/vulns";

export const GET = adminRoute(async (_me, req) => {
  const u = new URL(req.url).searchParams;
  return { enabled: !!osvBase(), vulnerabilities: await fleetVulns({ severity: u.get("severity") ?? undefined, q: u.get("q") ?? undefined }) };
});
