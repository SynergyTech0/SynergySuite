import { body, tokenRoute } from "@/lib/api";
import { create } from "@/lib/tickets";

type Intake = {
  subject?: unknown; body?: unknown; email?: unknown; name?: unknown; priority?: unknown;
  // The names the original Desk used; still accepted.
  requesterEmail?: unknown; requesterName?: unknown;
};

// Opens a ticket on behalf of another service. Bearer DESK_API_TOKEN.
export const POST = tokenRoute(async (req) => {
  const b = await body<Intake>(req);
  const t = await create(
    { subject: b.subject, body: b.body, priority: b.priority, requesterEmail: b.email ?? b.requesterEmail, requesterName: b.name ?? b.requesterName },
    { source: "api" },
  );
  return { id: t.id, number: t.number };
});
