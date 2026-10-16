import { Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

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
