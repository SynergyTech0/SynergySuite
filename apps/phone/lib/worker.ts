import { AccessToken } from "livekit-server-sdk";
import { AiUnavailableError, speechConfig, transcribe } from "@synergy/ai";
import { type Pcm, beep, concat, decodeWav, durationMs, encodeWav, level, resample, ringbackCycle, silence, speak } from "./audio";
import { type CallRow, finish, getCall, toVoicemail } from "./calls";
import { q } from "./db";
import { sweepRetention } from "./ediscovery";
import { notify } from "./events";
import { AGENT_IDENTITY, livekitConfig } from "./livekit";
import { formatNumber } from "./numbers";
import { greetingAudio, nameOf, settingsOf } from "./people";

/**
 * The phone worker, running inside the Phone server (see instrumentation.ts). Every second it:
 *  - sends calls nobody answered in time to voicemail;
 *  - joins calls where someone from outside is waiting, to play ringback (a SIP caller would
 *    otherwise hear silence), and calls that went to voicemail, to play the greeting, record the
 *    message and save it (transcribed when a speech model is set up).
 * It joins the call's LiveKit room as a participant of its own, through @livekit/rtc-node.
 * Run one per installation (PHONE_WORKER=0 turns it off on extra replicas).
 */
const RATE = 48_000;
const RECORD_RATE = 16_000;
const FRAME = RATE / 100; // 10 ms
const MAX_MESSAGE_S = () => Math.min(600, Math.max(15, Number(process.env.PHONE_VOICEMAIL_MAX_SECONDS) || 180));

type Rtc = typeof import("@livekit/rtc-node");
type Session = { callId: string; stop: () => void };
type WorkerState = { timer: NodeJS.Timeout | null; sweep: NodeJS.Timeout | null; sessions: Map<string, Session>; busy: boolean; rtc: Rtc | null | undefined };
const g = globalThis as unknown as { __phoneWorker?: WorkerState };

function state(): WorkerState {
  return (g.__phoneWorker ??= { timer: null, sweep: null, sessions: new Map(), busy: false, rtc: undefined });
}

async function rtc(): Promise<Rtc | null> {
  const s = state();
  if (s.rtc === undefined) {
    try {
      s.rtc = await import("@livekit/rtc-node");
    } catch (e) {
      console.error("[phone] voicemail is off: @livekit/rtc-node could not load", (e as Error).message);
      s.rtc = null;
    }
  }
  return s.rtc;
}

export function startWorker(): void {
  const s = state();
  if (s.timer) return;
  console.log("[phone] worker started");
  s.timer = setInterval(() => {
    if (s.busy) return;
    s.busy = true;
    tick()
      .catch((e) => console.error("[phone] worker", (e as Error).message))
      .finally(() => {
        s.busy = false;
      });
  }, 1000);
  // Retention rules from the Admin center, hourly.
  const sweep = () => void sweepRetention().catch((e) => console.error("[phone] retention sweep", (e as Error).message));
  setTimeout(sweep, 30_000).unref();
  s.sweep = setInterval(sweep, 3_600_000);
  s.sweep.unref();
}

export function stopWorker(): void {
  const s = state();
  if (s.timer) clearInterval(s.timer);
  if (s.sweep) clearInterval(s.sweep);
  s.timer = null;
  s.sweep = null;
  for (const x of s.sessions.values()) x.stop();
}

/** One pass of the worker; exported for tests. */
export async function tick(): Promise<void> {
  const s = state();
  const due = await q<CallRow>("SELECT * FROM calls WHERE state = 'ringing' AND ring_deadline < now() ORDER BY ring_deadline LIMIT 20");
  for (const c of due) await toVoicemail(c, c.to_email, "No answer");

  // A voicemail nobody is recording (the server restarted mid-message) is over.
  await q(
    `UPDATE calls SET state = 'missed', ended_at = now(), end_reason = 'Voicemail was interrupted'
     WHERE state = 'voicemail' AND created_at < now() - make_interval(secs => $1) AND NOT (id = ANY($2::uuid[]))`,
    [MAX_MESSAGE_S() + 300, [...s.sessions.keys()]],
  );

  if (!livekitConfig()) return;
  const lk = await rtc();
  if (!lk) return;
  const need = await q<CallRow>(
    `SELECT c.* FROM calls c
     WHERE NOT c.meeting_leg AND c.created_at > now() - interval '30 minutes'
       AND (c.state = 'voicemail'
            OR (c.state = 'ringing' AND EXISTS (SELECT 1 FROM parties p WHERE p.call_id = c.id AND p.state = 'joined' AND p.number IS NOT NULL)))
     LIMIT 20`,
  );
  for (const c of need) {
    if (s.sessions.has(c.id)) continue;
    const session = runSession(lk, c);
    s.sessions.set(c.id, session);
  }
}

