import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { noPolicy, ownDatabase } from "./helpers";

// The call state machine against a real Postgres (TEST_DATABASE_URL), with the media server
// replaced by a stand-in: rooms, SIP calls and hang-ups are recorded instead of sent.
const base = process.env.TEST_DATABASE_URL;
process.env.LIVEKIT_API_KEY = "key";
process.env.LIVEKIT_API_SECRET = "secretsecretsecretsecretsecretsecret";
process.env.LIVEKIT_API_URL = "http://livekit.test";

const lk = vi.hoisted(() => ({
  closed: [] as string[],
  removed: [] as string[],
  dialled: [] as { trunk: string; number: string; room: string; from: string }[],
  dial: null as null | ((n: string) => Promise<unknown>),
}));
vi.mock("../lib/livekit", async (orig) => ({
  ...(await orig<typeof import("../lib/livekit")>()),
  closeRoom: async (room: string) => void lk.closed.push(room),
  removeFromRoom: async (room: string, identity: string) => void lk.removed.push(`${room}/${identity}`),
  sip: () => ({
    createSipParticipant: async (trunk: string, number: string, room: string, o: { fromNumber: string }) => {
      lk.dialled.push({ trunk, number, room, from: o.fromNumber });
      return lk.dial ? lk.dial(number) : new Promise(() => {});
    },
  }),
}));

const alice = { email: "alice@example.com", name: "Alice" };
const bob = { email: "bob@example.com", name: "Bob" };
const carol = { email: "carol@example.com", name: "Carol" };
const settle = () => new Promise((r) => setTimeout(r, 30));

