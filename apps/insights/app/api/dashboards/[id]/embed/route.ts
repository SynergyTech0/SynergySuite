import { type Params, route } from "@/lib/api";
import { embedUrl } from "@/lib/bridge";
import { ensureEmbeddable, getDashboard } from "@/lib/dashboards";
import { metabase } from "@/lib/metabase";
import { UserError } from "@/lib/util";

export const dynamic = "force-dynamic";

/** A freshly signed address for showing one dashboard, if this person may open it. */
export const GET = route(async (me, _req, { params }: Params<"id">) => {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) throw new UserError("Not found", 404);
  const mb = metabase();
  const d = await getDashboard(mb, me.email, me.name, id);
  if (!d) throw new UserError("Not found", 404);
  await ensureEmbeddable(mb, id);
  return embedUrl(mb.c, id);
});
