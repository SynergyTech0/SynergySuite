import { appUrl } from "@synergy/config";
import { q, tx } from "./db";
import { type RingInfo, notify } from "./events";
import { AGENT_IDENTITY, type RTCIceServerLike, closeRoom, joinToken, livekitConfig, newRoomName, numberIdentity, removeFromRoom, sip, turnIceServers } from "./livekit";
import { formatNumber } from "./numbers";
import { type Target, nameOf, numberOf, resolveTarget, settingsOf } from "./people";
import { UserError } from "./util";

/**
 * The life of a call. A call is a LiveKit room plus a row here; people in it join from their
 * browser with their email as identity, phone numbers join through LiveKit's SIP service as
 * tel:<number>. Ringing, answering, forwarding, transfers and voicemail are decided here; the
 * media server only carries the audio.
 *
 *   ringing ──answer──▶ active ──everyone but one leaves──▶ ended
 *      │ nobody answers in time / declined / do not disturb
 *      ▼
 *   voicemail (the worker plays the greeting and records) ──▶ ended
 *      or missed, when voicemail is off
 */
export type CallState = "ringing" | "active" | "voicemail" | "ended" | "missed" | "declined" | "failed";

export type CallRow = {
  id: string; room: string; direction: "internal" | "inbound" | "outbound";
  from_email: string | null; from_number: string | null; from_name: string;
  to_email: string | null; to_number: string | null; state: CallState; ring_deadline: Date | null;
  answered_by: string | null; answered_at: Date | null; ended_at: Date | null; end_reason: string | null;
  agent_at: Date | null; meeting: boolean; meeting_leg: boolean; created_at: Date;
};

export type PartyRow = {
  id: string; call_id: string; email: string | null; number: string | null; identity: string;
  role: "caller" | "callee" | "added"; state: "ringing" | "joined" | "left" | "declined" | "missed" | "failed";
  invited_by: string | null;
};

export type Me = { email: string; name: string };

/** How long a phone number is given to answer before we give up on it. */
const NUMBER_RING_SECONDS = 45;
const ENDED: CallState[] = ["ended", "missed", "declined", "failed"];

export async function getCall(id: string): Promise<CallRow> {
  const [c] = await q<CallRow>("SELECT * FROM calls WHERE id = $1", [id]);
  if (!c) throw new UserError("That call is over", 404);
  return c;
}

/** The latest call in a room (a meeting room can hold several phone legs over time). */
export async function callInRoom(room: string): Promise<CallRow | null> {
  const [c] = await q<CallRow>("SELECT * FROM calls WHERE room = $1 ORDER BY created_at DESC LIMIT 1", [room]);
  return c ?? null;
}

export async function partiesOf(callId: string): Promise<PartyRow[]> {
  return q<PartyRow>("SELECT * FROM parties WHERE call_id = $1 ORDER BY created_at", [callId]);
}

/** People on a call who should hear about it (not phone numbers). */
async function peopleOn(callId: string): Promise<string[]> {
  const rows = await q<{ email: string }>("SELECT DISTINCT email FROM parties WHERE call_id = $1 AND email IS NOT NULL", [callId]);
  return rows.map((r) => r.email);
}

function ringInfo(c: CallRow, via: string | null): RingInfo {
  return {
    id: c.id, room: c.room, direction: c.direction,
    from: c.from_email ?? c.from_number ?? "",
    fromName: c.from_name || (c.from_number ? formatNumber(c.from_number) : c.from_email ?? ""),
    fromNumber: c.from_number, toNumber: c.to_number, via,
  };
}

