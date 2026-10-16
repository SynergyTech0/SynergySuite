import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { loadStripe } from '@stripe/stripe-js';
import { apiFetch } from '../lib/api';
import { useAuth } from '../stores/authStore';

export type BankAccount = {
  id: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  accountType?: string;
  routingNumber?: string | null;
  currentBalance?: string | number | null;
  availableBalance?: string | number | null;
  isActive?: boolean | null;
  isPrimary?: boolean | null;
  plaidItemId?: string | null; // present when the account was linked via a bank connection
  lastSyncAt?: string | null;
};

/** Bank accounts for the org — used to populate deposit/ACH account pickers. */
export function useBankAccounts() {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useQuery({
    queryKey: ['bank-accounts', orgId],
    queryFn: () =>
      apiFetch<any>(`/organizations/${orgId}/bank-accounts`).then((d): BankAccount[] =>
        Array.isArray(d) ? d : d.items ?? [],
      ),
    enabled: !!orgId,
  });
}

export type VendorBankAccount = {
  id: string;
  vendorId: string;
  vendorName: string;
  bankName: string;
  accountType: string;
  accountLast4: string;
  nameOnAccount: string;
};

/** Vendor bank accounts across the org — ACH batch recipients. */
export function useVendorBankAccounts() {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useQuery({
    queryKey: ['vendor-bank-accounts', orgId],
    queryFn: () => apiFetch<VendorBankAccount[]>(`/ach/vendor-bank-accounts`),
    enabled: !!orgId,
  });
}

type LinkSession = { sessionId: string; clientSecret: string; publishableKey: string; ref: string };

/**
 * Real bank connection via Stripe Financial Connections. Opens Stripe's hosted
 * bank-login modal (credentials never touch us), then persists the linked
 * account(s). Returns a runner: connectBank(glAccountId) → number linked.
 */
export function useConnectBank() {
  const orgId = useAuth((s) => s.user?.organizationId);
  const qc = useQueryClient();
  return async (glAccountId: string): Promise<number> => {
    const sess = await apiFetch<LinkSession>(`/organizations/${orgId}/bank-link/session`, { method: 'POST', body: '{}' });
    const stripe = await loadStripe(sess.publishableKey);
    if (!stripe) throw new Error('Could not load Stripe.');
    const result = await (stripe as any).collectFinancialConnectionsAccounts({ clientSecret: sess.clientSecret });
    if (result.error) throw new Error(result.error.message || 'Bank connection was cancelled.');
    const accounts = result.financialConnectionsSession?.accounts ?? [];
    if (accounts.length === 0) throw new Error('No account was selected.');
    const done = await apiFetch<{ linked: number }>(`/organizations/${orgId}/bank-link/complete`, {
      method: 'POST',
      body: JSON.stringify({ sessionId: sess.sessionId, ref: sess.ref, glAccountId }),
    });
    await qc.invalidateQueries({ queryKey: ['bank-accounts', orgId] });
    return done.linked;
  };
}

/** Auto-categorize uncategorized bank transactions (rules + optional AI). */
export function useAutoCategorize() {
  const orgId = useAuth((s) => s.user?.organizationId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (useAi: boolean) =>
      apiFetch<{ total: number; categorized: number; aiCategorized: number; remaining: number; aiUsed: boolean }>(
        `/organizations/${orgId}/bank-transactions/auto-categorize`,
        { method: 'POST', body: JSON.stringify({ useAi }) },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bank-transactions', orgId] }),
  });
}

/**
 * "Update" the bank feed: pull latest balance + transactions for every linked
 * account, then auto-categorize what came in. Returns a summary.
 */
export function useUpdateBankFeed() {
  const orgId = useAuth((s) => s.user?.organizationId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const accts = await apiFetch<any>(`/organizations/${orgId}/bank-accounts`).then((d): BankAccount[] =>
        Array.isArray(d) ? d : d.items ?? [],
      );
      const linked = accts.filter((a) => a.plaidItemId);
      let imported = 0;
      for (const a of linked) {
        try {
          const r = await apiFetch<{ transactionsImported: number }>(
            `/organizations/${orgId}/bank-link/${a.id}/sync`,
            { method: 'POST', body: '{}' },
          );
          imported += r.transactionsImported ?? 0;
        } catch {
          /* one account failing shouldn't abort the rest */
        }
      }
      const cat = await apiFetch<{ categorized: number; aiCategorized: number; remaining: number }>(
        `/organizations/${orgId}/bank-transactions/auto-categorize`,
        { method: 'POST', body: JSON.stringify({ useAi: true }) },
      );
      return { linked: linked.length, imported, ...cat };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank-accounts', orgId] });
      qc.invalidateQueries({ queryKey: ['bank-transactions', orgId] });
      qc.invalidateQueries({ queryKey: ['accounts', orgId] });
    },
  });
}

/** Pull latest balance + transactions for a linked account. */
export function useSyncBank() {
  const orgId = useAuth((s) => s.user?.organizationId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bankAccountId: string) =>
      apiFetch<{ transactionsImported: number }>(`/organizations/${orgId}/bank-link/${bankAccountId}/sync`, { method: 'POST', body: '{}' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank-accounts', orgId] });
      qc.invalidateQueries({ queryKey: ['bank-transactions', orgId] });
    },
  });
}

/**
 * Create mutation for the assorted niche endpoints whose POST path is NOT the
 * standard `/organizations/:org/<resource>` shape (org comes from the JWT).
 * `path` is the raw endpoint; `invalidateKey` is the query key to refresh.
 */
export function useNicheCreate<TPayload>(path: string, invalidateKey: string) {
  const orgId = useAuth((s) => s.user?.organizationId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: TPayload) =>
      apiFetch(path, { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [invalidateKey, orgId] }),
  });
}