describe.skipIf(!base)("calls", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base, "calls");
  const calls = await import("../lib/calls");
  const { handleWebhook } = await import("../lib/webhook");
  const { historyFor } = await import("../lib/history");
  const { saveSettings } = await import("../lib/people");
  const { q, db, ready } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  setPolicy(noPolicy);
  await ready();

  const parties = async (id: string) =>
    Object.fromEntries((await calls.partiesOf(id)).map((p) => [p.email ?? p.number, `${p.role}:${p.state}`]));
  const left = (room: string, identity: string) => handleWebhook({ event: "participant_left", room: { name: room }, participant: { identity } });

  beforeEach(async () => {
    await q("TRUNCATE calls, voicemails, settings, people, numbers, trunks CASCADE");
    lk.closed.length = lk.removed.length = lk.dialled.length = 0;
    lk.dial = null;
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("rings, is answered, and ends when one side hangs up", async () => {
    const { call, token } = await calls.startCall(alice, "bob@example.com");
    expect(token).toBeTruthy();
    expect(call.state).toBe("ringing");
    expect(await parties(call.id)).toEqual({ [alice.email]: "caller:joined", [bob.email]: "callee:ringing" });
    expect((await calls.ringingFor(bob.email)).map((r) => r.id)).toEqual([call.id]);

    await calls.answer(bob, call.id);
    expect((await calls.getCall(call.id)).state).toBe("active");
    await expect(calls.answer(bob, call.id)).rejects.toThrow(/Answered somewhere else/);

    await calls.hangup(alice, call.id);
    const done = await calls.getCall(call.id);
    expect(done.state).toBe("ended");
    expect(lk.closed).toContain(call.room);
    const [h] = await historyFor(bob.email);
    expect(h).toMatchObject({ direction: "in", other: alice.email, missed: false });
  });

  it("is missed when the caller gives up", async () => {
    const { call } = await calls.startCall(alice, "bob@example.com");
    await left(call.room, alice.email);
    expect(await calls.getCall(call.id)).toMatchObject({ state: "missed", end_reason: "Caller hung up" });
    expect((await historyFor(bob.email))[0].missed).toBe(true);
  });

  it("goes to voicemail when declined, on do not disturb, or with nobody answering", async () => {
    const one = await calls.startCall(alice, "bob@example.com");
    await calls.decline(bob, one.call.id);
    expect(await calls.getCall(one.call.id)).toMatchObject({ state: "voicemail", end_reason: "Declined" });

    await saveSettings(bob.email, { dnd: true });
    const two = await calls.startCall(alice, "bob@example.com");
    expect(await calls.getCall(two.call.id)).toMatchObject({ state: "voicemail", end_reason: "Do not disturb" });

    await saveSettings(bob.email, { dnd: false, voicemail: false });
    const three = await calls.startCall(alice, "bob@example.com");
    await calls.toVoicemail(three.call, bob.email, "No answer");
    expect(await calls.getCall(three.call.id)).toMatchObject({ state: "missed", end_reason: "No answer" });
    expect(lk.closed).toContain(three.call.room);
  });

  it("forwards once, so two people forwarding to each other can't loop", async () => {
    await saveSettings(bob.email, { forwardTo: carol.email });
    await saveSettings(carol.email, { forwardTo: bob.email });
    const { call } = await calls.startCall(alice, "bob@example.com");
    expect(await parties(call.id)).toEqual({ [alice.email]: "caller:joined", [carol.email]: "callee:ringing" });
    expect((await calls.getCall(call.id)).to_email).toBe(carol.email);
  });

  it("adds a person and transfers, ignoring a late leave from an earlier visit", async () => {
    const { call } = await calls.startCall(alice, "bob@example.com");
    await calls.answer(bob, call.id);
    await calls.addToCall(bob, call.id, "carol@example.com", false);
    expect((await calls.ringingFor(carol.email))[0]).toMatchObject({ id: call.id, via: bob.email });
    await calls.answer(carol, call.id);
    await calls.hangup(carol, call.id);
    expect((await calls.getCall(call.id)).state).toBe("active");

    await calls.addToCall(bob, call.id, "carol@example.com", true);
    expect((await calls.getCall(call.id)).state).toBe("ringing");
    expect(lk.removed).toContain(`${call.room}/${bob.email}`);
    // The media server reports Carol's first leave only now: she is still being rung.
    await left(call.room, carol.email);
    await left(call.room, bob.email);
    expect(await parties(call.id)).toMatchObject({ [carol.email]: "callee:ringing", [bob.email]: "callee:left" });
    await calls.answer(carol, call.id);
    expect(await calls.getCall(call.id)).toMatchObject({ state: "active", answered_by: carol.email, to_email: carol.email });
  });

  it("calls out through the person's number, and reports a busy line", async () => {
    await q("INSERT INTO trunks (id, name, lk_outbound_id) VALUES ('00000000-0000-0000-0000-000000000001', 'Provider', 'ST_out')");
    await q("INSERT INTO numbers (number, trunk_id, assigned_to) VALUES ('+15550100001', '00000000-0000-0000-0000-000000000001', $1)", [alice.email]);
    await expect(calls.startCall(bob, "+1 555 999 0000")).rejects.toThrow(/need a phone number/);

    lk.dial = async () => { throw new Error("twirp error: 486 Busy Here"); };
    const { call } = await calls.startCall(alice, "(555) 999-0000");
    await settle();
    expect(lk.dialled).toEqual([{ trunk: "ST_out", number: "+15559990000", room: call.room, from: "+15550100001" }]);
    expect(await calls.getCall(call.id)).toMatchObject({ direction: "outbound", state: "failed", end_reason: "Busy" });

    lk.dial = async () => ({});
    const two = await calls.startCall(alice, "+1 555 999 0000");
    await settle();
    expect(await calls.getCall(two.call.id)).toMatchObject({ state: "active", answered_by: "tel:+15559990000" });
    // Calling a colleague's number rings the colleague in the browser, not their phone line.
    const three = await calls.startCall(bob, "+1 555 010 0001");
    expect(three.call).toMatchObject({ direction: "internal", to_email: alice.email });
  });

  it("rings the owner of the number an outside call came in on", async () => {
    await q("INSERT INTO trunks (id, name) VALUES ('00000000-0000-0000-0000-000000000002', 'Provider')");
    await q("INSERT INTO numbers (number, trunk_id, assigned_to) VALUES ('+15550100002', '00000000-0000-0000-0000-000000000002', $1)", [bob.email]);
    const join = (room: string, called: string) =>
      handleWebhook({
        event: "participant_joined",
        room: { name: room },
        participant: { identity: "sip_caller", kind: 3, name: "ACME Corp", attributes: { "sip.trunkPhoneNumber": called, "sip.phoneNumber": "+15557770000" } },
      });
    await join("pstn-one", "+15550100002");
    await join("pstn-one", "+15550100002"); // webhooks can come twice
    const c = (await calls.callInRoom("pstn-one"))!;
    expect(c).toMatchObject({ direction: "inbound", from_number: "+15557770000", from_name: "ACME Corp", to_email: bob.email, state: "ringing" });
    expect((await calls.ringingFor(bob.email))).toHaveLength(1);
    await calls.answer(bob, c.id);
    await left("pstn-one", "sip_caller");
    expect((await calls.getCall(c.id)).state).toBe("ended");

    await join("pstn-two", "+15550109999");
    expect(await calls.callInRoom("pstn-two")).toMatchObject({ state: "failed" });
  });

  it("keeps a call opened in Meet going while people move between tabs", async () => {
    const { call } = await calls.startCall(alice, "bob@example.com");
    await calls.answer(bob, call.id);
    const { url } = await calls.openInMeet(alice, call.id);
    expect(url).toContain(`/room/${call.room}`);
    await left(call.room, alice.email);
    expect((await calls.getCall(call.id)).state).toBe("active");
    await handleWebhook({ event: "room_finished", room: { name: call.room } });
    expect((await calls.getCall(call.id)).state).toBe("ended");
  });
});
