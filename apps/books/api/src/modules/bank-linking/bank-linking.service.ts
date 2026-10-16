import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

const PAY_URL = process.env.PAY_SERVICE_URL || 'http://host.docker.internal:9095';
const PAY_TOKEN = process.env.PAY_SERVICE_TOKEN || '';

/**
 * Real bank connection via the shared synergy-payments Stripe Financial
 * Connections service. The raw bank credentials live only in Stripe's hosted
 * modal — we only ever hold the FC account handle, balances, and transactions.
 */
@Injectable()
export class BankLinkingService {
  private readonly logger = new Logger(BankLinkingService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async pay(path: string, method = 'GET', body?: any): Promise<any> {
    const res = await fetch(`${PAY_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${PAY_TOKEN}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`payments ${method} ${path} → ${res.status} ${text}`);
      throw new BadRequestException(`Bank service error (${res.status})`);
    }
    return (await res.json()) as any;
  }

  private balUsd(balance: any): number | undefined {
    // Stripe FC balance: { current: { usd: <cents> }, ... }
    const cents = balance?.current?.usd ?? balance?.cash?.available?.usd;
    return cents != null ? cents / 100 : undefined;
  }

  /** Step 1 — create the FC link session; the SPA opens Stripe's modal with these. */
  async createSession(organizationId: string, email?: string) {
    const s = await this.pay('/fc/session', 'POST', { purpose: 'data', email });
    return {
      sessionId: s.session_id,
      clientSecret: s.client_secret,
      publishableKey: s.publishable_key,
      ref: `sb_${organizationId}_${uuidv4()}`,
    };
  }

  /** Step 2 — after the modal, persist the linked account(s) as BankAccounts. */
  async complete(organizationId: string, sessionId: string, ref: string, glAccountId: string) {
    const gl = await this.prisma.account.findFirst({ where: { id: glAccountId, organizationId } });
    if (!gl) throw new NotFoundException('GL account not found');

    const r = await this.pay(`/fc/session/${sessionId}/complete?ref=${encodeURIComponent(ref)}&purpose=data`, 'POST');
    const accounts = r.accounts || [];
    if (accounts.length === 0) throw new BadRequestException('No accounts were linked');

    let balance: number | undefined;
    try {
      balance = this.balUsd((await this.pay(`/fc/balances?ref=${encodeURIComponent(ref)}`)).balance);
    } catch {
      /* balances may lag right after link */
    }

    const created: { id: string; bankName: string; last4: string }[] = [];
    for (const a of accounts) {
      const acct = await this.prisma.bankAccount.create({
        data: {
          organizationId,
          accountId: glAccountId,
          bankName: a.institution || 'Bank',
          accountName: `${a.institution || 'Bank'} ••${a.last4 || ''}`.trim(),
          accountNumber: a.last4 || '',
          accountType: 'CHECKING',
          currency: 'USD',
          currentBalance: balance ?? 0,
          availableBalance: balance ?? 0,
          isActive: true,
          isPrimary: false,
          lastSyncAt: new Date(),
          plaidItemId: ref, // FC ref handle for balance/transaction sync
          plaidAccessToken: a.id, // Stripe FC account id
        },
      });
      created.push({ id: acct.id, bankName: acct.bankName, last4: a.last4 });
    }
    return { linked: created.length, accounts: created };
  }

  /** Step 3 (repeatable) — pull the latest balance + transactions for a linked account. */
  async sync(organizationId: string, bankAccountId: string) {
    const acct = await this.prisma.bankAccount.findFirst({ where: { id: bankAccountId, organizationId } });
    if (!acct) throw new NotFoundException('Bank account not found');
    if (!acct.plaidItemId && !acct.plaidAccessToken) {
      throw new BadRequestException('This account was added manually, not via a bank connection');
    }
    // Query by the specific Stripe FC account id so multiple accounts linked in
    // one session sync independently (ref alone maps to only one of them).
    const q = acct.plaidAccessToken
      ? `account=${encodeURIComponent(acct.plaidAccessToken)}`
      : `ref=${encodeURIComponent(acct.plaidItemId!)}`;

    try {
      const balance = this.balUsd((await this.pay(`/fc/balances?${q}`)).balance);
      if (balance != null) {
        await this.prisma.bankAccount.update({
          where: { id: acct.id },
          data: { currentBalance: balance, availableBalance: balance, lastSyncAt: new Date() },
        });
      }
    } catch {
      /* non-fatal */
    }

    const t = await this.pay(`/fc/transactions?${q}`);
    if (t.status === 'refreshing') {
      return { transactionsImported: 0, status: 'refreshing' };
    }
    let imported = 0;
    for (const tx of t.transactions || []) {
      const existing = await this.prisma.bankTransaction.findFirst({ where: { bankAccountId: acct.id, externalId: tx.id } });
      if (existing) continue;
      const amount = (tx.amount || 0) / 100;
      await this.prisma.bankTransaction.create({
        data: {
          bankAccountId: acct.id,
          externalId: tx.id,
          transactionDate: tx.transacted_at ? new Date(tx.transacted_at * 1000) : new Date(),
          description: tx.description || '(no description)',
          amount,
          transactionType: amount >= 0 ? 'CREDIT' : 'DEBIT',
          status: tx.status === 'pending' ? 'PENDING' : 'UNMATCHED',
          pending: tx.status === 'pending',
        },
      });
      imported++;
    }
    return { transactionsImported: imported };
  }
}
