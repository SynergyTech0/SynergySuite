import { route } from "@/lib/api";
import { SOURCE_NAMES, isAdmin } from "@/lib/config";
import { metabase } from "@/lib/metabase";
import { lastSync, syncAll } from "@/lib/sources";
import { UserError } from "@/lib/util";

export const dynamic = "force-dynamic";

/** The suite databases Insights reports on, and how the last sync went. Admins only. */
export const GET = route(async (me) => {
  const mb = metabase();
  if (!isAdmin(mb.c, me.email)) throw new UserError("Only Insights admins can see this", 403);
  return { sources: mb.c.sources, names: SOURCE_NAMES, last: lastSync() };
});

/** Syncs now: grants, connections and Metabase's settings. */
export const POST = route(async (me) => {
  const mb = metabase();
  if (!isAdmin(mb.c, me.email)) throw new UserError("Only Insights admins can do this", 403);
  return { sources: mb.c.sources, names: SOURCE_NAMES, last: await syncAll(mb) };
});
