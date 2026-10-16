import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { InvoiceService } from './invoice.service';

/**
 * Collect a Books invoice online: mirror it to a hosted Stripe invoice through
 * the shared synergy-payments service (which holds the Stripe keys — this
 * module never talks to Stripe directly, same pattern as StripeFcService).
 *
 * sendToStripe()  — create + finalize the Stripe invoice (optionally have
 *                   Stripe email it), store the hosted payment URL on our row.
 * refreshStatus() — poll the Stripe invoice; when it's paid, record the
 *                   payment through the normal recordPayment path so the GL
 *                   entry, customer balance, and status all post correctly.
 */
@Injectable()
export class StripeCollectService {
  private readonly logger = new Logger(StripeCollectService.name);
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly invoiceService: InvoiceService,
  ) {
    // Compose provides PAY_SERVICE_*; PAYMENTS_* kept as a legacy fallback.
    this.baseUrl = (
      this.config.get<string>('PAY_SERVICE_URL') ||
      this.config.get<string>('PAYMENTS_URL') ||
      'http://host.docker.internal:9095'
    ).replace(/\/$/, '');
    this.token =
      this.config.get<string>('PAY_SERVICE_TOKEN') || this.config.get<string>('PAYMENTS_TOKEN') || '';
  }

  private async call<T = any>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        ...(init.headers ?? {}),
      },
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new BadRequestException(
        `synergy-payments ${res.status}: ${body?.message ?? body?.detail ?? 'request failed'}`,
      );
    }
    return body as T;
  }

  async sendToStripe(organizationId: string, invoiceId: string, opts: { send?: boolean } = {}) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: {
        customer: { select: { name: true, email: true } },
        lineItems: { orderBy: { lineNumber: 'asc' } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.stripeInvoiceId) {
      throw new BadRequestException('Invoice is already linked to a Stripe invoice — use refresh.');
    }
    if (['VOIDED', 'WRITTEN_OFF', 'PAID'].includes(invoice.status)) {
      throw new BadRequestException(`Cannot collect a ${invoice.status} invoice`);
    }
    if (!invoice.customer.email) {
      throw new BadRequestException('Customer has no email address on file');
    }

    const dueDays = Math.max(
      1,
      Math.ceil((new Date(invoice.dueDate).getTime() - Date.now()) / 86_400_000),
    );
    const remaining = Number(invoice.amountDue);
    // One Stripe line per Books line, scaled if partially paid; tax as its own line.
    const scale = remaining / Math.max(Number(invoice.totalAmount), 0.01);
    const lineItems = invoice.lineItems.map((li) => ({
      description: li.description,
      amount_cents: Math.round(Number(li.amount) * scale * 100),
      quantity: 1,
    }));
    if (Number(invoice.taxAmount) > 0) {
      lineItems.push({
        description: 'Tax',
        amount_cents: Math.round(Number(invoice.taxAmount) * scale * 100),
        quantity: 1,
      });
    }
    // Rounding drift → adjust the last line so the Stripe total equals amountDue.
    const target = Math.round(remaining * 100);
    const drift = target - lineItems.reduce((s, l) => s + l.amount_cents, 0);
    if (drift !== 0 && lineItems.length) lineItems[lineItems.length - 1].amount_cents += drift;

    const result = await this.call<{
      invoice_id: string; status: string; hosted_invoice_url: string; total_cents: number;
    }>('/invoicing/invoice', {
      method: 'POST',
      body: JSON.stringify({
        email: invoice.customer.email,
        name: invoice.customer.name,
        line_items: lineItems,
        days_until_due: dueDays,
        finalize: true,
        send: opts.send ?? false,
        memo: `Invoice ${invoice.invoiceNumber}`,
      }),
    });

    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        stripeInvoiceId: result.invoice_id,
        stripeHostedUrl: result.hosted_invoice_url,
        status: invoice.status === 'DRAFT' ? 'SENT' : invoice.status,
        sentAt: invoice.sentAt ?? new Date(),
      },
    });
    this.logger.log(`Invoice ${invoice.invoiceNumber} → Stripe ${result.invoice_id} (${result.total_cents}¢)`);
    return {
      stripeInvoiceId: result.invoice_id,
      hostedUrl: result.hosted_invoice_url,
      totalCents: result.total_cents,
      emailed: opts.send ?? false,
    };
  }

  async refreshStatus(organizationId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      select: {
        id: true, stripeInvoiceId: true, stripeHostedUrl: true,
        amountDue: true, status: true, invoiceNumber: true,
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (!invoice.stripeInvoiceId) throw new BadRequestException('Invoice is not linked to Stripe');

    const s = await this.call<{ status: string; amount_paid_cents: number; total_cents: number }>(
      `/invoicing/invoice/${invoice.stripeInvoiceId}`,
    );

    let recorded = false;
    if (s.status === 'paid' && Number(invoice.amountDue) > 0) {
      const amount = Math.min(s.amount_paid_cents / 100, Number(invoice.amountDue));
      await this.invoiceService.recordPayment(organizationId, invoiceId, {
        paymentDate: new Date().toISOString(),
        amount,
        paymentMethod: 'STRIPE',
        reference: invoice.stripeInvoiceId,
        notes: 'Paid via Stripe hosted invoice',
      } as any);
      recorded = true;
    }
    return {
      stripeInvoiceId: invoice.stripeInvoiceId,
      stripeStatus: s.status,
      hostedUrl: invoice.stripeHostedUrl,
      paymentRecorded: recorded,
    };
  }
}
