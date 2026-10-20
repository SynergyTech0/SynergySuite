import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { loadSpeechConfig, transcribe } from "@synergy/ai";
import { encodeWav, Segmenter } from "./audio";
import { livekitApiUrl, livekitWsUrl } from "./livekit";
import { addPerson, addSegment, cleanText, closeTranscript, openTranscript, transcribeEveryMeeting } from "./transcripts";

/**
 * The transcriber, running inside the Meet server (see instrumentation.ts) when MEET_TRANSCRIBE is
 * "always". Every few seconds it lists the media server's rooms and joins each one that has people
 * in it, as a participant of its own (TRANSCRIBER_IDENTITY, which the meeting UI hides like the
 * captions bot). It listens to each person's microphone separately, so every line is labelled with
 * who said it, cuts it into utterances at pauses, has the suite's speech model (@synergy/ai
 * transcribe, MEET_AI_* to give Meet its own) write them down, saves them (lib/transcripts.ts) and
 * sends each line on the "transcript" data topic, which fills the meeting's live Transcript panel.
 * It leaves when the last person does. Run one per installation (MEET_WORKER=0 on extra replicas).
 */
export const TRANSCRIBER_IDENTITY = "synergy-captions-transcriber";
const RATE = 16_000;
// Other workers that join rooms: their audio is ours or a recording, never a speaker.
const NOT_SPEAKERS = /^(synergy-captions|phone-agent|EG_)/;

type Rtc = typeof import("@livekit/rtc-node");
type Session = { room: string; stop: () => void };
type State = { timer: NodeJS.Timeout | null; sessions: Map<string, Session>; busy: boolean; rtc: Rtc | null | undefined; speechOff: boolean };
const g = globalThis as unknown as { __meetTranscriber?: State };
const state = (): State => (g.__meetTranscriber ??= { timer: null, sessions: new Map(), busy: false, rtc: undefined, speechOff: false });

function keys() {
  const apiKey = process.env.LIVEKIT_API_KEY || "";
  const apiSecret = process.env.LIVEKIT_API_SECRET || "";
  return apiKey && apiSecret ? { apiKey, apiSecret } : null;
}

async function rtc(): Promise<Rtc | null> {
  const s = state();
  if (s.rtc === undefined) {
    try {
      s.rtc = await import("@livekit/rtc-node");
    } catch (e) {
      console.error("[meet] transcription is off: @livekit/rtc-node could not load", (e as Error).message);
      s.rtc = null;
    }
  }
  return s.rtc;
}

export function startTranscriber(): void {
  const s = state();
  if (s.timer || !transcribeEveryMeeting()) return;
  console.log("[meet] transcribing every meeting");
  s.timer = setInterval(() => {
    if (s.busy) return;
    s.busy = true;
    tick()
      .catch((e) => console.error("[meet] transcriber", (e as Error).message))
      .finally(() => {
        s.busy = false;
      });
  }, 5000);
}

/** One pass: join every room with people in it that isn't being transcribed yet. */
export async function tick(): Promise<void> {
  const k = keys();
  if (!k) return;
  const s = state();
  const speech = await loadSpeechConfig({ prefix: "MEET_" }).catch(() => null);
  if (!speech) {
    if (!s.speechOff) console.log("[meet] no speech model is set (AI_SPEECH_MODEL or MEET_AI_SPEECH_MODEL), so meetings aren't transcribed");
    s.speechOff = true;
    return;
  }
  s.speechOff = false;
  const lk = await rtc();
  if (!lk) return;
  const rooms = await new RoomServiceClient(livekitApiUrl(), k.apiKey, k.apiSecret).listRooms();
  for (const r of rooms) {
    if (s.sessions.has(r.name) || r.numParticipants === 0) continue;
    const people = await new RoomServiceClient(livekitApiUrl(), k.apiKey, k.apiSecret).listParticipants(r.name);
    if (!people.some((p) => !NOT_SPEAKERS.test(p.identity))) continue;
    s.sessions.set(r.name, listen(lk, r.name));
  }
}

async function token(room: string): Promise<string> {
  const k = keys()!;
  const at = new AccessToken(k.apiKey, k.apiSecret, { identity: TRANSCRIBER_IDENTITY, name: "Transcript", ttl: "12h" });
  at.addGrant({ room, roomJoin: true, canPublish: false, canSubscribe: true, canPublishData: true });
  return at.toJwt();
}

