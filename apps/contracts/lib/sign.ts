import { timingSafeEqual } from "node:crypto";
import type { Me } from "./api";
import { logEvent, markSigned, requireEdit } from "./contracts";
import { q, tx } from "./db";
import { UserError, cleanEmail, text, uuidish } from "./util";

/**
 * Signatures. Contracts speaks the same contract.event protocol Synergy Sign already sends:
 *
 *   Outgoing (optional): POST CONTRACTS_SIGN_URL with header x-service-token: CONTRACTS_SIGN_TOKEN
 *     { ref: "contract:<id>", number, title, text, signers: [{ email, name, order }], message }
 *     → 2xx { id, url }   (the signing service's document id and a link to it)
 *   Incoming: POST /api/svc/sign-events with the same token
 *     { type: "contract.event", ref, at, data: { documentId, dealRef: "contract:<id>", event, signerEmail?, completedAt? } }
 *
 * With no signing service set, a person sends the printed contract from Sign themselves, pastes
 * the link here, and uploads the signed copy (which marks the contract signed).
 */
export function signingConfigured(): boolean {
  return !!(process.env.CONTRACTS_SIGN_URL && process.env.CONTRACTS_SIGN_TOKEN);
}

export type Signer = { email: string; name: string };

export async function sendForSignature(me: Me, id: string, input: { signers?: unknown; signUrl?: unknown; message?: unknown }) {
  const { c } = await requireEdit(me.email, id);
  if (c.status !== "approved") throw new UserError("Approve the contract before sending it for signature", 409);
  const raw = Array.isArray(input.signers) ? input.signers : [];
  const signers: Signer[] = raw.map((s) => ({ email: cleanEmail((s as Signer)?.email), name: text((s as Signer)?.name, 120) }));
  if (!signers.length) throw new UserError("Add who signs");
  let signRef: string | null = null;
  let signUrl = text(input.signUrl, 1000);
  if (signUrl && !/^https?:\/\//i.test(signUrl)) throw new UserError("The signing link must start with https://");
  if (signingConfigured()) {
    const [{ body }] = await q<{ body: string }>(`SELECT body FROM contracts WHERE id = $1`, [id]);
    let res: Response;
    try {
      res = await fetch(process.env.CONTRACTS_SIGN_URL!, {
        method: "POST",
        headers: { "content-type": "application/json", "x-service-token": process.env.CONTRACTS_SIGN_TOKEN! },
        body: JSON.stringify({
          ref: `contract:${id}`,
          number: c.number,
          title: c.title,
          text: body,
          signers: signers.map((s, i) => ({ ...s, order: i + 1 })),
          message: text(input.message, 2000),
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new UserError("The signing service didn't answer. Try again in a moment.", 502);
    }
    if (!res.ok) throw new UserError(`The signing service refused the contract (${res.status})`, 502);
    const out = (await res.json().catch(() => ({}))) as { id?: string; url?: string };
    signRef = out.id ? String(out.id).slice(0, 200) : null;
    if (out.url && /^https?:\/\//i.test(out.url)) signUrl = out.url.slice(0, 1000);
  }
  await tx(async (tq) => {
    await tq(`UPDATE contracts SET status = 'signing', sign_ref = $2, sign_url = $3, modified_at = now() WHERE id = $1`, [id, signRef, signUrl]);
    await logEvent(tq, id, "signing", `Sent to ${signers.map((s) => s.email).join(", ")}`, me.email);
  });
  return { signUrl, sent: signingConfigured() };
}

function tokenOk(header: string | null): boolean {
  const want = process.env.CONTRACTS_SIGN_TOKEN;
  if (!want || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

type EventBody = { type?: string; ref?: string; data?: { dealRef?: string; event?: string; signerEmail?: string; documentId?: string } };

/** Applies one signature event. Unknown contracts get 202 { unmatched: true }, as Sign expects. */
export async function applySignEvent(token: string | null, body: EventBody): Promise<{ status: number; json: unknown }> {
  if (!tokenOk(token)) return { status: 401, json: { error: "Unauthorized" } };
  if (body?.type !== "contract.event" || typeof body.ref !== "string" || !body.data) return { status: 400, json: { error: "Not a contract.event" } };
  const deal = String(body.data.dealRef ?? "");
  const id = deal.startsWith("contract:") ? deal.slice(9) : "";
  if (!uuidish(id)) return { status: 202, json: { unmatched: true } };
  const [c] = await q<{ status: string }>(`SELECT status FROM contracts WHERE id = $1 AND held_deleted_at IS NULL`, [id]);
  if (!c) return { status: 202, json: { unmatched: true } };
  const [fresh] = await q(`INSERT INTO sign_events_seen (ref) VALUES ($1) ON CONFLICT DO NOTHING RETURNING ref`, [body.ref.slice(0, 300)]);
  if (!fresh) return { status: 200, json: { ok: true, duplicate: true } };
  const who = text(body.data.signerEmail, 200) || "signing service";
  await tx(async (tq) => {
    switch (body.data!.event) {
      case "sent":
        await tq(`UPDATE contracts SET status = 'signing', sign_ref = COALESCE(sign_ref, $2), modified_at = now() WHERE id = $1 AND status IN ('approved', 'signing')`, [
          id, text(body.data!.documentId, 200) || null,
        ]);
        await logEvent(tq, id, "signing", "Out for signature", "signing service");
        break;
      case "signer_signed":
        await logEvent(tq, id, "signer signed", who, "signing service");
        break;
      case "completed":
        if (["approved", "signing"].includes(c.status)) await markSigned("signing service", id, tq);
        else await logEvent(tq, id, "signed", "Signing finished", "signing service");
        break;
      case "declined":
      case "expired":
        await tq(`UPDATE contracts SET status = 'approved', sign_ref = NULL, modified_at = now() WHERE id = $1 AND status = 'signing'`, [id]);
        await logEvent(tq, id, `signature ${body.data!.event}`, body.data!.event === "declined" ? `${who} declined to sign` : "The signing request expired", "signing service");
        break;
      default:
        await logEvent(tq, id, "signing", text(body.data!.event, 60), "signing service");
    }
  });
  return { status: 200, json: { ok: true } };
}
