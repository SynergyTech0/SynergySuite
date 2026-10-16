import { centsToDecimal } from "./money";
import type { JournalLine } from "./payroll/journal";

/**
 * Posts a finished pay run's journal to Books (POST /api/svc/journals with BOOKS_SVC_TOKEN, the
 * same token the Portal uses for its invoice feed). Books makes any payroll account that is missing
 * and refuses the same reference twice, so posting again after a failure is safe.
 */

export function booksConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.BOOKS_SVC_TOKEN);
}

export function booksUrl(env: NodeJS.ProcessEnv = process.env): string {
  const u = env.BOOKS_INTERNAL_URL || (env.NODE_ENV === "production" ? "http://books:3055" : "http://localhost:3055");
  return u.replace(/\/$/, "");
}

export interface PostJournal {
  reference: string;
  date: string;
  description: string;
  organizationId?: string;
  lines: JournalLine[];
}

export async function postJournal(j: PostJournal, opts: { fetch?: typeof fetch; env?: NodeJS.ProcessEnv } = {}): Promise<{ journalId: string; journalNumber: string }> {
  const env = opts.env ?? process.env;
  const f = opts.fetch ?? fetch;
  const res = await f(`${booksUrl(env)}/api/svc/journals`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.BOOKS_SVC_TOKEN ?? ""}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      reference: j.reference,
      date: j.date,
      description: j.description,
      source: "PAYROLL",
      ...(j.organizationId ? { organizationId: j.organizationId } : {}),
      lines: j.lines.map((l) => ({
        account: l.account,
        debit: centsToDecimal(l.debitCents),
        credit: centsToDecimal(l.creditCents),
        description: l.description,
      })),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; journalNumber?: string; message?: string | string[]; error?: string };
  if (!res.ok) {
    const msg = Array.isArray(data.message) ? data.message.join("; ") : data.message || data.error;
    throw new Error(res.status === 401 ? "Books refused BOOKS_SVC_TOKEN" : msg || `Books answered ${res.status}`);
  }
  return { journalId: String(data.id ?? ""), journalNumber: String(data.journalNumber ?? "") };
}
