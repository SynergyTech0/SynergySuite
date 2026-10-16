import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalService } from '../journal/journal.service';

/**
 * SynergyExpense — spend cards whose feed IS the ledger.
 *
 * Card issuing/limits/transactions live in synergy-payments (Stripe Issuing);
 * this module renders them inside Books and posts card spend into the GL:
 *   Debit  — the expense account the bookkeeper picks
 *   Credit — 2115 "Issuing Card Clearing" (created on first use), which the
 *            Issuing balance top-up later offsets.
 * One CardTransactionPosting row per Stripe transaction keeps it idempotent.
 */
@Injectable()
export class CardsService {
  private readonly logger = new Logger(CardsService.name);
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly journalService: JournalService,
  ) {
    this.baseUrl = (
      this.config.get<string>('PAY_SERVICE_URL') ||
      this.config.get<string>('PAYMENTS_URL') ||
      'http://host.docker.internal:9095'
    ).replace(/\/$/, '');
    this.token =
      this.config.get<string>('PAY_SERVICE_TOKEN') || this.config.get<string>('PAYMENTS_TOKEN') || '';
  }

  private async pay<T = any>(path: string, init: RequestInit = {}): Promise<T> {
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

  async overview(organizationId: string) {
    const [balance, cards, disclosures, postedCount] = await Promise.all([
      this.pay<{ issuing: { available: { amount: number; currency: string }[] } }>('/issuing/balance'),
      this.pay<{ cards: any[] }>('/issuing/cards'),
      this.pay('/issuing/disclosures'),
      this.prisma.cardTransactionPosting.count({ where: { organizationId } }),
    ]);
    return {
      balanceCents: balance.issuing?.available?.[0]?.amount ?? 0,
      cards: cards.cards,
      disclosures,
      postedCount,
    };
  }

  async transactions(organizationId: string) {
    const [txns, postings] = await Promise.all([
      this.pay<{ transactions: any[] }>('/issuing/transactions'),
      this.prisma.cardTransactionPosting.findMany({ where: { organizationId } }),
    ]);
    const posted = new Map(postings.map((p) => [p.stripeTxnId, p]));
    return {
      transactions: txns.transactions.map((t) => ({
        ...t,
        posting: posted.get(t.id)
          ? { accountId: posted.get(t.id)!.accountId, journalId: posted.get(t.id)!.journalId }
          : null,
      })),
    };
  }

  /** Post one card transaction into the GL against the chosen expense account. */
  async categorize(organizationId: string, stripeTxnId: string, accountId: string, userId: string) {
    const existing = await this.prisma.cardTransactionPosting.findUnique({
      where: { organizationId_stripeTxnId: { organizationId, stripeTxnId } },
    });
    if (existing) throw new BadRequestException('Transaction is already posted to the books');

    const { transactions } = await this.pay<{ transactions: any[] }>('/issuing/transactions');
    const txn = transactions.find((t) => t.id === stripeTxnId);
    if (!txn) throw new BadRequestException('Transaction not found on the card feed');

    const expense = await this.prisma.account.findFirst({
      where: { organizationId, id: accountId },
    });
    if (!expense) throw new BadRequestException('Expense account not found');

    const clearing = await this.findOrCreateClearingAccount(organizationId);
    // Issuing captures are negative amounts (money out); refunds positive.
    const amount = Math.abs(txn.amount) / 100;
    const isRefund = txn.amount > 0;
    const desc = `Card spend${txn.merchant ? ` — ${txn.merchant}` : ''}`;

    const journal = await this.journalService.create(organizationId, {
      date: new Date((txn.created ?? Date.now() / 1000) * 1000).toISOString(),
      type: 'GENERAL' as any,
      source: 'MANUAL' as any,
      reference: stripeTxnId.slice(-12),
      description: desc,
      lines: isRefund
        ? [
            { accountId: clearing.id, debit: amount, description: `${desc} (refund)` },
            { accountId: expense.id, credit: amount, description: `${desc} (refund)` },
          ]
        : [
            { accountId: expense.id, debit: amount, description: desc },
            { accountId: clearing.id, credit: amount, description: desc },
          ],
    });
    await this.journalService.post(organizationId, journal.id);

    const posting = await this.prisma.cardTransactionPosting.create({
      data: {
        organizationId,
        stripeTxnId,
        accountId,
        journalId: journal.id,
        amountCents: txn.amount,
        description: txn.merchant ?? desc,
        cardLast4: null,
      },
    });
    this.logger.log(`Card txn ${stripeTxnId} posted to ${expense.name} (journal ${journal.id})`);
    return { posting, journalId: journal.id };
  }

  private async findOrCreateClearingAccount(organizationId: string) {
    const found = await this.prisma.account.findFirst({
      where: { organizationId, accountNumber: '2115' },
    });
    if (found) return found;
    return this.prisma.account.create({
      data: {
        organizationId,
        accountNumber: '2115',
        name: 'Issuing Card Clearing',
        accountType: 'LIABILITY' as any,
        normalBalance: 'CREDIT' as any,
        description: 'Offset for Stripe Issuing card spend (SynergyExpense)',
        isActive: true,
      } as any,
    });
  }
}
