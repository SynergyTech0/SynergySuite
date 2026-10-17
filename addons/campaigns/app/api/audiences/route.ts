import { body, route } from "@/lib/api";
import { createAudience, listAudiences } from "@/lib/audiences";

export const dynamic = "force-dynamic";

export const GET = route(async () => listAudiences());
export const POST = route(async (ctx, req) => createAudience(ctx, await body(req)));
