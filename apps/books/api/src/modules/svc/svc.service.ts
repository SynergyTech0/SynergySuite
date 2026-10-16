import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerService } from '../customer/customer.service';
import { InvoiceService } from '../customer/invoice.service';

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

/** What `POST /api/svc/invoices` takes (see apps/projects/lib/books.ts). */
export interface DraftInvoiceInput {
  customer: { name: string; email?: string };
  invoiceDate: string;
  memo?: string;
  reference?: string;
  lines: { description: string; quantity: number; unitPrice: number }[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Checks a draft invoice request; throws 400 with what is wrong. */
export function parseDraftInvoice(body: unknown): DraftInvoiceInput {
  const b = (body ?? {}) as Record<string, any>;
  const name = typeof b.customer?.name === 'string' ? b.customer.name.trim().slice(0, 255) : '';
  const email = typeof b.customer?.email === 'string' ? b.customer.email.trim().toLowerCase() : '';
  if (!name && !email) throw new BadRequestException('customer needs a name or an email');
  if (email && !EMAIL.test(email)) throw new BadRequestException('customer.email is not an email address');
  if (typeof b.invoiceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.invoiceDate) || Number.isNaN(Date.parse(b.invoiceDate))) {
    throw new BadRequestException('invoiceDate must be YYYY-MM-DD');
  }
  if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 500) throw new BadRequestException('lines must hold 1 to 500 lines');
  const lines = b.lines.map((l: any, i: number) => {
    const description = typeof l?.description === 'string' ? l.description.trim().slice(0, 500) : '';
    const quantity = Number(l?.quantity);
    const unitPrice = Number(l?.unitPrice);
    if (!description) throw new BadRequestException(`line ${i + 1} needs a description`);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new BadRequestException(`line ${i + 1} needs a quantity above 0`);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new BadRequestException(`line ${i + 1} needs a unit price of 0 or more`);
    return { description, quantity, unitPrice };
  });
  return {
    customer: { name: name || email, ...(email ? { email } : {}) },
    invoiceDate: b.invoiceDate,
    memo: typeof b.memo === 'string' ? b.memo.slice(0, 1000) : undefined,
    reference: typeof b.reference === 'string' ? b.reference.slice(0, 50) : undefined,
    lines,
  };
}

@Injectable()
export class SvcService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomerService,
    private readonly invoices: InvoiceService,
  ) {}

  /**
   * The company feeds write to: BOOKS_SVC_ORG_ID, or the first one created (Books makes one
   * company per install for its first user).
   */
  private async company(): Promise<string> {
    const id = process.env.BOOKS_SVC_ORG_ID;
    const org = id
      ? await this.prisma.organization.findUnique({ where: { id }, select: { id: true } })
      : await this.prisma.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!org) throw new ConflictException('Books has no company yet: open Books once to create it');
    return org.id;
  }

  /** A draft invoice for the customer with that email (or name), made if Books doesn't have them yet. */
  async createDraftInvoice(input: DraftInvoiceInput): Promise<{ id: string; number: string }> {
    const organizationId = await this.company();
    const { name, email } = input.customer;
    const existing =
      (email && (await this.prisma.customer.findFirst({ where: { organizationId, email: { equals: email, mode: 'insensitive' } }, orderBy: { createdAt: 'asc' } }))) ||
      (await this.prisma.customer.findFirst({ where: { organizationId, name: { equals: name, mode: 'insensitive' } }, orderBy: { createdAt: 'asc' } }));
    const customer = existing ?? (await this.customers.create(organizationId, { name, ...(email ? { email } : {}) } as any));
    const invoice = await this.invoices.create(organizationId, {
      customerId: customer.id,
      invoiceDate: input.invoiceDate,
      memo: input.memo,
      poNumber: input.reference,
      lines: input.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice })),
    } as any);
    return { id: invoice.id, number: invoice.invoiceNumber };
  }

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
}
