import { body, route } from "@/lib/api";
import { assertIsAgent, isAgent } from "@/lib/agents";
import { counts, create, list, type NewTicket } from "@/lib/tickets";

export const GET = route(async (me, req) => {
  const u = new URL(req.url);
  const [tickets, totals] = await Promise.all([
    list(me, { view: u.searchParams.get("view") ?? undefined, q: u.searchParams.get("q") ?? undefined }),
    counts(me),
  ]);
  return { tickets, counts: totals };
});

/** Agents open tickets for anyone; anyone else opens one for themselves. */
export const POST = route(async (me, req) => {
  const b = await body<NewTicket>(req);
  if (!isAgent(me)) return create({ subject: b.subject, body: b.body, priority: b.priority, requesterEmail: me.email, requesterName: me.name }, { source: "manual", author: me.email });
  if (b.assignee) await assertIsAgent(String(b.assignee));
  return create(b, { source: "manual", author: me.email });
});
