import { body, route } from "@/lib/api";
import * as activities from "@/lib/activities";

/** ?mine=1 is My Day; otherwise ?relatedType=&relatedId= is one record's timeline. */
export const GET = route(async (ctx, req) => {
  const u = new URL(req.url);
  if (u.searchParams.get("mine") === "1") return activities.myDay(ctx);
  return activities.forRecord(ctx, u.searchParams.get("relatedType"), u.searchParams.get("relatedId"));
});

export const POST = route(async (ctx, req) => activities.create(ctx, await body(req)));
