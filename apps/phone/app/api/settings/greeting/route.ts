import { route } from "@/lib/api";
import { decodeWav, durationMs } from "@/lib/audio";
import { greetingAudio, setGreetingAudio } from "@/lib/people";
import { UserError } from "@/lib/util";

export const dynamic = "force-dynamic";

/** Your recorded voicemail greeting, as WAV. The browser converts what you record to WAV first. */
export const GET = route(async (me) => {
  const wav = await greetingAudio(me.email);
  if (!wav) throw new UserError("No recorded greeting", 404);
  return new Response(new Uint8Array(wav), { headers: { "content-type": "audio/wav", "cache-control": "no-store" } });
});

export const PUT = route(async (me, req) => {
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > 6 * 1024 * 1024) throw new UserError("Keep the greeting under a minute");
  const pcm = decodeWav(buf);
  if (!pcm) throw new UserError("The greeting must be a 16-bit WAV recording");
  const ms = durationMs(pcm);
  if (ms < 1000) throw new UserError("That greeting is too short");
  if (ms > 60_000) throw new UserError("Keep the greeting under a minute");
  await setGreetingAudio(me.email, buf);
  return { ok: true, durationMs: ms };
});

export const DELETE = route(async (me) => {
  await setGreetingAudio(me.email, null);
  return { ok: true };
});
