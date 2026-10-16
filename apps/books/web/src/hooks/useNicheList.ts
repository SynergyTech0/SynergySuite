import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAuth } from '../stores/authStore';

/**
 * Flexible list fetch for the assorted niche endpoints that don't follow the standard
 * org-scoped `{ items }` envelope. `pathTemplate` may contain `{org}`; `pick` extracts
 * the array from whatever envelope the endpoint returns ({ deposits }, { batches }, a raw
 * array, etc.).
 */
export function useNicheList<T>(key: string, pathTemplate: string, pick: (data: any) => T[]) {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useQuery({
    queryKey: [key, orgId],
    queryFn: () => apiFetch<any>(pathTemplate.replace('{org}', orgId ?? '')).then((d) => pick(d) ?? []),
    enabled: !!orgId,
  });
}
