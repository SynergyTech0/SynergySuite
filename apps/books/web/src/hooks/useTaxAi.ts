import { useMutation, useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAuth } from '../stores/authStore';

export type TaxCitation = { section: string; title: string | null };
export type TaxAnswer = { answer: string; citations: TaxCitation[] };

export function useTaxAiStatus() {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useQuery({
    queryKey: ['tax-ai-status', orgId],
    queryFn: () => apiFetch<{ ircSections: number; model: string; configured: boolean }>(`/organizations/${orgId}/tax-ai/status`),
    enabled: !!orgId,
  });
}

export function useTaxAsk() {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useMutation({
    mutationFn: (question: string) =>
      apiFetch<TaxAnswer>(`/organizations/${orgId}/tax-ai/ask`, { method: 'POST', body: JSON.stringify({ question }) }),
  });
}

export function useTaxAnalyze() {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useMutation({
    mutationFn: (p: { description: string; amount?: number; category?: string }) =>
      apiFetch<TaxAnswer>(`/organizations/${orgId}/tax-ai/analyze`, { method: 'POST', body: JSON.stringify(p) }),
  });
}
