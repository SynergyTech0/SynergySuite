import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAuth } from '../stores/authStore';

export type InventoryItem = {
  id: string;
  sku: string;
  name: string;
  sellingPrice?: string | number | null;
};

/** Inventory items for the org — used to populate the bundle/kit component picker. */
export function useInventoryItems() {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useQuery({
    queryKey: ['inventory-items', orgId],
    queryFn: () =>
      apiFetch<any>(`/organizations/${orgId}/inventory/items`).then((d): InventoryItem[] =>
        Array.isArray(d) ? d : d.items ?? [],
      ),
    enabled: !!orgId,
  });
}
