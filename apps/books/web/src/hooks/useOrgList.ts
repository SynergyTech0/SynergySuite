import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAuth } from '../stores/authStore';

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

/**
 * Generic list fetch for org-scoped resources: `GET /organizations/:orgId/<resource>`.
 * Every SynergyBooks list endpoint returns the same `{ items, total, page, … }` envelope.
 * `take` raises the page size (the API defaults to 50) for pages that total a whole list.
 */
export function useOrgList<T>(resource: string, params?: { search?: string; status?: string; take?: number }) {
  const orgId = useAuth((s) => s.user?.organizationId);
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.status && params.status !== 'ALL') qs.set('status', params.status);
  if (params?.take) qs.set('take', String(params.take));
  const query = qs.toString();

  return useQuery({
    queryKey: [resource, orgId, params?.search ?? '', params?.status ?? 'ALL', ...(params?.take ? [params.take] : [])],
    queryFn: () => apiFetch<Paginated<T>>(`/organizations/${orgId}/${resource}${query ? `?${query}` : ''}`),
    enabled: !!orgId,
  });
}

/** Money helper — Prisma serializes Decimal as string over JSON. */
export const num = (v: string | number | null | undefined): number =>
  typeof v === 'number' ? v : parseFloat(v || '0') || 0;

/** Generic create mutation for an org-scoped resource; invalidates that resource's list on success. */
export function useCreateOrgResource<TPayload, TResult = unknown>(resource: string) {
  const orgId = useAuth((s) => s.user?.organizationId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: TPayload) =>
      apiFetch<TResult>(`/organizations/${orgId}/${resource}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [resource, orgId] }),
  });
}
