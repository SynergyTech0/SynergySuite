import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAuth } from '../stores/authStore';

export type BankTxn = {
  id: string;
  transactionDate: string;
  description?: string | null;
  amount: string | number;
  transactionType: string; // DEBIT | CREDIT
  status: string;
  categoryAccountId?: string | null;
};

/** Categorize (accept) and exclude actions for bank-feed review rows. */
export function useBankTxnActions() {
  const orgId = useAuth((s) => s.user?.organizationId);
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['bank-transactions', orgId] });

  const categorize = useMutation({
    mutationFn: ({ id, accountId }: { id: string; accountId: string }) =>
      apiFetch(`/organizations/${orgId}/bank-transactions/${id}/categorize`, {
        method: 'POST',
        body: JSON.stringify({ accountId }),
      }),
    onSuccess: invalidate,
  });

  const exclude = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/organizations/${orgId}/bank-transactions/${id}/exclude`, { method: 'POST' }),
    onSuccess: invalidate,
  });

  return { categorize, exclude };
}
