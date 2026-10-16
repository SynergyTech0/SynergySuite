import { BadRequestException } from '@nestjs/common';

/**
 * A journal entry another suite app asks Books to record (`POST /api/svc/postings`). Commerce
 * sends one for every sale, refund, delivery and stock adjustment. `reference` is the sender's
 * idempotency key: sending the same one again returns the entry already made.
 */
export interface SvcPosting {
  reference: string;
  kind: 'sale' | 'refund' | 'receipt' | 'adjustment';
  date: string;
  description: string;
  lines: { account: string; debit: number; credit: number; description: string }[];
  /** A delivery from a vendor is also recorded as an approved bill, so it shows in payables. */
  bill?: { vendor: { name: string; email: string }; number: string; vendorRef: string; dueDays: number };
}

const KINDS = ['sale', 'refund', 'receipt', 'adjustment'] as const;

function str(v: unknown, what: string, max: number, required = true): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new BadRequestException(`${what} is required`);
  if (s.length > max) throw new BadRequestException(`${what} is too long`);
  return s;
}

function amount(v: unknown, what: string): number {
  const n = Number(v ?? 0);
  const c = n * 100;
  if (!Number.isFinite(n) || n < 0 || Math.abs(c - Math.round(c)) > 1e-6) {
    throw new BadRequestException(`${what} must be a positive amount with at most two decimals`);
  }
  return Math.round(n * 100) / 100;
}

/** Checks a posting's shape and that it balances to the cent. */
export function parsePosting(body: unknown): SvcPosting {
  if (!body || typeof body !== 'object') throw new BadRequestException('Bad request body');
  const b = body as Record<string, unknown>;
  const reference = str(b.reference, 'reference', 200);
  const kind = b.kind as SvcPosting['kind'];
  if (!KINDS.includes(kind)) throw new BadRequestException('kind must be sale, refund, receipt or adjustment');
  const date = str(b.date, 'date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new BadRequestException('date must be YYYY-MM-DD');
  if (!Array.isArray(b.lines) || b.lines.length < 2 || b.lines.length > 200) throw new BadRequestException('A posting needs 2 to 200 lines');
  const lines = b.lines.map((raw, i) => {
    const l = (raw ?? {}) as Record<string, unknown>;
    const debit = amount(l.debit, `Line ${i + 1} debit`);
    const credit = amount(l.credit, `Line ${i + 1} credit`);
    if ((debit > 0) === (credit > 0)) throw new BadRequestException(`Line ${i + 1} needs a debit or a credit, not both`);
    return { account: str(l.account, `Line ${i + 1} account`, 20), debit, credit, description: str(l.description, `Line ${i + 1} description`, 500, false) };
  });
  const diff = lines.reduce((a, l) => a + Math.round(l.debit * 100) - Math.round(l.credit * 100), 0);
  if (diff !== 0) throw new BadRequestException('The posting does not balance');
  let bill: SvcPosting['bill'];
  if (b.bill !== undefined && b.bill !== null) {
    const x = b.bill as Record<string, unknown>;
    const v = (x.vendor ?? {}) as Record<string, unknown>;
    const dueDays = Number(x.dueDays ?? 30);
    bill = {
      vendor: { name: str(v.name, 'bill vendor name', 200), email: str(v.email, 'bill vendor email', 254, false) },
      number: str(x.number, 'bill number', 60),
      vendorRef: str(x.vendorRef, 'bill vendor reference', 80, false),
      dueDays: Number.isInteger(dueDays) && dueDays >= 0 && dueDays <= 365 ? dueDays : 30,
    };
  }
  return { reference, kind, date, description: str(b.description, 'description', 500, false), lines, bill };
}
