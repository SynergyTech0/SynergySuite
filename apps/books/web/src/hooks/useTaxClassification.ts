import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAuth } from '../stores/authStore';

export type TaxClassificationRecord = {
  id: string;
  category?: string | null;
  confidence: number;
  explanation?: string | null;
  ircSection?: string | null;
  isManualOverride?: boolean | null;
  classifiedAt?: string | null;
  createdAt: string;
  journalLine?: {
    description?: string | null;
    debit: string | number;
    credit: string | number;
    account?: { name: string; accountType: string } | null;
    journal?: { journalNumber: string; journalDate: string; description?: string | null } | null;
  } | null;
  citations?: { section?: string | null; regulation?: string | null; citationText?: string | null }[];
};

export type TaxClassificationStats = {
  byCategory: { category: string | null; count: number; avgConfidence: number | null }[];
  /** Share of judged feedback marked correct; null until someone has judged a classification. */
  accuracy: number | null;
};

/** The org's most recent AI tax classifications (up to 100), newest first. */
export function useTaxClassifications() {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useQuery({
    queryKey: ['tax-classifications', orgId],
    queryFn: () => apiFetch<TaxClassificationRecord[]>(`/organizations/${orgId}/tax-classification/history`),
    enabled: !!orgId,
  });
}

export function useTaxClassificationStats() {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useQuery({
    queryKey: ['tax-classification-stats', orgId],
    queryFn: () => apiFetch<TaxClassificationStats>(`/organizations/${orgId}/tax-classification/stats`),
    enabled: !!orgId,
  });
}

/** "BUSINESS_EXPENSE" → "Business Expense". */
export function categoryLabel(category?: string | null): string {
  if (!category) return 'Unclassified';
  return category
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
