import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAuth } from '../stores/authStore';

// Prisma serializes Decimal as string over JSON — money fields arrive as strings.
export type ApiInvoice = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  totalAmount: string | number;
  amountDue: string | number;
  amountPaid?: string | number;
  status: string;
  customer?: { id: string; name: string; email?: string | null } | null;
  stripeInvoiceId?: string | null;
  stripeHostedUrl?: string | null;
};

export type InvoiceList = {
  items: ApiInvoice[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export function useInvoices(params?: { search?: string; status?: string }) {
  const orgId = useAuth((s) => s.user?.organizationId);
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.status && params.status !== 'ALL') qs.set('status', params.status);
  const query = qs.toString();

  return useQuery({
    queryKey: ['invoices', orgId, params?.search ?? '', params?.status ?? 'ALL'],
    queryFn: () => apiFetch<InvoiceList>(`/organizations/${orgId}/invoices${query ? `?${query}` : ''}`),
    enabled: !!orgId,
  });
}

export type NewInvoicePayload = {
  customerId: string;
  invoiceDate: string;
  dueDate?: string;
  terms?: string;
  lines: { description: string; quantity: number; unitPrice: number }[];
};

export function useCreateInvoice() {
  const orgId = useAuth((s) => s.user?.organizationId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: NewInvoicePayload) =>
      apiFetch<ApiInvoice>(`/organizations/${orgId}/invoices`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices', orgId] }),
  });
}

/** Mirror the invoice to a hosted Stripe invoice (returns the pay-online URL). */
export function useStripeCollect() {
  const orgId = useAuth((s) => s.user?.organizationId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, send }: { invoiceId: string; send?: boolean }) =>
      apiFetch<{ stripeInvoiceId: string; hostedUrl: string; emailed: boolean }>(
        `/organizations/${orgId}/invoices/${invoiceId}/stripe-collect`,
        { method: 'POST', body: JSON.stringify({ send: send ?? false }) },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices', orgId] }),
  });
}

/** Poll Stripe; when paid, the API records the payment (GL + balances). */
export function useStripeRefresh() {
  const orgId = useAuth((s) => s.user?.organizationId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invoiceId: string) =>
      apiFetch<{ stripeStatus: string; paymentRecorded: boolean; hostedUrl: string | null }>(
        `/organizations/${orgId}/invoices/${invoiceId}/stripe-refresh`,
        { method: 'POST' },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices', orgId] }),
  });
}

export function useRecordPayment() {
  const orgId = useAuth((s) => s.user?.organizationId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, amount }: { invoiceId: string; amount: number }) =>
      apiFetch(`/organizations/${orgId}/invoices/${invoiceId}/payment`, {
        method: 'POST',
        body: JSON.stringify({ amount }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices', orgId] }),
  });
}
