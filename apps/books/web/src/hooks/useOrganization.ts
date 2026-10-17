import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  fiscalYearEnd?: number | null; // month the fiscal year ends, 1-12
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

export type OrganizationUpdate = {
  name?: string;
  legalName?: string;
  ein?: string;
  entityType?: string;
  fiscalYearEnd?: number;
};

/** Save company details (PUT /organizations/:id). The API names the tax ID `ein` on input. */
export function useUpdateOrganization() {
  const orgId = useAuth((s) => s.user?.organizationId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: OrganizationUpdate) =>
      apiFetch<Organization>(`/organizations/${orgId}`, { method: 'PUT', body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organization', orgId] });
      qc.invalidateQueries({ queryKey: ['companies'] });
    },
  });
}
