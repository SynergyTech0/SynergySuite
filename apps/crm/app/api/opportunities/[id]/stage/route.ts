import { body, route, type Params } from "@/lib/api";
import * as opps from "@/lib/opportunities";

export const PATCH = route(async (ctx, req, { params }: Params<"id">) => opps.moveStage(ctx, (await params).id, (await body(req)).stage));