async function addParty(callId: string, p: { email?: string | null; number?: string | null; identity: string; role: PartyRow["role"]; state?: PartyRow["state"]; invitedBy?: string | null }) {
  await q(
    `INSERT INTO parties (call_id, email, number, identity, role, state, invited_by, joined_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $6 = 'joined' THEN now() END)
     ON CONFLICT (call_id, identity) DO UPDATE SET state = EXCLUDED.state, role = EXCLUDED.role, invited_by = EXCLUDED.invited_by,
       left_at = NULL, joined_at = CASE WHEN EXCLUDED.state = 'joined' THEN now() ELSE parties.joined_at END`,
    [callId, p.email ?? null, p.number ?? null, p.identity, p.role, p.state ?? "ringing", p.invitedBy ?? null],
  );
}

/**
 * Calls a phone number into the room through `fromNumber`'s trunk. Resolves when it is answered
 * or has failed; callers don't wait for it.
 */
async function dialNumber(c: CallRow, number: string, from: { number: string; outboundId: string | null }, role: PartyRow["role"], invitedBy: string | null): Promise<void> {
  if (!from.outboundId) throw new UserError("Your number's trunk can't make calls out yet. Ask a phone admin to check it.", 409);
  const identity = numberIdentity(number);
  await addParty(c.id, { number, identity, role, invitedBy });
  void sip()
    .createSipParticipant(from.outboundId, number, c.room, {
      fromNumber: from.number,
      participantIdentity: identity,
      participantName: formatNumber(number),
      playDialtone: role === "added" ? false : true,
      ringingTimeout: NUMBER_RING_SECONDS,
      waitUntilAnswered: true,
      krispEnabled: true,
    })
    .then(() => numberAnswered(c.id, identity))
    .catch((e) => numberFailed(c.id, identity, String((e as Error)?.message ?? e)));
}

/** A phone number we called picked up. */
export async function numberAnswered(callId: string, identity: string): Promise<void> {
  const won = await tx(async (tq) => {
    const [p] = await tq<PartyRow>("UPDATE parties SET state = 'joined', joined_at = now() WHERE call_id = $1 AND identity = $2 AND state = 'ringing' RETURNING *", [callId, identity]);
    if (!p) return null;
    const [c] = await tq<CallRow>(
      `UPDATE calls SET state = 'active', answered_by = $2, answered_at = now(), ring_deadline = NULL
       WHERE id = $1 AND state = 'ringing' RETURNING *`,
      [callId, identity],
    );
    return { party: p, call: c ?? null };
  });
  if (!won) {
    // Answered after someone else did, or after the call ended: hang it up.
    const c = await getCall(callId).catch(() => null);
    if (c) await removeFromRoom(c.room, identity);
    return;
  }
  if (won.call) await answeredElsewhere(won.call, identity);
  const c = won.call ?? (await getCall(callId));
  await notify(await peopleOn(callId), { type: "call", callId, state: c.state });
}

/** A phone number we called didn't pick up, was busy, or the trunk refused the call. */
export async function numberFailed(callId: string, identity: string, why: string): Promise<void> {
  const [p] = await q<PartyRow>(
    "UPDATE parties SET state = 'failed', left_at = now() WHERE call_id = $1 AND identity = $2 AND state = 'ringing' RETURNING *",
    [callId, identity],
  );
  if (!p) return;
  const c = await getCall(callId);
  const reason = /busy|486/i.test(why) ? "Busy" : /timeout|no.?answer|408|480/i.test(why) ? "No answer" : "The call didn't go through";
  if (!/busy|timeout|no.?answer|408|480/i.test(why)) console.error("[phone] call to a number failed", why.slice(0, 300));
  if (p.role === "added") {
    await notify(p.invited_by ?? [], { type: "call", callId, state: c.state, detail: `${formatNumber(p.number)}: ${reason}` });
    return;
  }
  // The number was the one being called (a call out, a forward or a transfer).
  const others = await q<{ n: string }>("SELECT count(*) AS n FROM parties WHERE call_id = $1 AND role <> 'caller' AND state = 'ringing'", [callId]);
  if (c.state === "ringing" && Number(others[0].n) === 0) await finish(c, c.direction === "outbound" ? "failed" : "missed", reason);
}

