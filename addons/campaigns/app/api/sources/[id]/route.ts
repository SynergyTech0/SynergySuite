import { route, type Params } from "@/lib/api";
import { deleteSource } from "@/lib/sources";

/** Stops syncing; the people it brought stay. */
export const DELETE = route(async (ctx, _req, { params }: Params<"id">) => deleteSource(ctx, (await params).id));