async function agentToken(room: string): Promise<string> {
  const c = livekitConfig()!;
  const at = new AccessToken(c.apiKey, c.apiSecret, { identity: AGENT_IDENTITY, name: "Voicemail", ttl: "20m" });
  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false });
  return at.toJwt();
}

function runSession(lk: Rtc, call: CallRow): Session {
  let stopped = false;
  let current = call;
  const session: Session = { callId: call.id, stop: () => void (stopped = true) };
  const room = new lk.Room();
  const source = new lk.AudioSource(RATE, 1);
  const audio = new Map<string, InstanceType<Rtc["RemoteAudioTrack"]>>();
  const gone = new Set<string>();

  room.on(lk.RoomEvent.TrackSubscribed, (track, _pub, participant) => {
    if (track.kind === lk.TrackKind.KIND_AUDIO && participant.identity !== AGENT_IDENTITY) audio.set(participant.identity, track as InstanceType<Rtc["RemoteAudioTrack"]>);
  });
  room.on(lk.RoomEvent.ParticipantDisconnected, (p) => {
    gone.add(p.identity);
    audio.delete(p.identity);
  });
  room.on(lk.RoomEvent.Disconnected, () => void (stopped = true));

  const poll = setInterval(() => {
    getCall(call.id).then((c) => (current = c), () => (stopped = true));
  }, 700);

  /** Plays samples into the room in 10 ms frames, until done or `until` says stop. */
  async function play(samples: Int16Array, until: () => boolean): Promise<boolean> {
    for (let at = 0; at < samples.length; at += FRAME) {
      if (stopped || until()) {
        source.clearQueue();
        return false;
      }
      const chunk = new Int16Array(FRAME);
      chunk.set(samples.subarray(at, at + FRAME));
      await source.captureFrame(new lk.AudioFrame(chunk, RATE, 1, FRAME));
    }
    return true;
  }

  const othersHere = () => [...room.remoteParticipants.keys()].filter((id) => id !== AGENT_IDENTITY);

  (async () => {
    await room.connect(livekitConfig()!.wsUrl, await agentToken(call.room), { autoSubscribe: true, dynacast: false });
    const track = lk.LocalAudioTrack.createAudioTrack("phone", source);
    await room.localParticipant!.publishTrack(track, new lk.TrackPublishOptions({ source: lk.TrackSource.SOURCE_MICROPHONE }));
    await q("UPDATE calls SET agent_at = now() WHERE id = $1", [call.id]);

    // Ringback while it rings, for callers from outside.
    const cycle = ringbackCycle(RATE);
    while (!stopped && current.state === "ringing") {
      await play(cycle, () => current.state !== "ringing");
    }
    if (stopped || current.state !== "voicemail") return;
    await takeMessage(current);
  })()
    .catch((e) => console.error("[phone] call worker", call.id, (e as Error).message))
    .finally(async () => {
      clearInterval(poll);
      stopped = true;
      await room.disconnect().catch(() => {});
      await source.close?.();
      state().sessions.delete(call.id);
    });

  async function takeMessage(c: CallRow): Promise<void> {
    const owner = c.to_email;
    if (!owner) return finish(c, "missed", "No answer");
    const greeting = await greetingFor(owner);
    // A moment of quiet first: phone lines clip the start of the audio while they settle.
    const intro = concat([silence(400, RATE), greeting ?? new Int16Array(0), silence(250, RATE), beep(RATE)]);
    const callerLeft = () => othersHere().length === 0 || current.state !== "voicemail";
    await play(intro, callerLeft);
    if (stopped || callerLeft()) return finish(await getCall(c.id), "missed", "Caller hung up");
    await source.waitForPlayout().catch(() => {});

    const who = c.from_email ?? othersHere()[0];
    const track = (who && audio.get(who)) ?? [...audio.values()][0];
    if (!track) return finish(await getCall(c.id), "missed", "No audio from the caller");
    const recorded = await record(lk, track, () => stopped || callerLeft());
    const pcm: Pcm = { rate: RECORD_RATE, samples: trimSilence(recorded) };
    if (durationMs(pcm) < 1500 || level(pcm.samples) < 0.002) return finish(await getCall(c.id), "missed", "No message left");
    const wav = encodeWav(pcm);
    const [vm] = await q<{ id: string }>(
      `INSERT INTO voicemails (call_id, owner, from_email, from_number, from_name, audio, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [c.id, owner, c.from_email, c.from_number, c.from_name, wav, durationMs(pcm)],
    );
    await finish(await getCall(c.id), "ended", "Left a voicemail");
    await notify(owner, { type: "voicemail", id: vm.id, from: c.from_name || formatNumber(c.from_number) || c.from_email || "" });
    void transcribeVoicemail(vm.id, wav);
  }

  async function record(lkm: Rtc, track: InstanceType<Rtc["RemoteAudioTrack"]>, until: () => boolean): Promise<Int16Array> {
    const stream = new lkm.AudioStream(track, { sampleRate: RECORD_RATE, numChannels: 1 });
    const chunks: Int16Array[] = [];
    const max = MAX_MESSAGE_S() * RECORD_RATE;
    let total = 0;
    let quietSince = 0;
    const reader = stream.getReader();
    const ticker = setInterval(() => {
      if (until()) void reader.cancel().catch(() => {});
    }, 250);
    try {
      while (total < max) {
        const { value, done } = await reader.read();
        if (done || !value) break;
        chunks.push(new Int16Array(value.data));
        total += value.samplesPerChannel;
        // Ten seconds of near silence after the message has started: they're done.
        if (level(value.data) < 0.003) {
          if (total > 3 * RECORD_RATE && (quietSince ||= total) && total - quietSince > 10 * RECORD_RATE) break;
        } else quietSince = 0;
        if (until()) break;
      }
    } finally {
      clearInterval(ticker);
      await reader.cancel().catch(() => {});
    }
    return concat(chunks);
  }

  return session;
}

/** Cuts trailing near-silence (everything after the last word), keeping half a second. */
export function trimSilence(s: Int16Array, rate = RECORD_RATE): Int16Array {
  const win = Math.round(rate / 10);
  let end = s.length;
  while (end - win > 0 && level(s.subarray(end - win, end)) < 0.003) end -= win;
  return s.subarray(0, Math.min(s.length, end + rate / 2));
}

/** The person's recorded greeting, else their greeting text (or the standard one) spoken by eSpeak. */
async function greetingFor(owner: string): Promise<Int16Array | null> {
  const recorded = await greetingAudio(owner);
  const pcm = recorded ? decodeWav(recorded) : null;
  if (pcm) return resample(pcm, RATE).samples;
  const s = await settingsOf(owner);
  const name = await nameOf(owner);
  const words = s.greetingText || `You have reached ${name}. Please leave a message after the tone. When you are done, just hang up.`;
  const spoken = await speak(words);
  return spoken ? resample(spoken, RATE).samples : null;
}

export async function transcribeVoicemail(id: string, wav: Buffer): Promise<void> {
  if (!speechConfig({ prefix: "PHONE_" })) return;
  try {
    const text = await transcribe(new Uint8Array(wav), { mime: "audio/wav", filename: "voicemail.wav", prefix: "PHONE_" });
    await q("UPDATE voicemails SET transcript = $2, transcript_error = NULL WHERE id = $1", [id, text]);
    const [vm] = await q<{ owner: string }>("SELECT owner FROM voicemails WHERE id = $1", [id]);
    if (vm) await notify(vm.owner, { type: "history" });
  } catch (e) {
    if (e instanceof AiUnavailableError) return;
    await q("UPDATE voicemails SET transcript_error = $2 WHERE id = $1", [id, String((e as Error).message).slice(0, 300)]);
  }
}