/** Everyone else still ringing for this call stops: someone answered. */
async function answeredElsewhere(c: CallRow, by: string): Promise<void> {
  const stopped = await q<PartyRow>(
    `UPDATE parties SET state = 'missed', left_at = now() WHERE call_id = $1 AND role = 'callee' AND state = 'ringing' AND identity <> $2 RETURNING *`,
    [c.id, by],
  );
  for (const p of stopped) {
    if (p.email) await notify(p.email, { type: "ring-stop", callId: c.id, reason: "answered" });
    else await removeFromRoom(c.room, p.identity);
  }
}

/**
 * Rings a person for a call, honouring their settings: do not disturb sends it straight to
 * voicemail, forwarding sends it on (one hop, so two people forwarding to each other can't loop),
 * and "also ring" calls their mobile at the same time.
 */
async function ringPerson(c: CallRow, email: string, opts: { role: "callee" | "added"; via: string | null; hop?: number }): Promise<void> {
  const s = await settingsOf(email);
  const hop = opts.hop ?? 0;
  if (opts.role === "callee") {
    if (s.forwardTo && hop === 0) {
      if (s.forwardTo.includes("@")) {
        await q("UPDATE calls SET to_email = $2 WHERE id = $1", [c.id, s.forwardTo]);
        return ringPerson({ ...c, to_email: s.forwardTo }, s.forwardTo, { ...opts, via: email, hop: 1 });
      }
      const mine = await numberOf(email);
      if (mine) return dialNumber(c, s.forwardTo, mine, "callee", email);
      // No number of their own to forward from: ring them here instead.
    }
    if (s.dnd) {
      await toVoicemail(c, email, "Do not disturb");
      return;
    }
    await q("UPDATE calls SET ring_deadline = now() + make_interval(secs => $2) WHERE id = $1 AND state = 'ringing'", [c.id, s.ringSeconds]);
  }
  await addParty(c.id, { email, identity: email, role: opts.role, invitedBy: opts.via });
  await notify(email, { type: "ring", call: ringInfo(c, opts.via) });
  if (opts.role === "callee" && s.alsoRing) {
    const mine = await numberOf(email);
    if (mine?.outboundId) await dialNumber(c, s.alsoRing, mine, "callee", email).catch((e) => console.error("[phone] also-ring failed", e));
  }
}

/** Nobody is going to answer: the call goes to `owner`'s voicemail if they have it, else it is missed. */
export async function toVoicemail(c: CallRow, owner: string | null, reason: string): Promise<void> {
  const stopped = await q<PartyRow>(
    "UPDATE parties SET state = 'missed', left_at = now() WHERE call_id = $1 AND role = 'callee' AND state = 'ringing' RETURNING *",
    [c.id],
  );
  const s = owner ? await settingsOf(owner) : null;
  const vm = Boolean(owner && s?.voicemail);
  const [moved] = await q<CallRow>(
    `UPDATE calls SET state = $2, to_email = COALESCE($3, to_email), ring_deadline = NULL, end_reason = $4,
       ended_at = CASE WHEN $2 = 'missed' THEN now() END
     WHERE id = $1 AND state = 'ringing' RETURNING *`,
    [c.id, vm ? "voicemail" : "missed", owner, reason],
  );
  for (const p of stopped) {
    if (p.email) await notify(p.email, { type: "ring-stop", callId: c.id, reason: vm ? "voicemail" : "missed" });
    else await removeFromRoom(c.room, p.identity);
  }
  if (!moved) return;
  await notify(await peopleOn(c.id), { type: "call", callId: c.id, state: moved.state, detail: reason });
  if (owner) await notify(owner, { type: "history" });
  if (!vm) await closeRoom(c.room);
}

