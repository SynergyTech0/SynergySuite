import { body, route, type Params } from "@/lib/api";
import * as activities from "@/lib/activities";

export const PATCH = route(async (ctx, req, { params }: Params<"id">) => activities.update(ctx, (await params).id, await body(req)));

export const DELETE = route(async (ctx, _req, { params }: Params<"id">) => {
  await activities.remove(ctx, (await params).id);
});