function listen(lk: Rtc, roomName: string): Session {
  let stopped = false;
  const session: Session = { room: roomName, stop: () => void (stopped = true) };
  const room = new lk.Room();
  const readers = new Map<string, () => void>();
  let transcriptId: string | null = null;
  let chain = Promise.resolve();

  const speakers = () => [...room.remoteParticipants.values()].filter((p) => !NOT_SPEAKERS.test(p.identity));

  const say = (identity: string, name: string, spokenAt: Date, samples: Int16Array) => {
    // One at a time per room, in order, so lines are saved and shown as they were spoken.
    chain = chain.then(async () => {
      try {
        const raw = await transcribe(new Uint8Array(encodeWav({ rate: RATE, samples })), { mime: "audio/wav", filename: "speech.wav", prefix: "MEET_" });
        const text = cleanText(raw);
        if (!text || !transcriptId) return;
        await addSegment(transcriptId, { identity, name, spokenAt, text });
        const payload = new TextEncoder().encode(JSON.stringify({ identity, name, text, ts: spokenAt.getTime() }));
        await room.localParticipant?.publishData(payload, { reliable: true, topic: "transcript" }).catch(() => {});
      } catch (e) {
        console.error("[meet] transcribe", roomName, (e as Error).message);
      }
    });
  };

  async function follow(track: InstanceType<Rtc["RemoteAudioTrack"]>, identity: string, name: string) {
    readers.get(identity)?.();
    const stream = new lk.AudioStream(track, { sampleRate: RATE, numChannels: 1 });
    const reader = stream.getReader();
    const seg = new Segmenter(RATE);
    // Frames arrive as they are spoken (and not at all while muted), so an utterance began its
    // own length before now.
    const at = (samples: Int16Array) => new Date(Date.now() - (samples.length / RATE) * 1000);
    let done = false;
    readers.set(identity, () => {
      done = true;
      void reader.cancel().catch(() => {});
    });
    try {
      while (!done && !stopped) {
        const { value, done: end } = await reader.read();
        if (end || !value) break;
        for (const u of seg.push(new Int16Array(value.data))) say(identity, name, at(u.samples), u.samples);
      }
    } finally {
      const last = seg.flush();
      if (last) say(identity, name, at(last.samples), last.samples);
    }
  }

  room.on(lk.RoomEvent.ParticipantConnected, (p) => {
    if (transcriptId && !NOT_SPEAKERS.test(p.identity)) void addPerson(transcriptId, p.identity, p.name || p.identity).catch(() => {});
  });
  room.on(lk.RoomEvent.TrackSubscribed, (track, _pub, p) => {
    if (track.kind !== lk.TrackKind.KIND_AUDIO || NOT_SPEAKERS.test(p.identity)) return;
    void follow(track as InstanceType<Rtc["RemoteAudioTrack"]>, p.identity, p.name || p.identity).catch((e) =>
      console.error("[meet] listen", roomName, p.identity, (e as Error).message),
    );
  });
  room.on(lk.RoomEvent.TrackUnsubscribed, (_track, _pub, p) => {
    readers.get(p.identity)?.();
    readers.delete(p.identity);
  });
  room.on(lk.RoomEvent.ParticipantDisconnected, (p) => {
    readers.get(p.identity)?.();
    readers.delete(p.identity);
    if (speakers().length === 0) stopped = true;
  });
  room.on(lk.RoomEvent.Disconnected, () => void (stopped = true));

  (async () => {
    transcriptId = await openTranscript(roomName);
    await room.connect(livekitWsUrl() || livekitApiUrl().replace(/^http/, "ws"), await token(roomName), { autoSubscribe: true, dynacast: false });
    for (const p of speakers()) await addPerson(transcriptId, p.identity, p.name || p.identity);
    while (!stopped) {
      await new Promise((r) => setTimeout(r, 1000));
      if (speakers().length === 0) stopped = true;
    }
  })()
    .catch((e) => console.error("[meet] transcriber", roomName, (e as Error).message))
    .finally(async () => {
      stopped = true;
      for (const stop of readers.values()) stop();
      await room.disconnect().catch(() => {});
      await chain.catch(() => {});
      if (transcriptId) await closeTranscript(transcriptId).catch(() => {});
      state().sessions.delete(roomName);
    });

  return session;
}
