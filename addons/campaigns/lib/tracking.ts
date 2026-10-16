/**
 * What recipients do with an email, found by the delivery's token in each link: opening it (the
 * pixel), clicking a link (redirected to the link it stood for, never to an address taken from
 * the request), unsubscribing and viewing it in a browser. The token is 122+ random bits and
 * names one email to one person, so holding it is the proof.
 */
import { suppress } from "./audiences";
import { q, tx } from "./db";
import { compose, mergeUrl, personalize, type Composed, type Recipient } from "./render";
import { getSettings } from "./settings";
import type { Block } from "./types";

export type Delivery = {
  id: string; token: string; email: string; campaign_id: string | null; automation_id: string | null; subscriber_id: string | null;
  audience_id: string | null; status: string; unsubscribed_at: Date | null;
  links: string[] | null; first_name: string | null; last_name: string | null; company: string | null; fields: Record<string, string> | null;
  sub_status: string | null; audience_name: string | null;
};

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

export async function findDelivery(tok: string): Promise<Delivery | null> {
  if (!TOKEN.test(tok)) return null;
  const [d] = await q<Delivery>(
    `SELECT d.id, d.token, d.email, d.campaign_id, d.automation_id, d.subscriber_id, d.audience_id, d.status, d.unsubscribed_at,
       coalesce(d.links, c.links) AS links, s.first_name, s.last_name, s.company, s.fields, s.status AS sub_status,
       (SELECT name FROM audiences WHERE id = d.audience_id) AS audience_name
     FROM deliveries d LEFT JOIN campaigns c ON c.id = d.campaign_id LEFT JOIN subscribers s ON s.id = d.subscriber_id
     WHERE d.token = $1`,
    [tok],
  );
  return d ?? null;
}

const recipient = (d: Delivery): Recipient => ({ email: d.email, firstName: d.first_name ?? "", lastName: d.last_name ?? "", company: d.company ?? "", fields: d.fields ?? {} });

export async function recordOpen(tok: string): Promise<void> {
  const d = await findDelivery(tok);
  if (!d) return;
  await q("UPDATE deliveries SET opened_at = coalesce(opened_at, now()) WHERE id = $1", [d.id]);
  await q("INSERT INTO events (delivery_id, campaign_id, kind) VALUES ($1, $2, 'open')", [d.id, d.campaign_id]);
}

/** Where link `i` of this email goes, after recording the click; null for a link that isn't there. */
export async function recordClick(tok: string, i: number): Promise<string | null> {
  const d = await findDelivery(tok);
  const url = d?.links?.[i];
  if (!d || !url || !Number.isInteger(i)) return null;
  // A click means it was opened too, even with images blocked.
  await q("UPDATE deliveries SET clicked_at = coalesce(clicked_at, now()), opened_at = coalesce(opened_at, now()) WHERE id = $1", [d.id]);
  await q("INSERT INTO events (delivery_id, campaign_id, kind, url) VALUES ($1, $2, 'click', $3)", [d.id, d.campaign_id, url]);
  const to = mergeUrl(url, recipient(d));
  return /^(https?:|mailto:)/i.test(to) ? to : null;
}

/**
 * Leaves the audience the email came from or, with `everything`, every list (the address goes on
 * the suppression list). Safe to repeat.
 */
export async function unsubscribe(d: Delivery, everything: boolean): Promise<void> {
  await tx(async (tq) => {
    if (everything) await suppress(tq, d.email, "unsubscribed", "Unsubscribed from everything", d.campaign_id);
    else if (d.subscriber_id) {
      await tq(
        "UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = now(), updated_at = now() WHERE id = $1 AND status IN ('subscribed','pending')",
        [d.subscriber_id],
      );
    }
    const [first] = await tq("UPDATE deliveries SET unsubscribed_at = now() WHERE id = $1 AND unsubscribed_at IS NULL RETURNING id", [d.id]);
    if (first) await tq("INSERT INTO events (delivery_id, campaign_id, kind) VALUES ($1, $2, 'unsubscribe')", [d.id, d.campaign_id]);
    await tq("DELETE FROM automation_runs WHERE subscriber_id = $1 AND done_at IS NULL", [d.subscriber_id]);
  });
}

/** Undoes an unsubscribe from the same page, for someone who clicked by mistake. */
export async function resubscribe(d: Delivery): Promise<boolean> {
  return tx(async (tq) => {
    const [sup] = await tq<{ reason: string }>("SELECT reason FROM suppressions WHERE email = $1", [d.email]);
    if (sup && sup.reason !== "unsubscribed") return false; // a bounce or a block stays
    if (sup) await tq("DELETE FROM suppressions WHERE email = $1", [d.email]);
    if (d.subscriber_id) {
      await tq("UPDATE subscribers SET status = 'subscribed', unsubscribed_at = NULL, consent_at = now(), updated_at = now() WHERE id = $1 AND status = 'unsubscribed'", [d.subscriber_id]);
    }
    return true;
  });
}

/** The email as this person got it, links untracked, for "view in your browser". */
export async function browserCopy(d: Delivery): Promise<string | null> {
  let composed: Composed | null = null;
  if (d.campaign_id) {
    const [c] = await q<{ html: string | null }>("SELECT html FROM campaigns WHERE id = $1", [d.campaign_id]);
    if (c?.html) composed = JSON.parse(c.html) as Composed;
  } else if (d.automation_id) {
    const [a] = await q<{ blocks: Block[]; preheader: string }>("SELECT blocks, preheader FROM automations WHERE id = $1", [d.automation_id]);
    if (a) composed = compose(a.blocks, { preheader: a.preheader });
  }
  if (!composed) return null;
  const s = await getSettings();
  const r = recipient(d);
  return personalize(composed, r, {
    footer: { orgName: s.orgName, postalAddress: s.postalAddress, unsubscribeUrl: `/u/${d.token}` },
    linkUrl: (_i, url) => mergeUrl(url, r),
  }).html;
}

/** A complaint (this was spam) from a mailbox provider's feedback loop: never mail them again. */
export async function recordComplaint(tok: string): Promise<boolean> {
  const d = await findDelivery(tok);
  if (!d) return false;
  await tx(async (tq) => {
    await tq("INSERT INTO events (delivery_id, campaign_id, kind) VALUES ($1, $2, 'complaint')", [d.id, d.campaign_id]);
    await suppress(tq, d.email, "complained", "Marked as spam", d.campaign_id);
  });
  return true;
}

/** A hard bounce reported after the fact (a DSN in the sender's mailbox). */
export async function recordBounce(tok: string, detail: string): Promise<boolean> {
  const d = await findDelivery(tok);
  if (!d || d.status === "bounced") return false;
  await tx(async (tq) => {
    await tq("UPDATE deliveries SET status = 'bounced', error = $2 WHERE id = $1", [d.id, detail.slice(0, 500)]);
    await tq("INSERT INTO events (delivery_id, campaign_id, kind) VALUES ($1, $2, 'bounce')", [d.id, d.campaign_id]);
    await suppress(tq, d.email, "bounced", detail, d.campaign_id);
  });
  return true;
}
