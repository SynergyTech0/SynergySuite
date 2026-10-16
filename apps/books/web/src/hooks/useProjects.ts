import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAuth } from '../stores/authStore';

// The projects endpoint returns a raw array (like Chart of Accounts).
export type Project = {
  id: string;
  projectNumber: string;
  name: string;
  status: string;
  billingType?: string | null;
  budgetAmount?: string | number | null;
  customer?: { id: string; name: string } | null;
};

export function useProjects() {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useQuery({
    queryKey: ['projects', orgId],
    queryFn: () => apiFetch<Project[]>(`/organizations/${orgId}/projects`),
    enabled: !!orgId,
  });
}
