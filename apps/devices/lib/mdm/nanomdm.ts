import { X509Certificate, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { UserError } from "../util";
import { type PlistValue, buildPlist } from "./plist";

/**
 * NanoMDM (github.com/micromdm/nanomdm, MIT) runs beside Devices and speaks the Apple MDM protocol:
 * it verifies each device's identity certificate, holds the command queue and sends APNs pushes.
 * Devices talks to its API on the internal network and receives its webhook.
 *
 *   DEVICES_MDM_URL           NanoMDM's address, e.g. http://devices-mdm:9000 (compose sets it)
 *   DEVICES_MDM_API_KEY       NanoMDM's -api key
 *   DEVICES_MDM_WEBHOOK_KEY   NanoMDM's -webhook-hmac-key; webhooks without a valid signature are refused
 *   DEVICES_SCEP_CHALLENGE    the SCEP server's -challenge, put into enrollment profiles
 */

export type MdmConfig = { url: string; apiKey: string; webhookKey: string; challenge: string };

export function mdmConfig(env: NodeJS.ProcessEnv = process.env): MdmConfig | null {
  const url = (env.DEVICES_MDM_URL ?? "").replace(/\/+$/, "");
  const apiKey = env.DEVICES_MDM_API_KEY ?? "";
  const webhookKey = env.DEVICES_MDM_WEBHOOK_KEY ?? "";
  const challenge = env.DEVICES_SCEP_CHALLENGE ?? "";
  if (!url || !apiKey || !webhookKey || !challenge) return null;
  return { url, apiKey, webhookKey, challenge };
}

export class MdmUnavailable extends UserError {
  constructor(message = "Apple device management isn't set up on this server (see the Devices README)") {
    super(message, 503);
  }
}

function need(env?: NodeJS.ProcessEnv): MdmConfig {
  const c = mdmConfig(env);
  if (!c) throw new MdmUnavailable();
  return c;
}

/**
 * `results`: NanoMDM answers 500 when any push failed, though the command was queued; a body with
 * per-enrollment results is then returned rather than thrown.
 */
async function call(path: string, init: { method: string; body?: string; results?: boolean }, env?: NodeJS.ProcessEnv): Promise<unknown> {
  const c = need(env);
  let res: Response;
  try {
    res = await fetch(`${c.url}${path}`, {
      method: init.method,
      body: init.body,
      headers: {
        authorization: `Basic ${Buffer.from(`nanomdm:${c.apiKey}`).toString("base64")}`,
        ...(init.body ? { "content-type": "application/x-apple-aspen-mdm" } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new MdmUnavailable("Devices can't reach its Apple MDM service right now");
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok && !(init.results && (json as { status?: unknown } | null)?.status)) {
    const msg = (json as { error?: string } | null)?.error || text.slice(0, 200) || `status ${res.status}`;
    throw new UserError(`The Apple MDM service refused that: ${msg}`, 502);
  }
  return json;
}

export type PushCert = { topic: string; expires_at: string; subject: string };

/**
 * Checks an APNs MDM push certificate and its key (PEM, the key unencrypted) and hands them to
 * NanoMDM. Returns the topic devices will be enrolled under.
 */
export async function uploadPushCert(pem: string, env?: NodeJS.ProcessEnv): Promise<PushCert> {
  const certs = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  if (!certs.length) throw new UserError("Paste or choose the push certificate (PEM) together with its private key");
  if (!/-----BEGIN (RSA |EC )?PRIVATE KEY-----/.test(pem)) {
    throw new UserError(/ENCRYPTED PRIVATE KEY/.test(pem) ? "The private key is encrypted; export it without a password" : "The private key is missing: add it after the certificate");
  }
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(certs[0] as string);
  } catch {
    throw new UserError("That certificate can't be read");
  }
  const topic = /UID=([^\n,]+)/.exec(cert.subject)?.[1]?.trim() ?? "";
  if (!topic.startsWith("com.apple.mgmt.")) throw new UserError("That isn't an Apple MDM push certificate (its topic should start with com.apple.mgmt.)");
  if (new Date(cert.validTo) < new Date()) throw new UserError(`That certificate expired on ${cert.validTo}; renew it at identity.apple.com`);
  const out = (await call("/v1/pushcert", { method: "PUT", body: pem }, env)) as { topic?: string } | null;
  return { topic: out?.topic || topic, expires_at: new Date(cert.validTo).toISOString(), subject: cert.subject.replace(/\n/g, ", ") };
}

/** Per enrollment: pushErrors (queued, but APNs couldn't wake it) and failed (not queued at all). */
export type EnqueueResult = { uuid: string; pushErrors: Record<string, string>; failed: Record<string, string> };

/** Queues one command for the given enrollments and asks them (APNs) to check in. */
export async function enqueue(ids: string[], command: Record<string, PlistValue | undefined>, env?: NodeJS.ProcessEnv): Promise<EnqueueResult> {
  if (!ids.length) return { uuid: "", pushErrors: {}, failed: {} };
  const uuid = randomUUID();
  const xml = buildPlist({ Command: command, CommandUUID: uuid });
  const out = (await call(`/v1/enqueue/${ids.map(encodeURIComponent).join(",")}`, { method: "PUT", body: xml, results: true }, env)) as {
    status?: Record<string, { push_error?: string; command_error?: string }>;
    command_uuid?: string;
    command_error?: string;
  } | null;
  if (out?.command_error && !out.status) throw new UserError(`The Apple MDM service couldn't queue that: ${out.command_error}`, 502);
  const pushErrors: Record<string, string> = {};
  const failed: Record<string, string> = {};
  for (const [id, s] of Object.entries(out?.status ?? {})) {
    if (s?.command_error) failed[id] = s.command_error;
    else if (s?.push_error) pushErrors[id] = s.push_error;
  }
  return { uuid: out?.command_uuid || uuid, pushErrors, failed };
}

/** Webhook bodies are signed by NanoMDM: base64 HMAC-SHA256 of the body in X-Hmac-Signature. */
export function webhookSigned(raw: Buffer, signature: string | null, env?: NodeJS.ProcessEnv): boolean {
  const c = mdmConfig(env);
  if (!c || !signature) return false;
  const want = createHmac("sha256", c.webhookKey).update(raw).digest();
  let got: Buffer;
  try {
    got = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  return got.length === want.length && timingSafeEqual(got, want);
}
