import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAuth } from '../stores/authStore';

export type Organization = {
  id: string;
  name: string;
  legalName?: string | null;
  entityType?: string | null;
  taxId?: string | null;
  industry?: string | null;
  stateOfIncorporation?: string | null;
  accountingMethod?: string | null;
  fiscalYearEnd?: string | null;
  defaultCurrency?: string | null;
  subscriptionTier?: string | null;
  isActive?: boolean | null;
};

export function useOrganization() {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useQuery({
    queryKey: ['organization', orgId],
    queryFn: () => apiFetch<Organization>(`/organizations/${orgId}`),
    enabled: !!orgId,
  });
}
