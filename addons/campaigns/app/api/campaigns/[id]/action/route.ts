import { body, route, type Params } from "@/lib/api";
import * as c from "@/lib/campaigns";
import { UserError } from "@/lib/util";

/** schedule (at = ISO time, or none for now), unschedule, pause, resume, cancel, duplicate, test (to). */
export const POST = route(async (ctx, req, { params }: Params<"id">) => {
  const id = (await params).id;
  const b = await body<{ action?: string; at?: unknown; to?: unknown }>(req);
  switch (b.action) {
    case "schedule": return c.schedule(ctx, id, b.at);
    case "unschedule": return c.unschedule(ctx, id);
    case "pause": return c.pause(ctx, id);
    case "resume": return c.resume(ctx, id);
    case "cancel": return c.cancel(ctx, id);
    case "duplicate": return c.duplicateCampaign(ctx, id);
    case "test": return c.sendTest(ctx, id, b.to);
  }
  throw new UserError("Unknown action");
});
