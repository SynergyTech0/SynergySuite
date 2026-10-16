import { body, route } from "@/lib/api";
import { counts, create, list, type NewTicket } from "@/lib/tickets";

export const GET = route(async (me, req) => {
  const u = new URL(req.url);
  const [tickets, totals] = await Promise.all([
    list(me.email, { view: u.searchParams.get("view") ?? undefined, q: u.searchParams.get("q") ?? undefined }),
    counts(me.email),
  ]);
  return { tickets, counts: totals };
});

export const POST = route(async (me, req) => create(await body<NewTicket>(req), { source: "manual", author: me.email }));
