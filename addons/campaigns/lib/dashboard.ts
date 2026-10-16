import { q } from "./db";

/** The numbers on the home page: lists, and how the last 90 days of campaigns did. */
export async function dashboard() {
  const [lists] = await q<{ audiences: number; subscribed: number; joined30: number; left30: number; suppressed: number }>(
    `SELECT (SELECT count(*)::int FROM audiences) AS audiences,
       (SELECT count(*)::int FROM subscribers WHERE status = 'subscribed') AS subscribed,
       (SELECT count(*)::int FROM subscribers WHERE status = 'subscribed' AND created_at > now() - interval '30 days') AS joined30,
       (SELECT count(*)::int FROM subscribers WHERE unsubscribed_at > now() - interval '30 days') AS left30,
       (SELECT count(*)::int FROM suppressions) AS suppressed`,
  );
  const [sends] = await q<{ campaigns: number; sent: number; opened: number; clicked: number; bounced: number; unsubscribed: number }>(
    `SELECT count(DISTINCT d.campaign_id)::int AS campaigns,
       count(*) FILTER (WHERE d.status = 'sent')::int AS sent,
       count(d.opened_at)::int AS opened, count(d.clicked_at)::int AS clicked,
       count(*) FILTER (WHERE d.status = 'bounced')::int AS bounced, count(d.unsubscribed_at)::int AS unsubscribed
     FROM deliveries d JOIN campaigns c ON c.id = d.campaign_id WHERE c.started_at > now() - interval '90 days'`,
  );
  return { lists, sends };
}