/** The call is over for everyone: the room is closed, which hangs up any phone still in it. */
export async function finish(c: CallRow, state: "ended" | "missed" | "declined" | "failed" = "ended", reason: string | null = null): Promise<void> {
  const [done] = await q<CallRow>(
    `UPDATE calls SET state = CASE WHEN state = 'ringing' AND $2 = 'ended' THEN 'missed' ELSE $2 END,
       end_reason = COALESCE($3, end_reason), ended_at = now(), ring_deadline = NULL
     WHERE id = $1 AND state NOT IN ('ended', 'missed', 'declined', 'failed') RETURNING *`,
    [c.id, state, reason],
  );
  if (!done) return;
  const ringing = await q<PartyRow>(
    "UPDATE parties SET state = 'missed', left_at = now() WHERE call_id = $1 AND state = 'ringing' RETURNING *",
    [c.id],
  );
  for (const p of ringing) if (p.email) await notify(p.email, { type: "ring-stop", callId: c.id, reason: "ended" });
  await q("UPDATE parties SET state = 'left', left_at = now() WHERE call_id = $1 AND state = 'joined'", [c.id]);
  const people = await peopleOn(c.id);
  await notify(people, { type: "call", callId: c.id, state: done.state, detail: done.end_reason ?? undefined });
  await notify(people, { type: "history" });
  // A meeting goes on without the phone line; otherwise the call's room is the call.
  if (!c.meeting_leg) await closeRoom(c.room);
}

export type Started = { call: CallRow; token: string; url: string; room: string; iceServers?: RTCIceServerLike[] };

/** Starts a call from the browser: to a colleague (by email or their number) or to an outside number. */
export async function startCall(me: Me, rawTarget: unknown): Promise<Started> {
  const lk = livekitConfig();
  if (!lk) throw new UserError("Calling isn't set up yet: the media server keys are missing", 503);
  const target: Target = await resolveTarget(rawTarget);
  if (target.kind === "person" && target.email === me.email.toLowerCase()) throw new UserError("That's you");
  const room = newRoomName();
  const mine = await numberOf(me.email);
  let c: CallRow;
  if (target.kind === "person") {
    [c] = await q<CallRow>(
      `INSERT INTO calls (room, direction, from_email, from_number, from_name, to_email, to_number)
       VALUES ($1, 'internal', $2, $3, $4, $5, $6) RETURNING *`,
      [room, me.email, mine?.number ?? null, me.name, target.email, target.viaNumber],
    );
  } else {
    if (!mine) throw new UserError("You need a phone number to call outside the company. Ask a phone admin for one.", 409);
    [c] = await q<CallRow>(
      `INSERT INTO calls (room, direction, from_email, from_number, from_name, to_number)
       VALUES ($1, 'outbound', $2, $3, $4, $5) RETURNING *`,
      [room, me.email, mine.number, me.name, target.number],
    );
  }
  await addParty(c.id, { email: me.email, identity: me.email, role: "caller", state: "joined" });
  const token = await joinToken(room, me);
  try {
    if (target.kind === "person") await ringPerson(c, target.email, { role: "callee", via: null });
    else await dialNumber(c, target.number, mine!, "callee", null);
  } catch (e) {
    await finish(c, "failed", e instanceof UserError ? e.message : "The call didn't go through");
    throw e;
  }
  await notify(me.email, { type: "history" });
  return { call: await getCall(c.id), token, url: lk.wsUrl, room, iceServers: turnIceServers(me.email) };
}

