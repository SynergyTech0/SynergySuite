import { body, tokenRoute } from "@/lib/api";
import { createMonitor, listMonitors } from "@/lib/monitors";

// For a provisioning service on the internal network (bearer STATUS_API_TOKEN): read what is
// monitored, then add what is missing. No update or delete, so the token can't quietly stop
// monitoring something.
export const GET = tokenRoute(async () => ({
  monitors: (await listMonitors()).map(({ id, name, url, expect_status, interval_sec, active, public: isPublic, sort }) => ({
    id, name, url, expect_status, interval_sec, active, public: isPublic, sort,
  })),
}));

export const POST = tokenRoute(async (req) => ({ monitor: await createMonitor(await body(req)) }));
