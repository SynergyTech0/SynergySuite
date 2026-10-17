import { useOrgList } from './useOrgList';
import type { BankTxn } from './useBankFeed';

/** A bank transaction as the list endpoint returns it, with its account and category. */
export type BankTransaction = BankTxn & {
  bankAccountId: string;
  merchantName?: string | null;
  bankAccount?: { id: string; accountName: string } | null;
  categoryAccount?: { id: string; accountNumber: string; name: string } | null;
};

/**
 * Bank transactions, newest first. Statuses: UNMATCHED (for review), CLEARED (categorized),
 * MATCHED, RECONCILED, EXCLUDED, PENDING.
 */
export function useBankTransactions(status?: string, take = 500) {
  return useOrgList<BankTransaction>('bank-transactions', { status, take });
}
