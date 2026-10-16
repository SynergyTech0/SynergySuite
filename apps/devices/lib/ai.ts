import { AiUnavailableError, aiConfig, chat } from "@synergy/ai";
import { getAlert } from "./alerts";
import { DETECTIONS } from "./detections";
import { q } from "./db";
import { UserError } from "./util";

/** The suite's own AI model (AI_*), or one for Devices only (DEVICES_AI_*). */
const PREFIX = "DEVICES_";

export function aiEnabled(): boolean {
  try {
    return !!aiConfig({ prefix: PREFIX });
  } catch {
    return false;
  }
}

/**
 * A plain-language read of one alert for whoever is triaging it: what it probably is, how to check,
 * and what to do. It is advice to a person, never an action; the evidence sent is the alert's own
 * detail and the device's platform, not the rest of the inventory.
 */
export async function explainAlert(id: string): Promise<string> {
  const a = await getAlert(id);
  const [d] = await q<{ platform: string; os_name: string; os_version: string }>(`SELECT platform, os_name, os_version FROM devices WHERE id = $1`, [a.device_id]);
  const info = DETECTIONS.find((x) => x.id === a.detection);
  try {
    return await chat({
      config: aiConfig({ prefix: PREFIX }),
      system:
        "You help an IT administrator triage endpoint security alerts. Be concrete and brief: at most 180 words, in three short parts titled " +
        "'What this probably is', 'How to check' and 'What to do'. Give commands for the device's operating system. Say plainly when an alert " +
        "is most likely harmless, and never claim certainty you don't have.",
      prompt: [
        `Alert: ${a.title}`,
        `Severity: ${a.severity}. Seen ${a.occurrences} time(s), first ${new Date(a.created_at).toISOString()}.`,
        info ? `What the detection looks for: ${info.describe}` : "",
        `Device: ${d?.os_name ?? ""} ${d?.os_version ?? ""} (${d?.platform ?? "unknown"}).`,
        `Evidence: ${JSON.stringify(a.detail).slice(0, 2000)}`,
      ].filter(Boolean).join("\n"),
      maxTokens: 500,
      temperature: 0.2,
    });
  } catch (err) {
    if (err instanceof AiUnavailableError) throw new UserError("AI is off: set AI_MODEL (or DEVICES_AI_MODEL) to use it", 503);
    throw err;
  }
}
