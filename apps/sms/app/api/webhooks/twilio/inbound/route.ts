import { received } from "@/lib/sms";
import { twilioParams, twiml } from "@/lib/webhook";

/** Twilio's "a message comes in" webhook. Public (no suite sign-in); only a request Twilio signed is accepted. */
export async function POST(req: Request): Promise<Response> {
  const p = await twilioParams(req);
  if (!p) return new Response("Forbidden", { status: 403 });
  try {
    await received({ from: p.From ?? "", body: p.Body ?? "", id: p.MessageSid ?? p.SmsSid ?? "" });
  } catch (e) {
    console.error("[sms] inbound", e);
    return twiml(500); // Twilio retries, and the saved MessageSid makes the retry harmless
  }
  return twiml();
}
