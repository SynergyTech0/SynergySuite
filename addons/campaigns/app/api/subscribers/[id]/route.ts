import { body, route, type Params } from "@/lib/api";
import { getSubscriber, updateSubscriber } from "@/lib/audiences";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

/** One person with what they were sent and did. */
export const GET = route(async (_ctx, _req, { params }: Params<"id">) => {
  const s = await getSubscriber((await params).id);
  const activity = await q<{ name: string | null; status: string; sent_at: Date | null; opened_at: Date | null; clicked_at: Date | null; unsubscribed_at: Date | null }>(
    `SELECT coalesce(c.name, a.name) AS name, d.status, d.sent_at, d.opened_at, d.clicked_at, d.unsubscribed_at
     FROM deliveries d LEFT JOIN campaigns c ON c.id = d.campaign_id LEFT JOIN automations a ON a.id = d.automation_id
     WHERE d.subscriber_id = $1 ORDER BY d.id DESC LIMIT 50`,
    [s.id],
  );
  return { subscriber: s, activity };
});
export const PATCH = route(async (ctx, req, { params }: Params<"id">) => updateSubscriber(ctx, (await params).id, await body(req)));