/** Answers a ringing call. The first device or person to answer gets it. */
export async function answer(me: Me, callId: string): Promise<Started> {
  const lk = livekitConfig();
  if (!lk) throw new UserError("Calling isn't set up yet", 503);
  const email = me.email.toLowerCase();
  const out = await tx(async (tq) => {
    const [c] = await tq<CallRow>("SELECT * FROM calls WHERE id = $1 FOR UPDATE", [callId]);
    if (!c) throw new UserError("That call is over", 404);
    const [p] = await tq<PartyRow>("SELECT * FROM parties WHERE call_id = $1 AND identity = $2 FOR UPDATE", [callId, email]);
    if (!p || p.state !== "ringing") {
      throw new UserError(c.state === "active" ? "Answered somewhere else" : "That call is over", 409);
    }
    if (c.state !== "ringing" && !(c.state === "active" && p.role === "added")) throw new UserError("That call is over", 409);
    await tq("UPDATE parties SET state = 'joined', joined_at = now() WHERE id = $1", [p.id]);
    if (c.state === "ringing") {
      const [a] = await tq<CallRow>(
        "UPDATE calls SET state = 'active', answered_by = $2, answered_at = now(), ring_deadline = NULL WHERE id = $1 RETURNING *",
        [callId, email],
      );
      return { call: a, first: true };
    }
    return { call: c, first: false };
  });
  if (out.first) await answeredElsewhere(out.call, email);
  await notify(email, { type: "ring-stop", callId, reason: "answered" });
  await notify(await peopleOn(callId), { type: "call", callId, state: "active" });
  return { call: out.call, token: await joinToken(out.call.room, me), url: lk.wsUrl, room: out.call.room, iceServers: turnIceServers(me.email) };
}

/** Declines a ringing call. When nobody else is ringing for it, it goes to voicemail now. */
export async function decline(me: Me, callId: string): Promise<void> {
  const email = me.email.toLowerCase();
  const [p] = await q<PartyRow>(
    "UPDATE parties SET state = 'declined', left_at = now() WHERE call_id = $1 AND identity = $2 AND state = 'ringing' RETURNING *",
    [callId, email],
  );
  if (!p) return;
  await notify(email, { type: "ring-stop", callId, reason: "declined" });
  const c = await getCall(callId);
  if (p.role === "added") {
    if (p.invited_by) await notify(p.invited_by, { type: "call", callId, state: c.state, detail: `${await nameOf(email)} declined` });
    return;
  }
  const [left] = await q<{ n: string }>("SELECT count(*) AS n FROM parties WHERE call_id = $1 AND role = 'callee' AND state = 'ringing'", [callId]);
  if (c.state === "ringing" && Number(left.n) === 0) await toVoicemail(c, c.to_email, "Declined");
}

/** Someone leaves a call (hangs up, or their connection to the room went away). */
export async function partyLeft(c: CallRow, identity: string): Promise<void> {
  if (identity === AGENT_IDENTITY) return;
  const [p] = await q<PartyRow>(
    // People who are still being rung aren't in the room, so a leave for them is a late echo of an
    // earlier visit (say, added, left, then transferred to). Phone numbers are in the room while
    // they ring, so for them it means the far end hung up or never answered.
    `UPDATE parties SET state = CASE WHEN state = 'ringing' THEN 'missed' ELSE 'left' END, left_at = now()
     WHERE call_id = $1 AND identity = $2 AND (state = 'joined' OR (state = 'ringing' AND number IS NOT NULL)) RETURNING *`,
    [c.id, identity],
  );
  const fresh = await getCall(c.id);
  if (ENDED.includes(fresh.state)) return;
  if (fresh.meeting_leg) {
    // A phone called into a meeting: that phone leaving ends this call, nothing else does.
    if (p?.number) await finish(fresh, "ended");
    return;
  }
  // Opened in Meet: people move between tabs, so only the room closing ends it.
  if (fresh.meeting) return;
  const [{ n }] = await q<{ n: string }>("SELECT count(*) AS n FROM parties WHERE call_id = $1 AND state = 'joined'", [c.id]);
  if (fresh.state === "ringing" && Number(n) === 0) {
    // Nobody is left waiting for an answer.
    await finish(fresh, "missed", "Caller hung up");
    return;
  }
  if (fresh.state === "voicemail") {
    // The caller hung up during the greeting or the message; the worker saves what it has.
    if (p?.role === "caller") await notify(await peopleOn(c.id), { type: "call", callId: c.id, state: "voicemail", detail: "Caller hung up" });
    return;
  }
  const [{ r }] = await q<{ r: string }>("SELECT count(*) AS r FROM parties WHERE call_id = $1 AND state = 'ringing'", [c.id]);
  if (fresh.state === "active" && Number(n) < 2 && Number(r) === 0) await finish(fresh, "ended");
  else await notify(await peopleOn(c.id), { type: "call", callId: c.id, state: fresh.state });
}

