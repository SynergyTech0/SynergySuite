import { body, filters, route } from "@/lib/api";
import * as records from "@/lib/opportunities";

export const GET = route(async (ctx, req) => records.list(ctx, filters(req)));

export const POST = route(async (ctx, req) => records.create(ctx, await body(req)));
