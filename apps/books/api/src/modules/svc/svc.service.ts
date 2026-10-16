import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalSource, JournalType } from '../journal/dto/journal.dto';
import { JournalService } from '../journal/journal.service';
import type { SvcPosting } from './postings';

/** The shape the Portal add-on reads from `GET /api/svc/invoices` (see addons/portal/server/index.js). */
export interface SvcInvoice {
  number: string;
  status: 'open' | 'paid' | 'void';
  total_cents: number;
  amount_paid_cents: number;
  hosted_url: string | null;
  pdf_url: string | null;
  created_at: string;
}

/** True when the request carries `Authorization: Bearer <BOOKS_SVC_TOKEN>`. With no token set, the feed is off. */
export function svcAuthorized(header: string | undefined, token = process.env.BOOKS_SVC_TOKEN || ''): boolean {
  if (!token || !header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Books keeps many invoice states; the portal only shows due, paid and void. */
export function portalStatus(status: string): SvcInvoice['status'] {
  if (status === 'PAID') return 'paid';
  if (status === 'VOID' || status === 'WRITTEN_OFF') return 'void';
  return 'open';
}

const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);

@Injectable()
export class SvcService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journals: JournalService,
  ) {}

  /** A customer's sent invoices, newest first. Drafts never leave Books. */
  async invoicesFor(email: string): Promise<SvcInvoice[]> {
    const rows = await this.prisma.invoice.findMany({
      where: {
        status: { not: 'DRAFT' },
        customer: { email: { equals: email.trim(), mode: 'insensitive' } },
      },
      include: { customer: { include: { portalAccess: true } } },
      orderBy: { invoiceDate: 'desc' },
      take: 100,
    });
    return rows.map((i) => {
      const access = i.customer.portalAccess;
      return {
        number: i.invoiceNumber,
        status: portalStatus(i.status),
        total_cents: cents(i.totalAmount),
        amount_paid_cents: cents(i.amountPaid),
        // Pay online where a payment link exists, otherwise open the customer's Books portal.
        hosted_url: i.stripeHostedUrl || (access?.isActive ? access.accessUrl ?? null : null),
        pdf_url: null,
        created_at: i.invoiceDate.toISOString(),
      };
    });
  }

  /**
   * Posts a balanced journal entry sent by another suite app (HR payroll). Accounts are named by
   * number; one that doesn't exist yet is made with the given name and type. The same reference
   * from the same source is posted once: sending it again returns the first entry.
   */
  async postJournal(j: SvcJournal): Promise<{ id: string; journalNumber: string; existing: boolean }> {
    const organizationId = await this.organizationFor(j.organizationId);
    const existing = await this.prisma.journal.findFirst({
      where: { organizationId, sourceType: j.source as any, sourceId: j.reference, status: { not: 'VOIDED' } },
    });
    if (existing) return { id: existing.id, journalNumber: existing.journalNumber, existing: true };

    const accountIds = new Map<string, string>();
    for (const l of j.lines) {
      if (accountIds.has(l.account.number)) continue;
      let acct = await this.prisma.account.findFirst({ where: { organizationId, accountNumber: l.account.number } });
      if (!acct) {
        acct = await this.prisma.account.create({
          data: {
            organizationId,
            accountNumber: l.account.number,
            name: l.account.name,
            accountType: l.account.type as any,
            normalBalance: (l.account.type === 'ASSET' || l.account.type === 'EXPENSE' ? 'DEBIT' : 'CREDIT') as any,
            isActive: true,
          },
        });
      }
      if (!acct.isActive) throw new BadRequestException(`Account ${acct.accountNumber} is turned off in Books`);
      accountIds.set(l.account.number, acct.id);
    }

    const journal = await this.journals.create(organizationId, {
      date: j.date,
      type: JournalType.GENERAL,
      source: j.source as JournalSource,
      reference: j.reference,
      description: j.description,
      lines: j.lines.map((l) => ({
        accountId: accountIds.get(l.account.number)!,
        debit: l.debit || undefined,
        credit: l.credit || undefined,
        description: l.description,
      })),
    });
    await this.prisma.journal.update({ where: { id: journal.id }, data: { sourceId: j.reference } });
    await this.journals.post(organizationId, journal.id);
    return { id: journal.id, journalNumber: journal.journalNumber, existing: false };
  }

  /** The organization named, else BOOKS_SVC_ORGANIZATION_ID, else the only one there is. */
  private async organizationFor(id?: string): Promise<string> {
    const wanted = id || process.env.BOOKS_SVC_ORGANIZATION_ID;
    if (wanted) {
      const org = await this.prisma.organization.findUnique({ where: { id: wanted } });
      if (!org) throw new BadRequestException('Books has no organization with that ID');
      return org.id;
    }
    const orgs = await this.prisma.organization.findMany({ select: { id: true }, take: 2 });
    if (orgs.length === 1) return orgs[0].id;
    throw new BadRequestException(
      orgs.length
        ? 'Books has more than one organization: name the one to post to'
        : 'Books has no organization yet: open Books once to set it up',
    );
  }

  /**
   * The company other apps post into: BOOKS_SVC_ORG (its id or SynergyAuth id) when set, otherwise
   * the first one, which is the company Books makes for its first user.
   */
  private async organizationId(): Promise<string> {
    const want = (process.env.BOOKS_SVC_ORG || '').trim();
    const org = want
      ? await this.prisma.organization.findFirst({ where: { OR: [{ id: want }, { externalId: want }] } })
      : await this.prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!org) throw new ConflictException('Books has no company yet: open Books once to set it up');
    return org.id;
  }

  async accounts() {
    const organizationId = await this.organizationId();
    const rows = await this.prisma.account.findMany({
      where: { organizationId, isActive: true },
      orderBy: { accountNumber: 'asc' },
      select: { accountNumber: true, name: true, accountType: true },
    });
    return rows.map((a) => ({ number: a.accountNumber, name: a.name, type: a.accountType }));
  }

  /**
   * Records a posting as a posted journal entry, plus an approved bill for a vendor delivery.
   * The reference is kept as the entry's source id; a repeat returns what was made the first time.
   */
  async record(p: SvcPosting) {
    const organizationId = await this.organizationId();
    let journal = await this.prisma.journal.findFirst({
      where: { organizationId, sourceId: p.reference, status: { not: 'VOIDED' } },
    });
    const duplicate = Boolean(journal);
    if (!journal) {
      const numbers = [...new Set(p.lines.map((l) => l.account))];
      const accounts = await this.prisma.account.findMany({ where: { organizationId, accountNumber: { in: numbers }, isActive: true } });
      const byNumber = new Map(accounts.map((a) => [a.accountNumber, a.id]));
      const missing = numbers.filter((n) => !byNumber.has(n));
      if (missing.length) throw new BadRequestException(`Books has no active account ${missing.join(', ')}; add it or change the account in the sending app`);
      const source = { sale: 'RECEIPT', refund: 'PAYMENT', receipt: 'BILL', adjustment: 'ADJUSTMENT' }[p.kind];
      const created = await this.journals.create(organizationId, {
        date: p.date,
        type: 'GENERAL' as any,
        source: source as any,
        reference: p.bill?.number ?? p.reference.split(':').pop(),
        description: p.description,
        tags: ['commerce'],
        lines: p.lines.map((l) => ({ accountId: byNumber.get(l.account)!, debit: l.debit || undefined, credit: l.credit || undefined, description: l.description })),
      } as any);
      await this.prisma.journal.update({ where: { id: created.id }, data: { sourceId: p.reference } });
      journal = await this.journals.post(organizationId, created.id);
    }
    if (p.bill) await this.billFor(organizationId, p, journal.id);
    return { id: journal.id, journalNumber: journal.journalNumber, duplicate };
  }

  /** The vendor's bill for a delivery, linked to its journal entry so the amount isn't booked twice. */
  private async billFor(organizationId: string, p: SvcPosting, journalId: string) {
    const bill = p.bill!;
    const existing = await this.prisma.bill.findFirst({ where: { organizationId, journalId } });
    if (existing) return existing;
    const vendor =
      (bill.vendor.email
        ? await this.prisma.vendor.findFirst({ where: { organizationId, email: { equals: bill.vendor.email, mode: 'insensitive' } } })
        : null) ??
      (await this.prisma.vendor.findFirst({ where: { organizationId, name: { equals: bill.vendor.name, mode: 'insensitive' } } })) ??
      (await this.prisma.vendor.create({ data: { organizationId, name: bill.vendor.name, email: bill.vendor.email || null } }));
    const debits = p.lines.filter((l) => l.debit > 0);
    const total = debits.reduce((a, l) => a + Math.round(l.debit * 100), 0) / 100;
    const inventory = await this.prisma.account.findFirst({ where: { organizationId, accountNumber: debits[0]?.account } });
    const billDate = new Date(`${p.date}T00:00:00Z`);
    return this.prisma.bill.create({
      data: {
        id: uuidv4(),
        organizationId,
        vendorId: vendor.id,
        billNumber: bill.number,
        billDate,
        dueDate: new Date(billDate.getTime() + (vendor.paymentTerms ?? bill.dueDays) * 86_400_000),
        vendorInvoiceNumber: bill.vendorRef || null,
        status: 'APPROVED',
        approvedAt: new Date(),
        subtotal: total,
        totalAmount: total,
        amountDue: total,
        balance: total,
        notes: p.description,
        journalId,
        lineItems: {
          create: [{ id: uuidv4(), lineNumber: 1, description: p.description, quantity: 1, unitPrice: total, amount: total, accountId: inventory?.id ?? null }],
        },
      },
    });
  }
}

