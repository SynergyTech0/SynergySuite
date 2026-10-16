import { appUrl } from "@synergy/config";
import { UserError } from "./util";

/**
 * Billing goes to Synergy Books as a draft invoice, through Books' service feed
 * (POST /api/svc/invoices, Bearer BOOKS_SVC_TOKEN). The draft is reviewed and sent from Books,
 * which posts it to the ledger then. Without a token Projects records the billing itself and
 * the lines can be downloaded instead.
 */

export type BooksLine = { description: string; quantity: number; unitPrice: number };

export type BooksDraft = {
  customer: { name: string; email?: string };
  invoiceDate: string;
  memo: string;
  reference: string;
  currency: string;
  lines: BooksLine[];
};

export type BooksInvoice = { id: string; number: string };

export function booksToken(env: NodeJS.ProcessEnv = process.env): string {
  return env.PROJECTS_BOOKS_TOKEN || env.BOOKS_SVC_TOKEN || "";
}

export function booksConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!booksToken(env);
}

/** Where Projects reaches Books on the internal network. */
export function booksInternalUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.BOOKS_INTERNAL_URL) return env.BOOKS_INTERNAL_URL.replace(/\/+$/, "");
  return env.NODE_ENV === "production" ? "http://books:3055" : "http://localhost:3055";
}

/** Where a person opens Books' invoices. */
export function booksInvoicesUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${appUrl("books", env)}/invoices`;
}

const g = globalThis as unknown as { __projectsBooksFetch?: typeof fetch };

/** Swaps the fetch used to reach Books, for tests. */
export function setBooksFetch(f: typeof fetch | undefined): void {
  g.__projectsBooksFetch = f;
}

export async function createDraftInvoice(draft: BooksDraft, env: NodeJS.ProcessEnv = process.env): Promise<BooksInvoice> {
  const f = g.__projectsBooksFetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${booksInternalUrl(env)}/api/svc/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${booksToken(env)}` },
      body: JSON.stringify(draft),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new UserError("Books didn't answer, so nothing was billed. Try again in a moment.", 502);
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string; number?: string; message?: string | string[] };
  if (!res.ok || !data.id) {
    const why = Array.isArray(data.message) ? data.message.join("; ") : data.message;
    if (res.status === 401) throw new UserError("Books refused the invoice: check BOOKS_SVC_TOKEN matches on both apps", 502);
    throw new UserError(`Books refused the invoice${why ? `: ${why}` : ` (${res.status})`}`, 502);
  }
  return { id: data.id, number: data.number ?? "" };
}
