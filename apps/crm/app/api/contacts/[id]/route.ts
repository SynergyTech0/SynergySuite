import { body, route, type Params } from "@/lib/api";
import * as records from "@/lib/contacts";

export const GET = route(async (ctx, _req, { params }: Params<"id">) => records.get(ctx, (await params).id));

export const PATCH = route(async (ctx, req, { params }: Params<"id">) => records.update(ctx, (await params).id, await body(req)));

export const DELETE = route(async (ctx, _req, { params }: Params<"id">) => {
  await records.remove(ctx, (await params).id);
});
