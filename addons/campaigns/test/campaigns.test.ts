import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.SUITE_DOMAIN = "example.com";
process.env.CAMPAIGNS_SMTP_HOST = "smtp.test";
process.env.CAMPAIGNS_SMTP_USER = "u";
process.env.CAMPAIGNS_SMTP_PASSWORD = "p";
delete process.env.MAIL_SMTP_HOST;
delete process.env.DEMO_MODE;

const admin = { email: "alice@example.com", name: "Alice Admin", role: "admin" as const };
const viewer = { email: "vic@example.com", name: "Vic Viewer", role: "viewer" as const };

/** A stand-in for CRM and Contacts: answers as whoever the gateway headers say. */
let server: Server;
const asked: { path: string; who: string | undefined }[] = [];

describe.skipIf(!url)("campaigns", async () => {
  const { q, db } = await import("../lib/db");
  const members = await import("../lib/members");
  const aud = await import("../lib/audiences");
  const camp = await import("../lib/campaigns");
  const sender = await import("../lib/sender");
  const tracking = await import("../lib/tracking");
  const settings = await import("../lib/settings");
  const segments = await import("../lib/segments");
  const autos = await import("../lib/automations");
  const forms = await import("../lib/forms");
  const sources = await import("../lib/sources");
  const ed = await import("../lib/ediscovery");
  const { parseSearch } = await import("../lib/compliance");
  const { searchFor } = await import("../lib/search");
  const { outbox } = await import("../lib/mailer");

  type Msg = Parameters<typeof outbox.send>[0];
  const sent: Msg[] = [];
  const refuse = new Set<string>();
  outbox.send = async (m) => {
    if (refuse.has(m.to)) return { sent: false, reason: "550 5.1.1 no such user", permanent: true };
    sent.push(m);
    return { sent: true, messageId: m.messageId };
  };
  const tokenOf = (m: Msg) => m.headers["X-Campaign-Delivery"];

  beforeAll(async () => {
    await db().q("DROP SCHEMA public CASCADE");
    await db().q("CREATE SCHEMA public");
    server = createServer((req, res) => {
      asked.push({ path: req.url!, who: req.headers["x-auth-request-email"] as string | undefined });
      const json = (v: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(v));
      if (req.url!.startsWith("/api/leads")) return json([
        { name: "Lena Lead", email: "lena@lead.example", company: "LeadCo", status: "new", source: "web", score: 80 },
        { name: "No Email", email: "", company: "", status: "new", source: "web", score: null },
      ]);
      if (req.url!.startsWith("/api/contacts?group=")) return json([{ firstName: "Gus", lastName: "Group", company: "", jobTitle: "CTO", emails: [{ value: "gus@group.example" }] }]);
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.CRM_INTERNAL_URL = base;
    process.env.CONTACTS_INTERNAL_URL = base;
  });
  afterAll(() => server?.close());

  let audienceId = "";

  it("makes the first visitor admin and later ones viewers", async () => {
    expect((await members.join(admin.email, admin.name)).role).toBe("admin");
    expect((await members.join(viewer.email, viewer.name)).role).toBe("viewer");
    await expect(aud.createAudience(viewer, { name: "Nope" })).rejects.toThrow(/marketers/);
  });

  it("won't send until the sender and postal address are set", async () => {
    const a = await aud.createAudience(admin, { name: "Newsletter" });
    audienceId = a.id;
    await aud.addSubscriber(admin, a.id, { email: "Ann@Example.com", firstName: "Ann", tags: "vip" });
    const c = await camp.createCampaign(admin, { name: "Hello", audienceId: a.id, subject: "Hi {{first_name}}" });
    await expect(camp.schedule(admin, c.id, null)).rejects.toThrow(/postal address/);
    await settings.saveSettings(admin, { fromEmail: "news@example.com", fromName: "Synergy", orgName: "Synergy Tech", postalAddress: "1 Main St", perMinute: 600 });
    await expect(settings.saveSettings(viewer, {})).rejects.toThrow(/admin/);
  });

  it("imports a CSV, keeping unsubscribes and suppressions", async () => {
    await aud.upsertMany(admin.email, audienceId, [
      { email: "bob@example.com", firstName: "Bob", source: "csv", tags: ["vip"] },
      { email: "bad-address", source: "csv" },
      { email: "carl@example.com", source: "csv" },
      { email: "blocked@example.com", source: "csv" },
    ]);
    await aud.addSuppressions(admin, "blocked@example.com");
    const subs = await aud.listSubscribers(audienceId, {});
    expect(subs.total).toBe(4);
    expect(subs.items.find((s) => s.email === "blocked@example.com")?.status).toBe("unsubscribed");
    // An import never brings a leaver back.
    const carl = subs.items.find((s) => s.email === "carl@example.com")!;
    await aud.updateSubscriber(admin, carl.id, { status: "unsubscribed" });
    const res = await aud.upsertMany(admin.email, audienceId, [{ email: "carl@example.com", firstName: "Carl", source: "csv" }]);
    expect(res.updated).toBe(1);
    expect((await aud.getSubscriber(carl.id)).status).toBe("unsubscribed");
    await expect(aud.updateSubscriber(admin, carl.id, { status: "subscribed" })).rejects.toThrow(/Only they/);
  });

  it("imports CRM leads and a Contacts group as the person importing", async () => {
    const r1 = await sources.importFrom(admin, audienceId, { kind: "crm_leads", params: { status: "new" }, keepSynced: true });
    expect(r1.added).toBe(1);
    expect(asked.at(-1)).toEqual({ path: "/api/leads?status=new", who: admin.email });
    const r2 = await sources.importFrom(admin, audienceId, { kind: "contacts_group", params: { group: "11111111-1111-4111-8111-111111111111", groupName: "Partners" } });
    expect(r2.added).toBe(1);
    const lena = (await aud.listSubscribers(audienceId, { q: "lena" })).items[0];
    expect(lena).toMatchObject({ company: "LeadCo", source: "crm_lead", tags: ["lead"], fields: { lead_score: "80", lead_status: "new" } });
    expect((await aud.listSubscribers(audienceId, { tag: "partners" })).total).toBe(1);
    expect(await sources.listSources(audienceId)).toHaveLength(1);
  });

  it("counts a segment", async () => {
    const rules = segments.cleanRules({ match: "all", conditions: [{ field: "tag", op: "is", value: "vip" }] });
    expect(await segments.countMatching(audienceId, rules)).toBe(2);
  });

  let campaignId = "";
  let annToken = "";

  it("sends a campaign to subscribed, unsuppressed people once each, with unsubscribe headers", async () => {
    const [c] = await camp.listCampaigns();
    campaignId = c.id;
    await camp.updateCampaign(admin, c.id, { blocks: [{ type: "text", text: "Read [this](https://site.example/p?e={{email}})" }] });
    refuse.add("gus@group.example");
    await camp.schedule(admin, c.id, null);
    await sender.tick();
    await sender.tick();
    const to = sent.map((m) => m.to).sort();
    expect(to).toEqual(["ann@example.com", "bob@example.com", "lena@lead.example"]);
    const ann = sent.find((m) => m.to === "ann@example.com")!;
    expect(ann.subject).toBe("Hi Ann");
    annToken = tokenOf(ann);
    expect(ann.headers["List-Unsubscribe"]).toBe(`<https://campaigns.example.com/u/${annToken}>`);
    expect(ann.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(ann.html).toContain(`https://campaigns.example.com/t/c/${annToken}/0`);
    expect(ann.html).toContain(`https://campaigns.example.com/t/o/${annToken}`);
    expect(ann.html).toContain("1 Main St");
    const done = await camp.getCampaign(c.id);
    expect(done.status).toBe("sent");
    expect(done.stats).toMatchObject({ recipients: 4, sent: 3, bounced: 1 });
    // The refusal was a hard bounce: cleaned and suppressed.
    const [sup] = await q<{ reason: string }>("SELECT reason FROM suppressions WHERE email = 'gus@group.example'");
    expect(sup.reason).toBe("bounced");
  });

  it("tracks opens and clicks, and redirects only to the email's own links", async () => {
    await tracking.recordOpen(annToken);
    await tracking.recordOpen(annToken);
    expect(await tracking.recordClick(annToken, 0)).toBe("https://site.example/p?e=ann%40example.com");
    expect(await tracking.recordClick(annToken, 7)).toBeNull();
    expect(await tracking.recordClick("nottherightoneatall123", 0)).toBeNull();
    const s = await camp.stats(campaignId);
    expect(s).toMatchObject({ opens: 2, uniqueOpens: 1, clicks: 1, uniqueClicks: 1 });
    const rep = await camp.report(campaignId, { filter: "clicked" });
    expect(rep.links).toEqual([{ url: "https://site.example/p?e={{email}}", clicks: 1, people: 1 }]);
    expect(rep.recipients.map((r) => r.email)).toEqual(["ann@example.com"]);
  });

  it("unsubscribes from one list, or everything, and can be undone", async () => {
    const d = (await tracking.findDelivery(annToken))!;
    await tracking.unsubscribe(d, false);
    const ann = (await aud.listSubscribers(audienceId, { q: "ann" })).items[0];
    expect(ann.status).toBe("unsubscribed");
    expect(ann.suppressed).toBeNull();
    expect((await camp.stats(campaignId)).unsubscribes).toBe(1);
    expect(await tracking.resubscribe((await tracking.findDelivery(annToken))!)).toBe(true);
    expect((await aud.getSubscriber(ann.id)).status).toBe("subscribed");
    await tracking.unsubscribe((await tracking.findDelivery(annToken))!, true);
    expect((await aud.getSubscriber(ann.id)).suppressed).toBe("unsubscribed");
  });

  it("skips people who left after the send was queued", async () => {
    const c = await camp.duplicateCampaign(admin, campaignId);
    sent.length = 0;
    await q("UPDATE campaigns SET status = 'scheduled', scheduled_at = now() WHERE id = $1", [c.id]);
    await sender.startCampaign(c.id);
    const bob = (await aud.listSubscribers(audienceId, { q: "bob" })).items[0];
    await aud.updateSubscriber(admin, bob.id, { status: "unsubscribed" });
    await sender.tick();
    expect(sent.map((m) => m.to)).toEqual(["lena@lead.example"]);
    expect((await camp.getCampaign(c.id)).stats).toMatchObject({ sent: 1, skipped: 1 });
  });

  it("records bounces and complaints that come back later", async () => {
    const lena = sent[0];
    expect(await tracking.recordComplaint(tokenOf(lena))).toBe(true);
    const [sup] = await q<{ reason: string }>("SELECT reason FROM suppressions WHERE email = 'lena@lead.example'");
    expect(sup.reason).toBe("complained");
  });

  it("pauses, resumes and cancels a send", async () => {
    const c = await camp.createCampaign(admin, { name: "Big", audienceId, subject: "S" });
    await aud.upsertMany(admin.email, audienceId, [{ email: "dee@example.com", source: "csv" }]);
    await q("UPDATE campaigns SET status = 'scheduled', scheduled_at = now() WHERE id = $1", [c.id]);
    await sender.startCampaign(c.id);
    await camp.pause(admin, c.id);
    sent.length = 0;
    await sender.tick();
    expect(sent).toHaveLength(0);
    await camp.cancel(admin, c.id);
    expect((await camp.getCampaign(c.id)).stats).toMatchObject({ queued: 0, skipped: 1 });
  });

  it("runs a welcome automation once for new subscribers", async () => {
    const a = await autos.createAutomation(admin, { name: "Welcome", audienceId, delayMinutes: 0, subject: "Welcome {{first_name}}", blocks: [{ type: "text", text: "Hi" }] });
    await autos.updateAutomation(admin, a.id, { active: true });
    sent.length = 0;
    await aud.addSubscriber(admin, audienceId, { email: "eve@example.com", firstName: "Eve" });
    await sender.tick();
    await sender.tick();
    expect(sent.map((m) => [m.to, m.subject])).toEqual([["eve@example.com", "Welcome Eve"]]);
    expect((await autos.getAutomation(a.id)).sent).toBe(1);
  });

  it("signs people up through the form with double opt-in", async () => {
    await aud.updateAudience(admin, audienceId, { formEnabled: true });
    const f = (await forms.publicForm(audienceId))!;
    sent.length = 0;
    expect(await forms.signup(f, { email: "Ann@example.com", first_name: "Ann" }, "1.2.3.4")).toBe("confirm-sent");
    const link = sent[0].text.match(/\/f\/confirm\/([\w-]+)/)![1];
    const ann = (await aud.listSubscribers(audienceId, { q: "ann@" })).items[0];
    expect(ann.status).toBe("pending");
    expect(await forms.confirm(link)).toMatchObject({ email: "ann@example.com" });
    const back = await aud.getSubscriber(ann.id);
    expect(back.status).toBe("subscribed");
    expect(back.suppressed).toBeNull();
    expect(await forms.confirm(link)).toBeNull();
    expect(forms.rateLimited("9.9.9.9")).toBe(false);
  });

  it("answers suite search and eDiscovery", async () => {
    const res = await searchFor(admin, { query: "Hello" });
    expect(res.results.map((r) => r.kind)).toContain("campaign");
    const found = await ed.search(parseSearch({ query: "this", custodians: [admin.email] }, ed.KINDS));
    expect(found.hits.length).toBeGreaterThan(0);
    const exp = await ed.exportItems([found.hits[0].id]);
    expect(exp.items[0].app).toBe("campaigns");
  });
});
