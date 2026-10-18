import { requireAdmin, route } from "@/lib/api";
import { addSuiteApps } from "@/lib/monitors";

/** Adds a monitor for each of the suite's apps on this deployment's domain. */
export const POST = route(async (me) => {
  requireAdmin(me);
  return { added: await addSuiteApps() };
});
