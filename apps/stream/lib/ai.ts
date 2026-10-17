/**
 * AI for videos, through the suite's own model setting (@synergy/ai; STREAM_AI_* overrides the
 * suite-wide AI_* values): captions from the video's speech, and a summary with chapters from the
 * transcript. Nothing runs unless an administrator has set a model.
 */
import { readFile, rm } from "node:fs/promises";
import { AiRequestError, AiUnavailableError, isAiAvailable, loadAiConfig, loadSpeechConfig, structured, transcribe } from "@synergy/ai";
import { type Chapter, type Cue, cleanChapters, clock, parseCues, splitIntoCues, timedTranscript, toVtt } from "./captions";
import { q } from "./db";
import { audioPieces, enqueue } from "./media";
import { filePath, workDir } from "./store";
import { UserError } from "./util";
import { saveCaptions } from "./videos";

export const PREFIX = "STREAM_";
/** Length of the audio pieces sent for speech to text. */
const PIECE = 30;

export async function aiStatus(): Promise<{ speech: boolean; text: boolean }> {
  const [text, speech] = await Promise.all([isAiAvailable({ prefix: PREFIX }), loadSpeechConfig({ prefix: PREFIX }).catch(() => null)]);
  return { speech: !!speech, text };
}

/** An AI failure as words for the person who asked. */
export function aiMessage(e: unknown): string {
  if (e instanceof AiUnavailableError) return e.message;
  if (e instanceof AiRequestError) return "The AI service didn't answer. Try again in a while, or ask an administrator to check the AI settings.";
  return (e as Error)?.message || "Something went wrong";
}

/**
 * Captions from the video's own speech: its sound in 30-second pieces, each sent to the speech
 * model, the words shared out over each piece's time. Runs in the background; the video's
 * captions_status says how it went.
 */
export async function startCaptioning(id: string, owner: string): Promise<void> {
  const cfg = await loadSpeechConfig({ prefix: PREFIX }).catch(() => null);
  if (!cfg) throw new UserError("Automatic captions need a speech model. An administrator can add one in the admin console's AI model settings (or set AI_SPEECH_MODEL).", 503);
  const [v] = await q<{ status: string; duration: number | null; captions_status: string; title: string }>(
    `SELECT status, duration, captions_status, title FROM videos WHERE id = $1 AND owner = $2 AND held_deleted_at IS NULL`,
    [id, owner],
  );
  if (!v) throw new UserError("Not found", 404);
  if (v.status !== "ready") throw new UserError("Wait until the video has finished processing");
  if (v.captions_status === "working") return;
  await q(`UPDATE videos SET captions_status = 'working', captions_error = NULL WHERE id = $1`, [id]);
  void enqueue(async () => {
    const dir = await workDir(id, "speech");
    try {
      const pieces = await audioPieces(filePath(id, "web"), dir, PIECE);
      const cues: Cue[] = [];
      for (let i = 0; i < pieces.length; i++) {
        const start = i * PIECE;
        const end = v.duration ? Math.min(v.duration, start + PIECE) : start + PIECE;
        // The end of the previous piece helps the model carry words and names across the cut.
        const prompt = [v.title, cues.slice(-3).map((c) => c.text).join(" ")].filter(Boolean).join(". ");
        const said = await transcribe(await readFile(pieces[i]), { mime: "audio/mpeg", filename: `piece-${i}.mp3`, prompt, config: cfg });
        cues.push(...splitIntoCues(said, start, end));
      }
      if (!cues.length) throw new Error("No speech was found in this video");
      await saveCaptions(id, toVtt(cues), "ai");
    } catch (e) {
      await q(`UPDATE videos SET captions_status = 'failed', captions_error = $2 WHERE id = $1`, [id, aiMessage(e).slice(0, 300)]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }).catch(() => {});
}

export type Summary = { summary: string; chapters: Chapter[] };

/** A short summary and chapters from the transcript. Needs captions first. */
export async function summarize(id: string, owner: string): Promise<Summary> {
  const [v] = await q<{ title: string; captions: string | null; duration: number | null }>(
    `SELECT title, captions, duration FROM videos WHERE id = $1 AND owner = $2 AND held_deleted_at IS NULL`,
    [id, owner],
  );
  if (!v) throw new UserError("Not found", 404);
  const cues = parseCues(v.captions ?? "");
  if (!cues.length) throw new UserError("Add captions first (upload a file or make them automatically); the summary is written from them");
  let out: { summary?: string; chapters?: { start: string; title: string }[] };
  try {
    out = await structured<typeof out>({
      config: await loadAiConfig({ prefix: PREFIX }),
      system:
        "You summarize workplace videos from their transcript. Write plainly, in the transcript's language. " +
        "The summary is 2 to 4 sentences on what the video covers. Chapters mark where new topics start: 3 to 12 of them, " +
        "the first at 0:00, each with a short title (at most 6 words) and a start time copied from a [m:ss] mark in the transcript.",
      prompt: `Video title: ${v.title}\nLength: ${v.duration ? clock(v.duration) : "unknown"}\n\nTranscript:\n${timedTranscript(cues)}`,
      toolName: "record_summary",
      toolDescription: "Record the video's summary and chapters.",
      schema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          chapters: {
            type: "array",
            items: { type: "object", properties: { start: { type: "string", description: "m:ss or h:mm:ss" }, title: { type: "string" } }, required: ["start", "title"] },
          },
        },
        required: ["summary", "chapters"],
      },
      maxTokens: 2000,
    });
  } catch (e) {
    throw new UserError(aiMessage(e), e instanceof AiUnavailableError ? 503 : 502);
  }
  const toSeconds = (s: string) => String(s).split(":").reduce((n, part) => n * 60 + (Number(part) || 0), 0);
  const chapters = cleanChapters((out.chapters ?? []).map((c) => ({ t: toSeconds(c.start), title: c.title })), v.duration);
  const summary = String(out.summary ?? "").trim().slice(0, 5000);
  return { summary, chapters };
}