const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;
const SOURCES = ['PAYROLL'] as const;

export interface SvcJournalLine {
  account: { number: string; name: string; type: (typeof ACCOUNT_TYPES)[number] };
  debit: number;
  credit: number;
  description?: string;
}

export interface SvcJournal {
  reference: string;
  date: string;
  description: string;
  source: (typeof SOURCES)[number];
  organizationId?: string;
  lines: SvcJournalLine[];
}

/** Amounts arrive as decimal strings ("1234.56") so nothing is lost in transit. */
function amount(v: unknown): number {
  const s = typeof v === 'number' ? String(v) : String(v ?? '0');
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(s)) throw new BadRequestException('Amounts are positive numbers with at most two decimals');
  return Number(s);
}

/** Checks a POST /api/svc/journals body. */
export function parseSvcJournal(body: unknown): SvcJournal {
  const b = (body ?? {}) as Record<string, any>;
  const reference = String(b.reference ?? '').trim();
  if (!/^[\w.:-]{1,60}$/.test(reference)) throw new BadRequestException('reference is required (letters, digits, - _ . :)');
  const date = String(b.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new BadRequestException('date must be YYYY-MM-DD');
  const source = SOURCES.includes(b.source) ? b.source : null;
  if (!source) throw new BadRequestException(`source must be one of ${SOURCES.join(', ')}`);
  if (!Array.isArray(b.lines) || b.lines.length < 2 || b.lines.length > 100) throw new BadRequestException('lines must have 2 to 100 entries');
  const lines: SvcJournalLine[] = b.lines.map((l: any) => {
    const number = String(l?.account?.number ?? '').trim();
    const name = String(l?.account?.name ?? '').trim().slice(0, 200);
    const type = String(l?.account?.type ?? '');
    if (!/^[A-Za-z0-9.-]{1,20}$/.test(number) || !name) throw new BadRequestException('Each line needs an account number and name');
    if (!(ACCOUNT_TYPES as readonly string[]).includes(type)) throw new BadRequestException(`account type must be one of ${ACCOUNT_TYPES.join(', ')}`);
    const debit = amount(l.debit);
    const credit = amount(l.credit);
    if ((debit > 0) === (credit > 0)) throw new BadRequestException('Each line has either a debit or a credit');
    return { account: { number, name, type: type as SvcJournalLine['account']['type'] }, debit, credit, description: String(l.description ?? '').slice(0, 500) || undefined };
  });
  const cents = (k: 'debit' | 'credit') => lines.reduce((s, l) => s + Math.round(l[k] * 100), 0);
  if (cents('debit') !== cents('credit')) throw new BadRequestException('Debits and credits must be equal');
  const organizationId = b.organizationId ? String(b.organizationId).slice(0, 100) : undefined;
  return { reference, date, description: String(b.description ?? '').slice(0, 500), source, organizationId, lines };
}
