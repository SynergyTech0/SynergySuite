import { body, route } from "@/lib/api";
import { addSuppressions, listSuppressions } from "@/lib/audiences";

export const dynamic = "force-dynamic";

export const GET = route(async (_ctx, req) => listSuppressions({ q: (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 200) }));
export const POST = route(async (ctx, req) => ({ count: await addSuppressions(ctx, (await body<{ emails?: unknown }>(req)).emails) }));
