import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PolicyClient, SearchResponse } from "@synergy/compliance";
import type { SearchResults } from "@synergy/search";
import { ownDatabase } from "./helpers";

// eDiscovery (Admin center), suite search (the signed-in person), legal hold and retention,
// against a real Postgres when TEST_DATABASE_URL is set.
const base = process.env.TEST_DATABASE_URL;
process.env.COMPLIANCE_TOKEN = "test-token";
process.env.PROXY_SHARED_SECRET = "gateway-secret";
process.env.LIVEKIT_API_KEY = "key";
process.env.LIVEKIT_API_SECRET = "secretsecretsecretsecretsecretsecret";

vi.mock("../lib/livekit", async (orig) => ({
  ...(await orig<typeof import("../lib/livekit")>()),
  closeRoom: async () => {},
  removeFromRoom: async () => {},
}));
let incoming = new Headers();
vi.mock("next/headers", () => ({ headers: async () => incoming }));

const alice = { email: "alice@example.com", name: "Alice" };
const bob = { email: "bob@example.com", name: "Bob" };
const carol = { email: "carol@example.com", name: "Carol" };

const held = new Set<string>();
const retention: Record<string, number> = {};
const fakePolicy: PolicyClient = {
  onHold: async (e) => held.has(e),
  retention: async () => [],
  retentionDays: async (kind) => retention[kind] ?? null,
  invalidate() {},
};

describe.skipIf(!base)("phone compliance and search", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base, "compliance");
  const calls = await import("../lib/calls");
  const { encodeWav, tone } = await import("../lib/audio");
  const { deleteVoicemail, voicemailsFor } = await import("../lib/history");
  const { sweepRetention } = await import("../lib/ediscovery");
  const { q, db, ready } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  const searchRoute = await import("../app/api/compliance/search/route");
  const exportRoute = await import("../app/api/compliance/export/route");
  const suiteRoute = await import("../app/api/search/route");
  await ready();

  const call = (route: { POST: (req: Request) => Promise<Response> }, body: unknown, token: string | null = "test-token") =>
    route.POST(
      new Request("http://phone/api/compliance", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }),
    );
  const search = async (body: Record<string, unknown>) => {
    const res = await call(searchRoute, body);
    expect(res.status).toBe(200);
    return (await res.json()) as SearchResponse;
  };
  const suite = async (email: string, body: Record<string, unknown>) => {
    incoming = new Headers({ "x-auth-request-email": email, "x-proxy-auth-secret": "gateway-secret" });
    const res = await suiteRoute.POST(new Request("http://phone/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect(res.status).toBe(200);
    return (await res.json()) as SearchResults;
  };

  let talk: string;
  let vm: string;
  let old: string;

  beforeAll(async () => {
    setPolicy(fakePolicy);
    await q("TRUNCATE calls, voicemails, settings, people CASCADE");
    const one = await calls.startCall(alice, "bob@example.com");
    await calls.answer(bob, one.call.id);
    await calls.hangup(bob, one.call.id);
    talk = one.call.id;
    const two = await calls.startCall(carol, "bob@example.com");
    await calls.decline(bob, two.call.id);
    const wav = encodeWav({ rate: 16000, samples: tone([300], 2000, 16000) });
    [{ id: vm }] = await q<{ id: string }>(
      `INSERT INTO voicemails (call_id, owner, from_email, from_name, audio, duration_ms, transcript)
       VALUES ($1, $2, $3, 'Carol', $4, 2000, 'Hi Bob, the quarterly budget numbers are ready') RETURNING id`,
      [two.call.id, bob.email, carol.email, wav],
    );
    await calls.finish(await calls.getCall(two.call.id), "ended", "Left a voicemail");
    const three = await calls.startCall(carol, "alice@example.com");
    await calls.hangup(carol, three.call.id);
    old = three.call.id;
    await q("UPDATE calls SET created_at = '2020-01-01T12:00:00Z' WHERE id = $1", [old]);
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("answers only the Admin center's token", async () => {
    expect((await call(searchRoute, {}, null)).status).toBe(401);
    expect((await call(exportRoute, { ids: [] }, "nope")).status).toBe(401);
    expect((await call(searchRoute, { to: 5 })).status).toBe(400);
  });

  it("finds calls and voicemail by person, words, kind and date", async () => {
    const all = await search({});
    expect(all.total).toBe(4);
    const forAlice = await search({ custodians: [alice.email] });
    expect(forAlice.hits.map((h) => h.id).sort()).toEqual([`call:${old}`, `call:${talk}`].sort());
    const budget = await search({ query: "budget" });
    expect(budget.hits).toEqual([expect.objectContaining({ id: `vm:${vm}`, kind: "voicemail", owner: bob.email, participants: [carol.email] })]);
    expect(budget.hits[0].snippet).toContain("quarterly budget");
    expect((await search({ kinds: ["voicemail"] })).total).toBe(1);
    expect((await search({ to: "2020-12-31" })).hits.map((h) => h.id)).toEqual([`call:${old}`]);
  });

  it("exports a call with who was on it, and a voicemail with its recording", async () => {
    const { items } = await (await call(exportRoute, { ids: [`vm:${vm}`, `call:${talk}`, "call:nope"] })).json();
    expect(items.map((i: { id: string }) => i.id)).toEqual([`vm:${vm}`, `call:${talk}`]);
    expect(items[0].text).toContain("budget");
    expect(items[0].attachments[0]).toMatchObject({ name: "voicemail.wav", type: "audio/wav" });
    expect(items[1].metadata).toMatchObject({ direction: "internal", answeredBy: bob.email });
    expect(items[1].metadata.parties.map((p: { email: string; role: string }) => `${p.email}:${p.role}`)).toEqual([`${alice.email}:caller`, `${bob.email}:callee`]);
  });

  it("lets people search their own calls and voicemail only", async () => {
    const bobs = await suite(bob.email, { query: "budget" });
    expect(bobs.results.map((r) => r.id)).toEqual([`vm:${vm}`]);
    expect((await suite(alice.email, { query: "budget" })).results).toEqual([]);
    const carols = await suite(carol.email, { query: "bob", kinds: ["call"] });
    expect(carols.results.map((r) => r.title)).toEqual(["Call to Bob"]);
  });

  it("keeps deleted voicemail under a hold, and retention spares the held", async () => {
    held.add(bob.email);
    await deleteVoicemail(bob.email, vm);
    expect(await voicemailsFor(bob.email)).toEqual([]);
    expect((await search({ query: "budget" })).hits[0]).toMatchObject({ id: `vm:${vm}`, deleted: true });
    expect((await suite(bob.email, { query: "budget" })).results).toEqual([]);

    retention.call = 365;
    held.add(carol.email);
    expect(await sweepRetention()).toBe(0);
    held.delete(carol.email);
    expect(await sweepRetention()).toBe(1);
    expect((await search({})).hits.map((h) => h.id)).not.toContain(`call:${old}`);
  });
});
