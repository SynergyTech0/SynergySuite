import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "@synergy/db";
import type { SearchResults } from "@synergy/search";
import type { Ctx } from "../lib/types";

// Runs against a real Postgres when TEST_DATABASE_URL is set, in a database of its own next to
// that one ("<name>_referrals"), so it can run alongside the other suites. Reps see their own
// records here (the default), so it covers who sees which referral as well as the money.
const base = process.env.TEST_DATABASE_URL;
process.env.PROXY_SHARED_SECRET = "gateway-secret";

let current = new Headers();
vi.mock("next/headers", () => ({ headers: async () => current }));

async function ownDatabase(url: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1)}_referrals`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

describe.skipIf(!base)("crm referrals", async () => {
  if (base) process.env.DATABASE_URL = process.env.CRM_DATABASE_URL = await ownDatabase(base);
  const members = await import("../lib/members");
  const accounts = await import("../lib/accounts");
  const contacts = await import("../lib/contacts");
  const leads = await import("../lib/leads");
  const opps = await import("../lib/opportunities");
  const activities = await import("../lib/activities");
  const partners = await import("../lib/partners");
  const referrals = await import("../lib/referrals");
  const access = await import("../lib/access");
  const { receiveLead } = await import("../lib/intake");
  const { search: discover } = await import("../lib/ediscovery");
  const { parseSearch } = await import("../lib/compliance");
  const { q, db } = await import("../lib/db");
  const searchRoute = await import("../app/api/search/route");
  const payRoute = await import("../app/api/referrals/[id]/payment/route");

  const search = async (email: string, query: string) => {
    current = new Headers({ "x-auth-request-email": email, "x-proxy-auth-secret": "gateway-secret" });
    const res = await searchRoute.POST(new Request("http://crm/api/search", { method: "POST", body: JSON.stringify({ query }) }));
    expect(res.status).toBe(200);
    return ((await res.json()) as SearchResults).results.map((h) => `${h.kind}:${h.title}`).sort();
  };

  let ada: Ctx, rex: Ctx, rita: Ctx, nora: Ctx;
  let pat: { id: string };
  let deal: { id: string };
  let ritasLead: { id: string };

  beforeAll(async () => {
    await q("TRUNCATE members, accounts, contacts, opportunities, leads, activities, ai_calls, held_records, crm_settings, record_shares, referral_partners, referrals CASCADE");
    ada = await members.join("ada@example.com", "Ada Admin");
    rex = await members.join("rex@example.com", "Rex Rep");
    rita = await members.join("rita@example.com", "Rita Rep");
    nora = await members.join("nora@example.com", "Nora New");
  });
  afterAll(async () => {
    await db().close();
  });

  it("keeps partners with a default reward, a code and links to the CRM", async () => {
    const acct = await accounts.create(rex, { name: "Zephyr Holdings" });
    const person = await contacts.create(rex, { accountId: acct.id, name: "Pat Zephyr", email: "pat@zephyr.example" });
    const p = await partners.create(rex, {
      name: "Zephyr Referrals", kind: "company", email: "pat@zephyr.example", rewardType: "percent", rewardValue: "10%", code: "ZEP10",
      contactId: person.id, accountId: acct.id,
    });
    expect(p).toMatchObject({ status: "active", rewardType: "percent", rewardValue: "10.00", code: "ZEP10", contactName: "Pat Zephyr", accountName: "Zephyr Holdings", owner: rex.email, editable: true });
    pat = p;

    await expect(partners.create(rex, { name: "X", rewardType: "percent", rewardValue: "150" })).rejects.toThrow(/at most 100/);
    await expect(partners.create(rex, { name: "X", rewardValue: "-5" })).rejects.toThrow(/Enter a reward/);
    await expect(partners.create(rex, { name: "X", code: "has space" })).rejects.toThrow(/partner code/);
    await expect(partners.create(rex, { name: "X", code: "zep10" })).rejects.toThrow(/already uses the code/);
    await expect(partners.create(rex, { name: "X", status: "dormant" })).rejects.toThrow(/Unknown status/);
    // Rita can't link a partner to Rex's contact; she can't see it.
    await expect(partners.create(rita, { name: "X", contactId: person.id })).rejects.toThrow(/contact no longer exists/);
    await expect(partners.update(rita, p.id, { name: "Mine" })).rejects.toThrow(/not found/);
  });

  it("follows a referral from lead to won deal and works out the reward", async () => {
    const lead = await leads.create(rex, { name: "Grace Hopper", company: "Compilers Inc", source: "referral", referralPartnerId: pat.id });
    expect(lead).toMatchObject({ referralPartnerId: pat.id, referralPartnerName: "Zephyr Referrals" });
    let [r] = await referrals.list(rex, { partnerId: pat.id });
    expect(r).toMatchObject({ leadId: lead.id, opportunityId: null, stage: "new", reward: null, owed: "0.00", rewardType: "percent", rewardValue: "10.00", payable: true });

    await leads.update(rex, lead.id, { status: "qualified" });
    expect((await referrals.get(rex, r.id)).stage).toBe("qualified");

    const conv = await leads.convert(rex, lead.id, { accountName: "Compilers Inc", contactName: "Grace", createOpportunity: true, opportunityName: "Compiler licences", amount: "48000" });
    deal = { id: conv.opportunityId! };
    expect(await opps.get(rex, deal.id)).toMatchObject({ referralId: r.id, referralPartnerName: "Zephyr Referrals" });
    r = await referrals.get(rex, r.id);
    expect(r).toMatchObject({ leadId: lead.id, opportunityId: deal.id, name: "Compiler licences", company: "Compilers Inc", stage: "qualified", dealValue: "48000.00" });

    // Changing the partner's default afterwards leaves this referral's terms alone.
    await partners.update(rex, pat.id, { rewardType: "fixed", rewardValue: "250" });
    await opps.moveStage(rex, deal.id, "closed_won");
    r = await referrals.get(rex, r.id);
    expect(r).toMatchObject({ stage: "won", reward: "4800.00", owed: "4800.00" });

    // A second referral, straight onto a deal, at the new default; it is lost.
    const acct = await accounts.create(rex, { name: "Other Co" });
    const lostDeal = await opps.create(rex, { accountId: acct.id, name: "Other deal", amount: "1000", stage: "closed_lost", referralPartnerId: pat.id });
    expect(lostDeal.referralPartnerName).toBe("Zephyr Referrals");

    const p = await partners.get(rex, pat.id);
    expect(p.referrals.map((x) => [x.name, x.stage, x.rewardType])).toEqual([["Other deal", "lost", "fixed"], ["Compiler licences", "won", "percent"]]);
    expect(p.totals).toEqual({ sent: 2, won: 1, earned: "4800.00", paid: "0.00", outstanding: "4800.00" });
    expect((await referrals.list(rex, { unpaid: true })).map((x) => x.name)).toEqual(["Compiler licences"]);
    expect((await referrals.list(rex, { stage: "lost" })).map((x) => x.name)).toEqual(["Other deal"]);

    // Clearing who referred the lost deal removes that referral.
    await opps.update(rex, lostDeal.id, { referralPartnerId: "" });
    expect((await opps.get(rex, lostDeal.id)).referralId).toBeNull();
    expect((await partners.get(rex, pat.id)).totals.sent).toBe(1);
  });

  it("lets the partner's owner or a manager mark the reward paid, once", async () => {
    const [r] = await referrals.list(rex, { partnerId: pat.id });
    await expect(referrals.pay(rita, r.id, {})).rejects.toThrow(/not found/);
    await expect(referrals.pay(rex, r.id, { paidOn: "2026-02-30" })).rejects.toThrow(/payment date/);
    const paid = await referrals.pay(rex, r.id, { paidOn: "2026-10-01", note: "Bank transfer 1042" });
    expect(paid).toMatchObject({ paidOn: "2026-10-01", paidAmount: "4800.00", paidNote: "Bank transfer 1042", paidBy: rex.email, owed: "0.00" });
    await expect(referrals.pay(rex, r.id, {})).rejects.toThrow(/already marked paid/);
    expect((await partners.get(rex, pat.id)).totals).toEqual({ sent: 1, won: 1, earned: "4800.00", paid: "4800.00", outstanding: "0.00" });

    // Once paid, who referred it is settled, and the partner can't be deleted.
    await expect(opps.update(rex, deal.id, { referralPartnerId: "" })).rejects.toThrow(/has been paid/);
    await expect(partners.remove(rex, pat.id)).rejects.toThrow(/inactive instead/);

    // Undo, and pay a different amount through the route.
    await referrals.unpay(rex, r.id);
    current = new Headers({ "x-auth-request-email": ada.email, "x-proxy-auth-secret": "gateway-secret" });
    const res = await payRoute.PUT(
      new Request(`http://crm/api/referrals/${r.id}/payment`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount: "4500", note: "Agreed discount" }) }),
      { params: Promise.resolve({ id: r.id }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ paidAmount: "4500.00", paidBy: ada.email });
    expect((await partners.get(ada, pat.id)).totals).toMatchObject({ earned: "4500.00", paid: "4500.00", outstanding: "0.00" });

    // Only won referrals are paid.
    const open = await leads.create(rex, { name: "Open One", referralPartnerId: pat.id });
    const [openRef] = (await referrals.list(rex, { partnerId: pat.id })).filter((x) => x.leadId === open.id);
    await expect(referrals.pay(rex, openRef.id, {})).rejects.toThrow(/once the deal is won/);
    // Deleting a lead takes its unpaid referral with it.
    await leads.remove(rex, open.id);
    expect((await referrals.list(rex, { partnerId: pat.id })).map((x) => x.leadId)).not.toContain(open.id);
  });

  it("shows a rep the referrals on their own leads and deals, and the partner's owner all of them", async () => {
    // Rita can't pick a partner she can't see, until it is shared with her.
    await expect(leads.create(rita, { name: "Alan Turing", referralPartnerId: pat.id })).rejects.toThrow(/partner no longer exists/);
    await access.setShares(rex, "partner", pat.id, [rita.email]);
    ritasLead = await leads.create(rita, { name: "Alan Turing", company: "Bletchley Ltd", referralPartnerId: pat.id });
    await access.setShares(rex, "partner", pat.id, []);

    // She still sees the partner through her lead, but only her own referral and its totals.
    const seen = await partners.get(rita, pat.id);
    expect(seen.editable).toBe(false);
    expect(seen.contactName).toBe(""); // Rex's contact stays hidden
    expect(seen.referrals.map((r) => [r.name, r.payable])).toEqual([["Alan Turing", false]]);
    expect(seen.totals).toMatchObject({ sent: 1, won: 0, paid: "0.00" });
    expect((await referrals.list(rita)).map((r) => r.name)).toEqual(["Alan Turing"]);
    expect((await partners.list(rita)).map((p) => p.name)).toEqual(["Zephyr Referrals"]);

    // Rex owns the partner: he sees Rita's referral, though not her lead itself.
    expect((await referrals.list(rex, { partnerId: pat.id })).map((r) => r.name).sort()).toEqual(["Alan Turing", "Compiler licences"]);
    await expect(leads.get(rex, ritasLead.id)).rejects.toThrow(/not found/);

    // Someone with no part in it sees none of it.
    expect(await partners.list(nora)).toEqual([]);
    expect(await referrals.list(nora)).toEqual([]);
    await expect(partners.get(nora, pat.id)).rejects.toThrow(/not found/);

    // Activities on a partner follow the same rule.
    await activities.create(rex, { relatedType: "partner", relatedId: pat.id, type: "call", subject: "Quarterly partner call" });
    expect((await activities.forRecord(rita, "partner", pat.id)).map((a) => a.subject)).toEqual(["Quarterly partner call"]);
    expect(await activities.forRecord(nora, "partner", pat.id)).toEqual([]);
    await expect(activities.create(nora, { relatedType: "partner", relatedId: pat.id, subject: "Peek" })).rejects.toThrow(/no longer exists/);
  });

  it("finds partners and referred records in suite search, by the same rule", async () => {
    expect(await search(rex.email, "zephyr")).toEqual([
      "account:Zephyr Holdings", "activity:Quarterly partner call", "contact:Pat Zephyr", "lead:Grace Hopper", "opportunity:Compiler licences", "partner:Zephyr Referrals",
    ]);
    expect(await search(rita.email, "zephyr")).toEqual(["activity:Quarterly partner call", "lead:Alan Turing", "partner:Zephyr Referrals"]);
    expect(await search(nora.email, "zephyr")).toEqual([]);
    expect(await search(ada.email, "zep10")).toEqual(["partner:Zephyr Referrals"]);
    // And in eDiscovery.
    const hits = await discover(parseSearch({ query: "zephyr", kinds: ["partner"] }, ["partner"]));
    expect(hits.hits.map((h) => `${h.kind}:${h.title}`)).toEqual(["partner:Zephyr Referrals"]);
  });

  it("attributes a web form lead from a partner's code", async () => {
    const id = await receiveLead({ name: "Web Visitor", email: "visitor@example.net", partner_code: "zep10" });
    const lead = await leads.get(ada, id);
    expect(lead).toMatchObject({ source: "referral", referralPartnerId: pat.id, referralPartnerName: "Zephyr Referrals" });
    const [r] = (await referrals.list(ada, { partnerId: pat.id })).filter((x) => x.leadId === id);
    expect(r).toMatchObject({ stage: "new", rewardType: "fixed", rewardValue: "250.00" });

    // Unknown codes, and codes of inactive partners, are ignored.
    const plain = await leads.get(ada, await receiveLead({ name: "Other", email: "o@example.net", partnerCode: "NOPE" }));
    expect(plain).toMatchObject({ source: "web", referralPartnerId: null });
    await partners.update(rex, pat.id, { status: "inactive" });
    expect((await leads.get(ada, await receiveLead({ name: "Late", email: "l@example.net", ref: "ZEP10" }))).referralPartnerId).toBeNull();
    // An inactive partner gets no new referrals by hand either.
    await expect(leads.create(rex, { name: "New", referralPartnerId: pat.id })).rejects.toThrow(/inactive/);
  });

  it("keeps a paid referral when its deal's account is deleted", async () => {
    const acct = (await accounts.list(ada, { q: "Compilers" }))[0];
    await accounts.remove(ada, acct.id);
    const p = await partners.get(rex, pat.id);
    const paid = p.referrals.find((r) => r.paidOn);
    // The converted lead is still there, so the referral stays on it, with its payment.
    expect(paid).toMatchObject({ opportunityId: null, name: "Grace Hopper", stage: "won", paidAmount: "4500.00", owed: "0.00" });
    expect(p.totals).toMatchObject({ won: 1, paid: "4500.00", outstanding: "0.00" });
  });
});
