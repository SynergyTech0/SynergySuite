import { appUrl } from "@synergy/config";
import { UserError } from "./util";

/**
 * Law sends money to Synergy Books through Books' service feed (Bearer BOOKS_SVC_TOKEN, or
 * LAW_BOOKS_TOKEN to give Law its own): a bill becomes a draft invoice that is reviewed and sent
 * from Books, and each trust transaction becomes a posted journal entry on the trust bank account
 * and the client trust liability, so the firm's ledger and its trust ledger agree.
 * Without a token Law keeps its own records and nothing is sent.
 */

export function booksToken(env: NodeJS.ProcessEnv = process.env): string {
  return env.LAW_BOOKS_TOKEN || env.BOOKS_SVC_TOKEN || "";
}

export function booksConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!booksToken(env);
}

export function booksInternalUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.BOOKS_INTERNAL_URL) return env.BOOKS_INTERNAL_URL.replace(/\/+$/, "");
  return env.NODE_ENV === "production" ? "http://books:3055" : "http://localhost:3055";
}

export function booksInvoicesUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${appUrl("books", env)}/invoices`;
}

/** The Books account numbers trust money posts to. Each must exist in Books' chart of accounts. */
export function trustAccounts(env: NodeJS.ProcessEnv = process.env) {
  return {
    bank: env.LAW_BOOKS_TRUST_BANK || "1015",
    liability: env.LAW_BOOKS_TRUST_LIABILITY || "2150",
    operating: env.LAW_BOOKS_OPERATING || "1010",
    receivable: env.LAW_BOOKS_RECEIVABLE || "1100",
  };
}

const g = globalThis as unknown as { __lawBooksFetch?: typeof fetch };

/** Swaps the fetch used to reach Books, for tests. */
export function setBooksFetch(f: typeof fetch | undefined): void {
  g.__lawBooksFetch = f;
}

async function send<T>(path: string, body: unknown, what: string, env: NodeJS.ProcessEnv): Promise<T> {
  const f = g.__lawBooksFetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${booksInternalUrl(env)}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${booksToken(env)}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new UserError(`Books didn't answer, so the ${what} wasn't sent. Try again in a moment.`, 502);
  }
  const data = (await res.json().catch(() => ({}))) as T & { message?: string | string[] };
  if (!res.ok) {
    const why = Array.isArray(data.message) ? data.message.join("; ") : data.message;
    if (res.status === 401) throw new UserError(`Books refused the ${what}: check BOOKS_SVC_TOKEN matches on both apps`, 502);
    throw new UserError(`Books refused the ${what}${why ? `: ${why}` : ` (${res.status})`}`, 502);
  }
  return data;
}

export type BooksDraft = {
  customer: { name: string; email?: string };
  invoiceDate: string;
  memo: string;
  reference: string;
  currency: string;
  lines: { description: string; quantity: number; unitPrice: number }[];
};

export async function createDraftInvoice(draft: BooksDraft, env: NodeJS.ProcessEnv = process.env): Promise<{ id: string; number: string }> {
  const out = await send<{ id?: string; number?: string }>("/api/svc/invoices", draft, "invoice", env);
  if (!out.id) throw new UserError("Books refused the invoice", 502);
  return { id: out.id, number: out.number ?? "" };
}

export type PostingLine = { account: string; debit: number; credit: number; description: string };

/** A balanced journal entry; Books records each reference once. */
export async function post(
  p: { reference: string; date: string; description: string; lines: PostingLine[] },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ id: string; journalNumber: string }> {
  return send("/api/svc/postings", { ...p, kind: "adjustment" }, "trust entry", env);
}

/** The journal lines for a trust transaction in dollars; a void swaps debits and credits. */
export function trustLines(kind: string, cents: number, label: string, voided = false, env: NodeJS.ProcessEnv = process.env): PostingLine[] {
  const a = trustAccounts(env);
  const amt = cents / 100;
  const pair = (dr: string, cr: string, what: string): PostingLine[] => [
    { account: dr, debit: amt, credit: 0, description: what },
    { account: cr, debit: 0, credit: amt, description: what },
  ];
  let lines: PostingLine[];
  if (kind === "deposit") lines = pair(a.bank, a.liability, `Trust deposit: ${label}`);
  else if (kind === "disbursement") lines = pair(a.liability, a.bank, `Trust disbursement: ${label}`);
  else lines = [...pair(a.liability, a.bank, `Earned fees from trust: ${label}`), ...pair(a.operating, a.receivable, `Fees paid from trust: ${label}`)];
  return voided ? lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit, description: `Void: ${l.description}` })) : lines;
}
