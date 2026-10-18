import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SmsProvider } from "../lib/provider";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.SMS_DEFAULT_COUNTRY_CODE = "1";
process.env.TWILIO_AUTH_TOKEN = "hook-token";
process.env.SUITE_DOMAIN = "example.org";
process.env.SMS_SEND_INTERVAL_MS = "0";

const ann = { email: "ann@example.com", name: "Ann", subject: "a" };

/** Records what would have been texted; numbers in `failing` fail. */
const outbox: { to: string; body: string }[] = [];
const failing = new Set<string>();
let n = 0;
const fake: SmsProvider = {
  name: "fake",
  configured: true,
  from: "+15550000000",
  async send(to, body) {
    if (failing.has(to)) return { ok: false, error: "carrier said no" };
    outbox.push({ to, body });
    return { ok: true, id: `SM${++n}`, status: "queued" };
  },
};

describe.skipIf(!url)("sms", async () => {
  const s = await import("../lib/sms");
  const { setProvider, twilioSignature } = await import("../lib/provider");
  const { searchFor } = await import("../lib/search");
  const { q, db } = await import("../lib/db");
  const inbound = await import("../app/api/webhooks/twilio/inbound/route");
  const statusHook = await import("../app/api/webhooks/twilio/status/route");

  const hook = (route: { POST: (r: Request) => Promise<Response> }, path: string, params: Record<string, string>, sign = true) =>
    route.POST(
      new Request(`http://sms:3920${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          ...(sign ? { "x-twilio-signature": twilioSignature("hook-token", `https://sms.example.org${path}`, params) } : {}),
        },
        body: new URLSearchParams(params).toString(),
      }),
    );

  beforeAll(async () => {
    setProvider(fake);
    await q("SELECT 1");
    await q("TRUNCATE contacts, campaigns, messages RESTART IDENTITY CASCADE");
  });
  afterAll(async () => {
    setProvider(undefined);
    await db().close();
  });

  it("keeps contacts with clean numbers and tags", async () => {
    const c = await s.createContact({ phone: "(555) 111-0001", name: "Bo", tags: "VIP, News" });
    expect(c).toMatchObject({ phone: "+15551110001", name: "Bo", tags: ["vip", "news"], opted_out: false });
    await expect(s.createContact({ phone: "555-111-0001" })).rejects.toMatchObject({ code: "23505" });
    await expect(s.createContact({ phone: "12" })).rejects.toThrow(/phone number/);
    expect((await s.updateContact(c.id, { tags: "vip" })).tags).toEqual(["vip"]);
  });

  it("imports CSV, adding to existing contacts without touching opt-outs", async () => {
    const [bo] = await s.listContacts("bo");
    await s.updateContact(bo.id, { optedOut: true });
    const r = await s.importContacts('phone,name,tags\n5551110001,,"news"\n+1 555 111 0002,Cy,"vip, news"\n5551110003,Di,news\nnot a number,X\n');
    expect(r).toEqual({ created: 2, updated: 1, skipped: 1 });
    const all = await s.listContacts();
    expect(all.find((c) => c.phone === "+15551110001")).toMatchObject({ name: "Bo", opted_out: true });
    expect(all.find((c) => c.phone === "+15551110001")!.tags.sort()).toEqual(["news", "vip"]);
    expect((await s.listContacts("news")).length).toBe(3);
    await s.updateContact(bo.id, { optedOut: false });
  });

  it("sends one text and refuses numbers that opted out", async () => {
    const m = await s.sendOne(ann, { to: "5551110002", body: " Hello Cy " });
    expect(m).toMatchObject({ phone: "+15551110002", direction: "out", body: "Hello Cy", status: "queued", sent_by: ann.email });
    expect(outbox.at(-1)).toEqual({ to: "+15551110002", body: "Hello Cy" });
    // A new number becomes a contact.
    await s.sendOne(ann, { to: "5551110009", body: "Hi" });
    expect((await s.listContacts("5551110009")).length).toBe(1);
    failing.add("+15551110009");
    await expect(s.sendOne(ann, { to: "5551110009", body: "Again" })).rejects.toMatchObject({ status: 502 });
    failing.clear();
    await expect(s.sendOne(ann, { to: "5551110002", body: "" })).rejects.toThrow(/Write a message/);
    await expect(s.sendOne(ann, { to: "5551110002", body: "x".repeat(1601) })).rejects.toThrow(/1600/);
  });

  it("takes texts in only when Twilio signed them, and honours STOP and START", async () => {
    const path = "/api/webhooks/twilio/inbound";
    const forged = await hook(inbound, path, { From: "+15551110002", Body: "STOP", MessageSid: "SMin0" }, false);
    expect(forged.status).toBe(403);
    expect((await s.listContacts("5551110002"))[0].opted_out).toBe(false);

    const res = await hook(inbound, path, { From: "+15551110002", Body: "Stop", MessageSid: "SMin1" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/xml");
    expect(await res.text()).toContain("<Response></Response>");
    expect((await s.listContacts("5551110002"))[0].opted_out).toBe(true);
    await expect(s.sendOne(ann, { to: "5551110002", body: "Still there?" })).rejects.toMatchObject({ status: 409 });

    // Twilio retries the same text: saved once.
    await hook(inbound, path, { From: "+15551110002", Body: "Stop", MessageSid: "SMin1" });
    await hook(inbound, path, { From: "+15551110002", Body: "START", MessageSid: "SMin2" });
    expect((await s.listContacts("5551110002"))[0].opted_out).toBe(false);

    // A stranger texting in becomes a contact, and the text is unread until opened.
    await hook(inbound, path, { From: "+15557770000", Body: "Do you deliver?", MessageSid: "SMin3" });
    const convs = await s.conversations();
    expect(convs[0]).toMatchObject({ phone: "+15557770000", last_body: "Do you deliver?", unread: 1 });
    const t = await s.thread("+15557770000");
    expect(t.messages.map((m) => m.body)).toEqual(["Do you deliver?"]);
    expect((await s.conversations())[0].unread).toBe(0);
    expect((await s.thread("5551110002")).messages.filter((m) => m.direction === "in").map((m) => m.body)).toEqual(["Stop", "START"]);
  });

  it("follows delivery updates without going backwards", async () => {
    const m = await s.sendOne(ann, { to: "5551110003", body: "Track me" });
    const [{ provider_id }] = await q<{ provider_id: string }>("SELECT provider_id FROM messages WHERE id = $1", [m.id]);
    const path = "/api/webhooks/twilio/status";
    expect((await hook(statusHook, path, { MessageSid: provider_id, MessageStatus: "delivered" }, false)).status).toBe(403);
    expect((await hook(statusHook, path, { MessageSid: provider_id, MessageStatus: "delivered" })).status).toBe(204);
    await hook(statusHook, path, { MessageSid: provider_id, MessageStatus: "sent" });
    const [{ status }] = await q<{ status: string }>("SELECT status FROM messages WHERE id = $1", [m.id]);
    expect(status).toBe("delivered");
  });

  it("sends a campaign to a tag, skipping people who opt out on the way", async () => {
    expect(await s.audience("news")).toBe(3);
    await expect(s.createCampaign(ann, { name: "Nobody", body: "x", tag: "nosuchtag" })).rejects.toThrow(/No one tagged/);
    const before = outbox.length;
    const c = await s.createCampaign(ann, { name: "Sale", body: "20% off today", tag: "News" });
    // createCampaign started the background sender; wait for it, then check.
    await s.kick();
    const done = await s.getCampaign(c.id);
    expect(done).toMatchObject({ name: "Sale", tag: "news", recipients: 3, status: "done", pending: 0, sent: 3, failed: 0, skipped: 0 });
    expect(outbox.slice(before).map((o) => o.to).sort()).toEqual(["+15551110001", "+15551110002", "+15551110003"]);

    // Opted out after the campaign was queued: skipped, not texted.
    const c2 = await s.createCampaign(ann, { name: "Again", body: "Last chance", tag: "news" });
    await q("UPDATE contacts SET opted_out = true WHERE phone = '+15551110003'");
    await s.kick();
    expect(await s.getCampaign(c2.id)).toMatchObject({ status: "done", sent: 2, skipped: 1 });
    // Queued campaign texts don't show as conversations until sent; all are sent now.
    expect((await s.listCampaigns()).map((x) => x.name)).toEqual(["Again", "Sale"]);
  });

  it("finishes a campaign a restart interrupted", async () => {
    const c = await s.createCampaign(ann, { name: "Resume", body: "Hi again", tag: "vip" });
    await s.kick();
    // Pretend a restart happened mid-send.
    await q("UPDATE messages SET status = 'claimed' WHERE campaign_id = $1", [c.id]);
    await q("UPDATE campaigns SET status = 'sending', finished_at = NULL WHERE id = $1", [c.id]);
    await s.resume();
    await s.kick();
    expect(await s.getCampaign(c.id)).toMatchObject({ status: "done", pending: 0 });
  });

  it("answers suite search", async () => {
    const r = await searchFor(ann, { query: "deliver" });
    expect(r.app).toBe("sms");
    expect(r.results.map((x) => [x.kind, x.title])).toEqual([["message", "From +15557770000"]]);
    const c = await searchFor(ann, { query: "Cy", kinds: ["contact"] });
    expect(c.results.map((x) => x.title)).toEqual(["Cy"]);
    expect(c.results[0].url).toBe("/?phone=%2B15551110002");
  });
});
