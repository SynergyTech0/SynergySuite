import { createHmac, timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;

export type SendResult = { ok: true; id: string; status: string } | { ok: false; error: string };

/** A texting service. SMS_PROVIDER picks one; Twilio is the only one so far. */
export interface SmsProvider {
  name: string;
  /** Whether it has what it needs to send. */
  configured: boolean;
  /** The number or sender texts come from, for the page to show. */
  from: string;
  send(to: string, body: string): Promise<SendResult>;
}

/** The address Twilio calls for `path`: SMS_PUBLIC_URL, else https://sms.SUITE_DOMAIN. Twilio signs this exact URL. */
export function publicUrl(path: string, env: Env = process.env): string {
  const base = (env.SMS_PUBLIC_URL || (env.SUITE_DOMAIN ? `https://sms.${env.SUITE_DOMAIN}` : "")).replace(/\/+$/, "");
  return base ? `${base}${path}` : "";
}

/**
 * Twilio's request signature: HMAC-SHA1 with the auth token over the full URL followed by every
 * POST parameter's name and value, sorted by name, then base64.
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

/** True only when `signature` is Twilio's signature for this URL and these parameters. */
export function verifyTwilio(authToken: string, signature: string | null, url: string, params: Record<string, string>): boolean {
  if (!authToken || !signature || !url) return false;
  const want = Buffer.from(twilioSignature(authToken, url, params));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function twilio(env: Env = process.env, fetchImpl: typeof fetch = fetch): SmsProvider {
  const sid = env.TWILIO_ACCOUNT_SID ?? "";
  const token = env.TWILIO_AUTH_TOKEN ?? "";
  const from = env.TWILIO_FROM_NUMBER ?? env.TWILIO_PHONE_NUMBER ?? "";
  const service = env.TWILIO_MESSAGING_SERVICE_SID ?? "";
  const statusUrl = publicUrl("/api/webhooks/twilio/status", env);
  return {
    name: "twilio",
    configured: Boolean(sid && token && (from || service)),
    from: from || (service ? "Messaging Service" : ""),
    async send(to, body) {
      if (!sid || !token || !(from || service)) return { ok: false, error: "Twilio is not set up" };
      const form = new URLSearchParams({ To: to, Body: body });
      if (service) form.set("MessagingServiceSid", service);
      else form.set("From", from);
      if (statusUrl) form.set("StatusCallback", statusUrl);
      try {
        const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
          method: "POST",
          headers: {
            authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: form,
        });
        const data = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string };
        if (res.ok && data.sid) return { ok: true, id: data.sid, status: data.status || "queued" };
        return { ok: false, error: data.message || `Twilio answered ${res.status}` };
      } catch (e) {
        return { ok: false, error: `Couldn't reach Twilio: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  };
}

const none: SmsProvider = {
  name: "none",
  configured: false,
  from: "",
  async send() {
    return { ok: false, error: "No texting service is set up (SMS_PROVIDER)" };
  },
};

let override: SmsProvider | undefined;

/** For tests: use this provider instead of the one the environment names. */
export function setProvider(p: SmsProvider | undefined): void {
  override = p;
}

export function provider(env: Env = process.env): SmsProvider {
  if (override) return override;
  const name = (env.SMS_PROVIDER || "twilio").trim().toLowerCase();
  return name === "twilio" ? twilio(env) : none;
}
