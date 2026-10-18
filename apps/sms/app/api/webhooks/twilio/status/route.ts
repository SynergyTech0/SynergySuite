import { delivered } from "@/lib/sms";
import { twilioParams } from "@/lib/webhook";

/** Twilio's delivery updates for texts sent from here (the StatusCallback each send asks for). */
export async function POST(req: Request): Promise<Response> {
  const p = await twilioParams(req);
  if (!p) return new Response("Forbidden", { status: 403 });
  const error = p.ErrorCode ? `Twilio error ${p.ErrorCode}${p.ErrorMessage ? `: ${p.ErrorMessage}` : ""}` : "";
  await delivered({ id: p.MessageSid ?? "", status: p.MessageStatus ?? p.SmsStatus ?? "", error });
  return new Response(null, { status: 204 });
}
