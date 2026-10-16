import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Synergy Books bank feed via Stripe Financial Connections, served by the shared
 * synergy-payments service (the same FC service that powers deal ACH charges and
 * the mind's runway sense). This provider never talks to Stripe directly — it goes
 * through synergy-payments, which holds the Stripe keys and the linked-account store.
 *
 * Flow:
 *   1. createLinkSession(purpose=data)  -> client_secret + publishable_key for the browser modal
 *   2. (browser) customer links their bank in Stripe's Financial Connections modal
 *   3. completeLink(sessionId, ref)     -> persists the linked account under `ref`
 *   4. getTransactions(ref) / getBalance(ref) -> real feed for the ledger / reconciliation
 */
export interface FcLinkSession {
  sessionId: string;
  clientSecret: string;
  publishableKey: string;
}

export interface FcLinkedAccount {
  stripeAccountId: string;
  institution?: string;
  last4?: string;
}

export interface NormalizedBankTxn {
  id: string;
  date: Date;
  postDate?: Date;
  description: string;
  originalDescription?: string;
  amount: number; // in currency units, sign preserved (negative = money out)
  category?: string[];
  merchantName?: string;
  pending: boolean;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class StripeFcService {
  private readonly logger = new Logger(StripeFcService.name);
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(private readonly config: ConfigService) {
    // Compose provides PAY_SERVICE_*; PAYMENTS_* kept as a legacy fallback.
    this.baseUrl = (
      this.config.get<string>('PAY_SERVICE_URL') ||
      this.config.get<string>('PAYMENTS_URL') ||
      'http://host.docker.internal:9095'
    ).replace(/\/$/, '');
    this.token =
      this.config.get<string>('PAY_SERVICE_TOKEN') || this.config.get<string>('PAYMENTS_TOKEN') || '';
    if (!this.token) {
      this.logger.warn('PAYMENTS_TOKEN is not set — Stripe FC bank feed calls will be rejected by synergy-payments.');
    }
  }

  private async call<T = any>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        ...(init.headers || {}),
      },
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body?.detail || `synergy-payments ${path} failed (${res.status})`);
    }
    return body as T;
  }

  /** Create a Financial Connections session for read-only bank data (balances + transactions). */
  async createLinkSession(email?: string, name?: string): Promise<FcLinkSession> {
    this.logger.log(`Creating FC data session for ${name || email || 'account'}`);
    const d = await this.call<any>('/fc/session', {
      method: 'POST',
      body: JSON.stringify({ purpose: 'data', email, name }),
    });
    return { sessionId: d.session_id, clientSecret: d.client_secret, publishableKey: d.publishable_key };
  }

  /** After the browser modal, persist the linked account(s) under `ref` and return them. */
  async completeLink(sessionId: string, ref: string): Promise<FcLinkedAccount[]> {
    const d = await this.call<any>(
      `/fc/session/${encodeURIComponent(sessionId)}/complete?ref=${encodeURIComponent(ref)}&purpose=data`,
      { method: 'POST' },
    );
    return (d.accounts || []).map((a: any) => ({
      stripeAccountId: a.id,
      institution: a.institution,
      last4: a.last4,
    }));
  }

  /** Pull the linked account's transactions, normalized to Books' internal shape. */
  async getTransactions(ref: string): Promise<NormalizedBankTxn[]> {
    const d = await this.call<any>(`/fc/transactions?ref=${encodeURIComponent(ref)}`);
    return (d.transactions || []).map((t: any) => {
      const ts = t.transacted_at ? new Date(t.transacted_at * 1000) : new Date();
      return {
        id: t.id,
        date: ts,
        postDate: ts,
        description: t.description || 'Bank transaction',
        originalDescription: t.description || undefined,
        // Stripe amounts are in the smallest currency unit; sign preserved so the
        // caller can derive DEBIT/CREDIT (negative = money out).
        amount: (t.amount ?? 0) / 100,
        pending: t.status ? t.status !== 'posted' : false,
        metadata: { source: 'stripe_fc', currency: t.currency, status: t.status },
      } as NormalizedBankTxn;
    });
  }

  /** Current balance for the linked account. */
  async getBalance(ref: string): Promise<{ account: string; balance: any }> {
    return this.call(`/fc/balances?ref=${encodeURIComponent(ref)}`);
  }
}
