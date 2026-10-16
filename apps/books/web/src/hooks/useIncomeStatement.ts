import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAuth } from '../stores/authStore';

export type StatementLine = { name: string; balance: number };
export type StatementGroup = { subType?: string; accounts: StatementLine[]; subtotal: number };
export type StatementSection = { title: string; accounts: StatementGroup[]; total: number };

export type IncomeStatement = {
  reportType: string;
  periodStart: string;
  periodEnd: string;
  sections: {
    revenue: StatementSection;
    costOfGoodsSold: StatementSection;
    grossProfit: { title: string; amount: number };
    operatingExpenses: StatementSection;
    otherExpenses: StatementSection;
  };
  totals?: Record<string, number>;
};

export function useIncomeStatement(startDate: string, endDate: string, enabled = true) {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useQuery({
    queryKey: ['income-statement', orgId, startDate, endDate],
    queryFn: () =>
      apiFetch<IncomeStatement>(
        `/organizations/${orgId}/reports/income-statement?startDate=${startDate}&endDate=${endDate}`,
      ),
    enabled: enabled && !!orgId,
  });
}

export type BalanceSheet = {
  reportType: string;
  asOfDate: string;
  sections: { assets: StatementSection; liabilities: StatementSection; equity: StatementSection };
  totals?: Record<string, number>;
};

export function useBalanceSheet(asOfDate: string, enabled = true) {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useQuery({
    queryKey: ['balance-sheet', orgId, asOfDate],
    queryFn: () =>
      apiFetch<BalanceSheet>(`/organizations/${orgId}/reports/balance-sheet?asOfDate=${asOfDate}`),
    enabled: enabled && !!orgId,
  });
}

export type TrialBalanceRow = {
  accountCode?: string;
  accountNumber?: string;
  accountName?: string;
  name?: string;
  debitBalance?: number;
  creditBalance?: number;
  debit?: number;
  credit?: number;
};
export type TrialBalance = {
  accounts: TrialBalanceRow[];
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
};

export function useTrialBalance(enabled = true) {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useQuery({
    queryKey: ['trial-balance', orgId],
    queryFn: () => apiFetch<TrialBalance>(`/organizations/${orgId}/reports/trial-balance`),
    enabled: enabled && !!orgId,
  });
}

// ---- Statement of Cash Flows -------------------------------------------------
export type CashFlowLine = { description: string; amount: number };
export type CashFlowSection = { title: string; total: number; netIncome?: number; adjustments?: CashFlowLine[]; items?: CashFlowLine[] };
export type CashFlow = {
  reportType: string;
  periodStart: string;
  periodEnd: string;
  sections: {
    operatingActivities: CashFlowSection;
    investingActivities: CashFlowSection;
    financingActivities: CashFlowSection;
  };
  totals: { operatingCashFlow: number; investingCashFlow: number; financingCashFlow: number; netChangeInCash: number };
};

export function useCashFlow(startDate: string, endDate: string, enabled = true) {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useQuery({
    queryKey: ['cash-flow', orgId, startDate, endDate],
    queryFn: () =>
      apiFetch<CashFlow>(`/organizations/${orgId}/reports/cash-flow?startDate=${startDate}&endDate=${endDate}`),
    enabled: enabled && !!orgId,
  });
}

// ---- A/R Aging ---------------------------------------------------------------
export type AgingInvoice = {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  invoiceDate: string;
  dueDate: string;
  balance: number;
  daysPastDue: number;
};
export type AgingBucketKey = 'current' | 'days1to30' | 'days31to60' | 'days61to90' | 'over90';
export type ArAging = {
  asOfDate: string;
  summary: Record<AgingBucketKey | 'total', number>;
  detail: Record<AgingBucketKey, AgingInvoice[]>;
};

export function useArAging(enabled = true) {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useQuery({
    queryKey: ['ar-aging', orgId],
    queryFn: () => apiFetch<ArAging>(`/organizations/${orgId}/invoices/aging`),
    enabled: enabled && !!orgId,
  });
}

// ---- General Ledger ----------------------------------------------------------
export type LedgerEntry = { date: string; entryNumber: string; description: string; reference?: string; debit: number; credit: number; balance: number };
export type LedgerAccount = {
  account: { id: string; code: string; name: string; type: string; normalBalance: string };
  entries: LedgerEntry[];
  summary: { totalDebits: number; totalCredits: number; endingBalance: number };
};
export type GeneralLedger = { reportType: string; periodStart: string; periodEnd: string; accounts: LedgerAccount[] };

export function useGeneralLedger(startDate: string, endDate: string, enabled = true) {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useQuery({
    queryKey: ['general-ledger', orgId, startDate, endDate],
    queryFn: () =>
      apiFetch<GeneralLedger>(`/organizations/${orgId}/reports/general-ledger?startDate=${startDate}&endDate=${endDate}`),
    enabled: enabled && !!orgId,
  });
}

/** Resolve a range key to an ISO [start, end] pair. */
export function resolveRange(key: string): { start: string; end: string } {
  const iso = (d: Date) => d.toISOString().split('T')[0];
  // Reference date passed via env at build-time would be ideal, but Date is fine at runtime here.
  const now = new Date();
  const y = now.getFullYear();
  switch (key) {
    case 'this-month':
      return { start: iso(new Date(y, now.getMonth(), 1)), end: iso(new Date(y, now.getMonth() + 1, 0)) };
    case 'ytd':
      return { start: `${y}-01-01`, end: iso(now) };
    case 'last-year':
      return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
    case 'this-quarter':
    default: {
      const q = Math.floor(now.getMonth() / 3);
      return { start: iso(new Date(y, q * 3, 1)), end: iso(new Date(y, q * 3 + 3, 0)) };
    }
  }
}
