import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAuth } from '../stores/authStore';

// Payroll runs use a { runs, total } envelope (not the standard { items, … }).
export type PayrollRun = {
  id: string;
  runNumber: string;
  periodStart: string;
  periodEnd: string;
  payDate?: string | null;
  status: string;
  totalGrossPay?: string | number | null;
  totalNetPay?: string | number | null;
  totalTaxes?: string | number | null;
  totalDeductions?: string | number | null;
  employeeCount?: number | null;
};

export function usePayrollRuns() {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useQuery({
    queryKey: ['payroll-runs', orgId],
    queryFn: () => apiFetch<{ runs: PayrollRun[]; total: number }>(`/organizations/${orgId}/payroll/runs`),
    enabled: !!orgId,
  });
}