export async function hangup(me: Me, callId: string): Promise<void> {
  const c = await getCall(callId);
  await mustBeOn(c, me.email);
  await partyLeft(c, me.email.toLowerCase());
  await removeFromRoom(c.room, me.email.toLowerCase());
}

async function mustBeOn(c: CallRow, email: string): Promise<PartyRow> {
  const [p] = await q<PartyRow>("SELECT * FROM parties WHERE call_id = $1 AND email = $2 ORDER BY created_at DESC LIMIT 1", [c.id, email.toLowerCase()]);
  if (!p) throw new UserError("You aren't on that call", 403);
  return p;
}

/**
 * Brings someone else into a call (a colleague or a phone number). With `transfer`, the person
 * doing it leaves and the call rings the new person as if it had been for them: if they don't
 * answer it goes to their voicemail.
 */
export async function addToCall(me: Me, callId: string, rawTarget: unknown, transfer: boolean): Promise<void> {
  const c = await getCall(callId);
  const p = await mustBeOn(c, me.email);
  if (p.state !== "joined" || c.state !== "active") throw new UserError("You can only do that during a call", 409);
  const target = await resolveTarget(rawTarget);
  if (target.kind === "person" && target.email === me.email.toLowerCase()) throw new UserError("That's you");
  const parties = await partiesOf(callId);
  const already = parties.find((x) => (target.kind === "person" ? x.email === target.email : x.number === target.number) && ["joined", "ringing"].includes(x.state));
  if (already) throw new UserError(already.state === "joined" ? "They're already on the call" : "They're already being called", 409);
  const mine = target.kind === "number" ? await numberOf(me.email) : null;
  if (target.kind === "number" && !mine) throw new UserError("You need a phone number to call outside the company", 409);

  if (!transfer) {
    if (target.kind === "person") await ringPerson(c, target.email, { role: "added", via: me.email });
    else await dialNumber(c, target.number, mine!, "added", me.email);
    return;
  }
  // Transfer: the call rings again, for the new person.
  const [again] = await q<CallRow>(
    `UPDATE calls SET state = 'ringing', answered_by = NULL, answered_at = NULL,
       to_email = $2, to_number = COALESCE($3, to_number)
     WHERE id = $1 AND state = 'active' RETURNING *`,
    [callId, target.kind === "person" ? target.email : null, target.kind === "number" ? target.number : null],
  );
  if (!again) throw new UserError("The call ended", 409);
  // The person transferring is no longer on it; leaving now keeps the count right for partyLeft.
  await q("UPDATE parties SET state = 'left', left_at = now() WHERE id = $1", [p.id]);
  if (target.kind === "person") {
    await ringPerson(again, target.email, { role: "callee", via: me.email });
    // Without a deadline of their own (forwarded to a number), the call still ends if nobody picks up.
    await q("UPDATE calls SET ring_deadline = COALESCE(ring_deadline, now() + interval '45 seconds') WHERE id = $1 AND state = 'ringing'", [callId]);
  } else {
    await dialNumber(again, target.number, mine!, "callee", me.email);
  }
  await notify(await peopleOn(callId), { type: "call", callId, state: "ringing", detail: `Transferred by ${me.name}` });
  await removeFromRoom(c.room, me.email.toLowerCase());
}

