import { AiUnavailableError, chat, loadAiConfig } from "@synergy/ai";
import { type Params, route } from "@/lib/api";
import * as drive from "@/lib/drive";
import { UserError } from "@/lib/names";

const AI = { prefix: "DRIVE_" };

/** A short summary of a text file from the suite's AI model, kept until the file changes. */
export const POST = route(async (me, _req, { params }: Params<"id">) => {
  const { id } = await params;
  const config = await loadAiConfig(AI).catch(() => null);
  if (!config) throw new UserError("AI is off. An administrator can turn it on in the admin console's AI model settings.", 503);
  const { row, text } = await drive.textFor(me, id);
  if (row.summary && row.summary_sha === row.sha256) return { summary: row.summary };
  try {
    const summary = await chat(
      {
        system: "You summarize files for a file manager. Reply with 2 to 4 plain sentences on what the file is and what it says. No preamble.",
        prompt: `File name: ${row.name}\n\n${text.slice(0, 60_000)}`,
        maxTokens: 400,
        config,
      },
    );
    await drive.saveSummary(row.id, row.sha256, summary.trim());
    return { summary: summary.trim() };
  } catch (e) {
    if (e instanceof AiUnavailableError) throw new UserError("AI is off. An administrator can turn it on in the admin console's AI model settings.", 503);
    throw e;
  }
});
