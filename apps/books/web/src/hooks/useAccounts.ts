import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAuth } from '../stores/authStore';

// The Chart of Accounts endpoint returns a raw array (no pagination envelope).
export type Account = {
  id: string;
  accountNumber: string;
  name: string;
  accountType: string;
  accountSubtype?: string | null;
  normalBalance: string;
  isActive?: boolean | null;
  isBankAccount?: boolean | null;
  parentId?: string | null;
};

export function useAccounts() {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useQuery({
    queryKey: ['accounts', orgId],
    queryFn: () => apiFetch<Account[]>(`/organizations/${orgId}/accounts`),
    enabled: !!orgId,
  });
}
