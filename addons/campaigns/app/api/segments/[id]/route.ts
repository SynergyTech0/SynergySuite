import { body, route, type Params } from "@/lib/api";
import { deleteSegment, updateSegment } from "@/lib/segments";

export const PATCH = route(async (ctx, req, { params }: Params<"id">) => updateSegment(ctx, (await params).id, await body(req)));
export const DELETE = route(async (ctx, _req, { params }: Params<"id">) => deleteSegment(ctx, (await params).id));
