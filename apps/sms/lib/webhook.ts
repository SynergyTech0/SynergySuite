import { publicUrl, verifyTwilio } from "./provider";

type Env = Record<string, string | undefined>;

/**
 * Reads a Twilio webhook and checks its X-Twilio-Signature against TWILIO_AUTH_TOKEN and the
 * public address Twilio called. Returns the form parameters, or null when the request is not
 * provably from Twilio (no token set, no or wrong signature, not a form post).
 */
export async function twilioParams(req: Request, env: Env = process.env): Promise<Record<string, string> | null> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/x-www-form-urlencoded")) return null;
  const raw = await req.text();
  if (raw.length > 64_000) return null;
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;
  const u = new URL(req.url);
  const url = publicUrl(u.pathname + u.search, env);
  return verifyTwilio(env.TWILIO_AUTH_TOKEN ?? "", req.headers.get("x-twilio-signature"), url, params) ? params : null;
}

/** An empty TwiML reply: Twilio sends nothing back to the texter. */
export function twiml(status = 200): Response {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { status, headers: { "content-type": "text/xml" } });
}