/** Opens the call as a Meet meeting: video, screen sharing, chat. Phone numbers stay on it. */
export async function openInMeet(me: Me, callId: string): Promise<{ url: string }> {
  const c = await getCall(callId);
  const p = await mustBeOn(c, me.email);
  if (p.state !== "joined" || c.state !== "active") throw new UserError("You can only do that during a call", 409);
  await q("UPDATE calls SET meeting = true WHERE id = $1", [callId]);
  const url = `${appUrl("meet")}/room/${encodeURIComponent(c.room)}`;
  await notify(await peopleOn(callId), { type: "call", callId, state: "active", detail: `meet:${url}` });
  return { url };
}

/**
 * Calls a phone number into a Meet meeting, for Meet (server to server, PHONE_SVC_TOKEN). The
 * person asking needs a number of their own; the call is billed to it and shows in their history.
 */
export async function dialIntoMeeting(by: Me, room: string, rawNumber: unknown): Promise<CallRow> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(room)) throw new UserError("Bad room name");
  const target = await resolveTarget(rawNumber);
  if (target.kind !== "number") throw new UserError("Invite colleagues to a meeting from Meet; this is for phone numbers");
  const mine = await numberOf(by.email);
  if (!mine) throw new UserError("You need a phone number to call people into a meeting. Ask a phone admin for one.", 409);
  const [c] = await q<CallRow>(
    `INSERT INTO calls (room, direction, from_email, from_number, from_name, to_number, meeting, meeting_leg)
     VALUES ($1, 'outbound', $2, $3, $4, $5, true, true) RETURNING *`,
    [room, by.email.toLowerCase(), mine.number, by.name, target.number],
  );
  await addParty(c.id, { email: by.email, identity: by.email.toLowerCase(), role: "caller", state: "left" });
  await dialNumber(c, target.number, mine, "callee", null);
  await notify(by.email, { type: "history" });
  return c;
}

/** A call came in from outside on one of our numbers (LiveKit's SIP service put it in a room). */
export async function inbound(room: string, sipIdentity: string, attrs: Record<string, string>, displayName: string): Promise<void> {
  const existing = await callInRoom(room);
  if (existing) return; // the webhook can arrive twice
  const called = attrs["sip.trunkPhoneNumber"] || attrs["sip.calledNumber"] || "";
  const caller = attrs["sip.phoneNumber"] || "";
  const toNumber = called.startsWith("+") ? called : called ? `+${called.replace(/\D/g, "")}` : null;
  const fromNumber = caller ? (caller.startsWith("+") ? caller : `+${caller.replace(/\D/g, "")}`) : null;
  const owner = toNumber ? (await q<{ assigned_to: string | null }>("SELECT assigned_to FROM numbers WHERE number = $1", [toNumber]))[0]?.assigned_to ?? null : null;
  const fromName = displayName && displayName !== caller ? displayName : "";
  const [c] = await q<CallRow>(
    `INSERT INTO calls (room, direction, from_number, from_name, to_email, to_number)
     VALUES ($1, 'inbound', $2, $3, $4, $5) RETURNING *`,
    [room, fromNumber, fromName, owner, toNumber],
  );
  await addParty(c.id, { number: fromNumber, identity: sipIdentity, role: "caller", state: "joined" });
  if (!owner) {
    await finish(c, "failed", toNumber ? `Nobody has ${formatNumber(toNumber)}` : "No number dialled");
    return;
  }
  await ringPerson(c, owner, { role: "callee", via: null });
  await notify(owner, { type: "history" });
}

/** For a person signing in on another tab: anything ringing for them right now. */
export async function ringingFor(email: string): Promise<RingInfo[]> {
  const rows = await q<CallRow & { invited_by: string | null }>(
    `SELECT c.*, p.invited_by FROM parties p JOIN calls c ON c.id = p.call_id
     WHERE p.email = $1 AND p.state = 'ringing' AND (c.state = 'ringing' OR (c.state = 'active' AND p.role = 'added'))
       AND p.created_at > now() - interval '2 minutes'
     ORDER BY p.created_at`,
    [email.toLowerCase()],
  );
  return rows.map((r) => ringInfo(r, r.invited_by));
}
