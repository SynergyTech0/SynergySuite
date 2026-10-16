import { createPolicyClient, type Policy, type ProtectionClient } from "@synergy/compliance";

/** Asks the Admin center about legal holds, sensitivity labels and DLP rules; one client per server process. */
const g = globalThis as unknown as { __mailPolicy?: ProtectionClient };

export function policy(): ProtectionClient {
  g.__mailPolicy ??= createPolicyClient({ app: "mail" });
  return g.__mailPolicy;
}

/**
 * Everyone whose mail is on hold, read from the same policy endpoint as createPolicyClient. The
 * client only answers yes or no per person, but the hold sweep needs the list. `ok: false` when
 * the Admin center is configured but unreachable: the caller then keeps every hold it already
 * knows (fails closed) instead of releasing anyone.
 */
export async function heldMailboxes(doFetch: typeof fetch = fetch): Promise<{ ok: boolean; mailboxes: string[] }> {
  const url = (process.env.ADMIN_INTERNAL_URL ?? "").replace(/\/$/, "");
  if (!url) return { ok: true, mailboxes: [] };
  try {
    const res = await doFetch(`${url}/api/svc/policy`, {
      headers: { Authorization: `Bearer ${process.env.COMPLIANCE_TOKEN ?? ""}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`policy ${res.status}`);
    const p = (await res.json()) as Policy;
    const held = p.holds.filter((h) => h.apps.length === 0 || h.apps.includes("mail")).flatMap((h) => h.custodians);
    return { ok: true, mailboxes: [...new Set(held.map((e) => e.trim().toLowerCase()).filter(Boolean))].sort() };
  } catch {
    return { ok: false, mailboxes: [] };
  }
}
