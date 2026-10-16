/**
 * Commerce's accounting goes to Books. Every sale, refund, delivery and stock adjustment becomes a
 * balanced journal entry, written first to the `postings` outbox in the same transaction as the
 * change itself, then sent to Books' POST /api/svc/postings (Bearer BOOKS_SVC_TOKEN). Books keys
 * each entry by its reference, so sending one twice books it once. While Books is unreachable or
 * not set up, entries wait here and the Accounting page shows why.
 */
import { q, tx, type Tq } from "./db";
import { fromCents } from "./money";
import type { AccountKey, PaymentMethod, Posting, Settings } from "./types";

export type JLine = { account: string; debit: number; credit: number; description: string };

export type PostingPayload = {
  reference: string;
  kind: "sale" | "refund" | "receipt" | "adjustment";
  date: string;
  description: string;
  lines: JLine[];
  /** A delivery from a vendor also becomes a bill in Books, so it shows in what you owe. */
  bill?: { vendor: { name: string; email: string }; number: string; vendorRef: string; dueDays: number };
};

function line(s: Settings, key: AccountKey, debit: number, credit: number, description: string): JLine {
  return { account: s.accounts[key], debit, credit, description };
}

/** Drops empty lines and says whether anything is left to post. */
function tidy(lines: JLine[]): JLine[] {
  return lines.filter((l) => l.debit > 0 || l.credit > 0);
}

export function balanced(lines: JLine[]): boolean {
  return lines.reduce((a, l) => a + l.debit - l.credit, 0) === 0;
}

/**
 * A paid sale: the money in, by how it was paid, against sales and the tax collected; and what the
 * goods cost, out of inventory into cost of goods sold. All amounts in cents.
 */
export function saleLines(s: Settings, number: string, sale: { payments: { method: PaymentMethod; amount: number }[]; net: number; tax: number; cost: number }): JLine[] {
  const byMethod = new Map<PaymentMethod, number>();
  for (const p of sale.payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);
  return tidy([
    ...[...byMethod].map(([m, amt]) => line(s, m, amt, 0, `Sale ${number} (${m})`)),
    line(s, "sales", 0, sale.net, `Sale ${number}`),
    line(s, "tax", 0, sale.tax, `Sale ${number} tax`),
    line(s, "cogs", sale.cost, 0, `Sale ${number} cost`),
    line(s, "inventory", 0, sale.cost, `Sale ${number} cost`),
  ]);
}

/** Money given back: returns and the tax that is no longer owed, against the way it was paid out. */
export function refundLines(s: Settings, ref: string, r: { method: PaymentMethod; net: number; tax: number; cost: number; restock: boolean }): JLine[] {
  return tidy([
    line(s, "returns", r.net, 0, `Refund ${ref}`),
    line(s, "tax", r.tax, 0, `Refund ${ref} tax`),
    line(s, r.method, 0, r.net + r.tax, `Refund ${ref} (${r.method})`),
    ...(r.restock ? [line(s, "inventory", r.cost, 0, `Refund ${ref} restocked`), line(s, "cogs", 0, r.cost, `Refund ${ref} restocked`)] : []),
  ]);
}

/** Goods in from a vendor: inventory up, owed to the vendor. */
export function receiptLines(s: Settings, ref: string, value: number): JLine[] {
  return tidy([line(s, "inventory", value, 0, `Received ${ref}`), line(s, "payable", 0, value, `Received ${ref}`)]);
}

/** A count or adjustment: found stock (positive value) or lost stock (negative). */
export function adjustmentLines(s: Settings, ref: string, value: number, note: string): JLine[] {
  const d = `${note || "Stock adjustment"} ${ref}`.trim();
  return value >= 0
    ? tidy([line(s, "inventory", value, 0, d), line(s, "shrinkage", 0, value, d)])
    : tidy([line(s, "shrinkage", -value, 0, d), line(s, "inventory", 0, -value, d)]);
}

/**
 * Stock another app used or made (Operations: production, maintenance), valued at cost, against the
 * account it names, such as work in progress. Positive value is stock in, negative is stock out.
 */
export function offsetLines(s: Settings, account: string, value: number, description: string): JLine[] {
  const inv = s.accounts.inventory;
  return value >= 0
    ? tidy([{ account: inv, debit: value, credit: 0, description }, { account, debit: 0, credit: value, description }])
    : tidy([{ account, debit: -value, credit: 0, description }, { account: inv, debit: 0, credit: -value, description }]);
}

/** Queues an entry inside the caller's transaction. Nothing to post (all zero) queues nothing. */
export async function enqueue(tq: Tq, p: PostingPayload): Promise<void> {
  if (!p.lines.length) return;
  if (!balanced(p.lines)) throw new Error(`Posting ${p.reference} does not balance`);
  await tq(
    `INSERT INTO postings (reference, kind, date, payload) VALUES ($1, $2, $3, $4) ON CONFLICT (reference) DO NOTHING`,
    [p.reference, p.kind, p.date, JSON.stringify(p)],
  );
  kick();
}

