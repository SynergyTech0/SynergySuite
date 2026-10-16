import { route } from "@/lib/api";
import { statuses } from "@/lib/apps";

export const GET = route("apps", async (_me, req) => ({
  apps: await statuses(new URL(req.url).searchParams.get("fresh") === "1"),
  token: !!process.env.COMPLIANCE_TOKEN,
}));