/** What Books is sent: amounts as numbers with two decimals, as its journal API takes them. */
export function wire(p: PostingPayload) {
  return {
    ...p,
    lines: p.lines.map((l) => ({ account: l.account, debit: Number(fromCents(l.debit)), credit: Number(fromCents(l.credit)), description: l.description })),
  };
}

export function booksConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.BOOKS_INTERNAL_URL && env.BOOKS_SVC_TOKEN);
}

/** Waits longer after each failure: 1, 2, 4 … minutes, at most an hour. */
export function retryDue(attempts: number, triedAt: Date | null, now = Date.now()): boolean {
  if (!triedAt || attempts === 0) return true;
  const wait = Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000;
  return now - triedAt.getTime() >= wait;
}

type Row = { id: string; reference: string; payload: PostingPayload; attempts: number; tried_at: Date | null; status: string };

async function send(p: PostingPayload, env = process.env): Promise<{ ok: true; ref: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${env.BOOKS_INTERNAL_URL!.replace(/\/$/, "")}/api/svc/postings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.BOOKS_SVC_TOKEN}` },
      body: JSON.stringify(wire(p)),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; journalNumber?: string; message?: string | string[]; error?: string };
    if (!res.ok) {
      const msg = Array.isArray(data.message) ? data.message.join("; ") : data.message || data.error;
      return { ok: false, error: `Books said ${res.status}${msg ? `: ${msg}` : ""}` };
    }
    return { ok: true, ref: data.journalNumber || data.id || "" };
  } catch (e) {
    return { ok: false, error: `Books could not be reached (${(e as Error).message})` };
  }
}

const g = globalThis as unknown as { __commerceFlushing?: Promise<number>; __commerceKick?: ReturnType<typeof setTimeout> };

/** Sends what is waiting, oldest first. Only one send runs per process; replicas skip rows another holds. */
export function flush(opts: { force?: boolean } = {}): Promise<number> {
  if (!booksConfigured()) return Promise.resolve(0);
  g.__commerceFlushing ??= (async () => {
    let sent = 0;
    try {
      for (let i = 0; i < 500; i++) {
        const done = await tx(async (tq) => {
          const rows = await tq<Row>(
            `SELECT id, reference, payload, attempts, tried_at, status FROM postings
             WHERE status <> 'posted' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 20`,
          );
          const row = rows.find((r) => opts.force || retryDue(r.attempts, r.tried_at));
          if (!row) return null;
          const out = await send(row.payload);
          if (out.ok) {
            await tq("UPDATE postings SET status = 'posted', error = '', books_ref = $2, posted_at = now(), tried_at = now(), attempts = attempts + 1 WHERE id = $1", [row.id, out.ref]);
            sent++;
          } else {
            await tq("UPDATE postings SET status = 'failed', error = $2, tried_at = now(), attempts = attempts + 1 WHERE id = $1", [row.id, out.error]);
          }
          return row.id;
        });
        if (!done) break;
      }
    } finally {
      g.__commerceFlushing = undefined;
    }
    return sent;
  })();
  return g.__commerceFlushing;
}

/** Sends soon after a change, without making the person wait for Books. */
export function kick(): void {
  if (!booksConfigured() || g.__commerceKick) return;
  g.__commerceKick = setTimeout(() => {
    g.__commerceKick = undefined;
    flush().catch((e) => console.error("[commerce] books:", (e as Error).message));
  }, 500);
  g.__commerceKick.unref?.();
}

type ListRow = {
  id: string; reference: string; kind: string; date: string; status: Posting["status"]; error: string; attempts: number;
  books_ref: string | null; created_at: Date; posted_at: Date | null; payload: PostingPayload;
};

export async function listPostings(filter: { status?: string; limit?: number } = {}): Promise<{ postings: Posting[]; connected: boolean; waiting: number; failed: number }> {
  const rows = await q<ListRow>(
    `SELECT id, reference, kind, to_char(date, 'YYYY-MM-DD') AS date, status, error, attempts, books_ref, created_at, posted_at, payload
     FROM postings WHERE ($1::text IS NULL OR status = $1) ORDER BY id DESC LIMIT $2`,
    [filter.status || null, Math.min(filter.limit ?? 200, 500)],
  );
  const [counts] = await q<{ waiting: number; failed: number }>(
    "SELECT count(*) FILTER (WHERE status = 'pending')::int AS waiting, count(*) FILTER (WHERE status = 'failed')::int AS failed FROM postings",
  );
  return {
    connected: booksConfigured(),
    waiting: counts.waiting,
    failed: counts.failed,
    postings: rows.map((r) => ({
      id: String(r.id), reference: r.reference, kind: r.kind, date: r.date, status: r.status, error: r.error, attempts: r.attempts,
      booksRef: r.books_ref, createdAt: r.created_at.toISOString(), postedAt: r.posted_at?.toISOString() ?? null,
      total: fromCents(r.payload.lines.reduce((a, l) => a + l.debit, 0)), description: r.payload.description,
    })),
  };
}
