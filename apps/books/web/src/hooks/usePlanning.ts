import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAuth } from '../stores/authStore';

// ---- Companies ---------------------------------------------------------------

export type Company = { id: string; name: string; currency: string; fiscalYearEnd: number; role: string; current: boolean };
export type Member = { userId: string; email: string; name: string; role: string; active: boolean };

export function useCompanies() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({ queryKey: ['companies', userId], queryFn: () => apiFetch<Company[]>('/companies'), enabled: !!userId });
}

/** Moves the signed-in person into another of their companies and reloads everything. */
export function useSwitchCompany() {
  const load = useAuth((s) => s.load);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/companies/${id}/switch`, { method: 'POST' }),
    onSuccess: async () => {
      await load();
      qc.clear();
    },
  });
}

export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; defaultCurrency: string; fiscalYearEnd?: number }) =>
      apiFetch<Company>('/companies', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['companies'] }),
  });
}

export function useMembers(companyId?: string) {
  return useQuery({
    queryKey: ['members', companyId],
    queryFn: () => apiFetch<Member[]>(`/companies/${companyId}/members`),
    enabled: !!companyId,
  });
}

export function useMemberMutations(companyId?: string) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ['members', companyId] });
  return {
    add: useMutation({
      mutationFn: (body: { email: string; role: string }) =>
        apiFetch<Member[]>(`/companies/${companyId}/members`, { method: 'POST', body: JSON.stringify(body) }),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (userId: string) => apiFetch<Member[]>(`/companies/${companyId}/members/${userId}`, { method: 'DELETE' }),
      onSuccess: done,
    }),
  };
}

// ---- Budgets -----------------------------------------------------------------

export type BudgetPeriodInfo = { index: number; label: string; start: string; end: string; closed?: boolean };
export type BudgetLine = {
  id: string;
  accountId: string;
  account: { id: string; accountNumber: string; name: string; accountType: string };
  periodAmounts: number[];
  budgetAmount: number;
  forecastAmount: number;
  forecastPeriods: number[];
};
export type Budget = {
  id: string;
  budgetName: string;
  fiscalYear: number;
  period: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
  startDate: string;
  endDate: string;
  status: string;
  notes?: string | null;
  forecastMethod?: string | null;
  forecastAsOf?: string | null;
  periods: BudgetPeriodInfo[];
  lineItems: BudgetLine[];
  totals: { revenue: number; expense: number; netIncome: number };
};
type Series = { budget: number[]; actual: number[]; budgetTotal: number; actualTotal: number; ytdBudget: number; ytdActual: number };
export type Variance = {
  asOf: string;
  periods: BudgetPeriodInfo[];
  lineItems: {
    accountId: string;
    accountNumber: string;
    accountName: string;
    accountType: string;
    budget: number[];
    actual: number[];
    budgetTotal: number;
    actualTotal: number;
    ytdBudget: number;
    ytdActual: number;
    ytdVariance: number;
    ytdVariancePercent: number | null;
    favorable: boolean | null;
    forecastTotal: number;
  }[];
  totals: { revenue: Series; expense: Series; netIncome: Series };
};
export type Forecast = {
  method: string;
  asOf: string;
  periods: BudgetPeriodInfo[];
  lineItems: {
    accountId: string;
    accountNumber: string;
    accountName: string;
    accountType: string;
    forecast: number[];
    budgetTotal: number;
    forecastTotal: number;
    variance: number;
    variancePercent: number | null;
    favorable: boolean | null;
  }[];
  totals: Record<'revenue' | 'expense' | 'netIncome', { budget: number; forecast: number }>;
};

const useOrg = () => useAuth((s) => s.user?.organizationId);

export function useBudgets() {
  const orgId = useOrg();
  return useQuery({
    queryKey: ['budgets', orgId],
    queryFn: () => apiFetch<Budget[]>(`/organizations/${orgId}/budgets`),
    enabled: !!orgId,
  });
}

export function useBudgetVariance(id: string | undefined, asOf: string) {
  const orgId = useOrg();
  return useQuery({
    queryKey: ['budget-variance', orgId, id, asOf],
    queryFn: () => apiFetch<Variance>(`/organizations/${orgId}/budgets/${id}/variance?asOf=${asOf}`),
    enabled: !!orgId && !!id,
  });
}

export function useBudgetForecast(id: string | undefined, method: string, asOf: string) {
  const orgId = useOrg();
  return useQuery({
    queryKey: ['budget-forecast', orgId, id, method, asOf],
    queryFn: () => apiFetch<Forecast>(`/organizations/${orgId}/budgets/${id}/forecast?method=${method}&asOf=${asOf}`),
    enabled: !!orgId && !!id,
  });
}

/** Any budget call that changes something; refreshes every budget view afterwards. */
export function useBudgetAction<T = unknown>() {
  const orgId = useOrg();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method = 'POST', body }: { path: string; method?: string; body?: unknown }) =>
      apiFetch<T>(`/organizations/${orgId}/budgets${path}`, { method, body: body ? JSON.stringify(body) : undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets', orgId] });
      qc.invalidateQueries({ queryKey: ['budget-variance', orgId] });
      qc.invalidateQueries({ queryKey: ['budget-forecast', orgId] });
    },
  });
}

// ---- Consolidation -----------------------------------------------------------

export type Group = {
  id: string;
  name: string;
  reportingCurrency: string;
  parentOrganizationId: string;
  companies: { id: string; name: string; currency: string }[];
};
export type Cols = { byCompany: number[]; eliminations: number; consolidated: number };
export type ConsLine = Cols & { accountNumber: string; name: string; type: string };
export type ConsolidatedReport = {
  reportingCurrency: string;
  periodStart: string;
  periodEnd: string;
  companies: { id: string; name: string; currency: string; closingRate: number; averageRate: number }[];
  incomeStatement: { revenue: ConsLine[]; expenses: ConsLine[]; totals: { revenue: Cols; expenses: Cols; netIncome: Cols } };
  balanceSheet: {
    assets: ConsLine[];
    liabilities: ConsLine[];
    equity: ConsLine[];
    earnings: Cols;
    translationAdjustment: Cols;
    eliminationDifference: Cols;
    totals: { assets: Cols; liabilities: Cols; equity: Cols; liabilitiesAndEquity: Cols; isBalanced: boolean };
  };
  intercompany: { from: string; to: string; fromName: string; toName: string; receivable: number; payable: number; difference: number }[];
  warnings: string[];
};
export type IcEntry = {
  id: string;
  kind: string;
  date: string;
  description: string;
  from: { id: string; name?: string; currency: string; amount: number; journal?: { journalNumber: string; status: string } };
  to: { id: string; name?: string; currency: string; amount: number; journal?: { journalNumber: string; status: string } };
  voided: boolean;
};
export type Rate = { id: string; fromCurrency: string; toCurrency: string; rate: number; effectiveDate: string };
export type PickAccount = { id: string; accountNumber: string; name: string; accountType: string; isBankAccount: boolean };

export function useGroups() {
  return useQuery({ queryKey: ['groups'], queryFn: () => apiFetch<Group[]>('/consolidation/groups') });
}

export function useConsolidatedReport(id: string | undefined, start: string, end: string) {
  return useQuery({
    queryKey: ['consolidated', id, start, end],
    queryFn: () => apiFetch<ConsolidatedReport>(`/consolidation/groups/${id}/report?startDate=${start}&endDate=${end}`),
    enabled: !!id,
    retry: false,
  });
}

export function useIntercompany() {
  return useQuery({ queryKey: ['intercompany'], queryFn: () => apiFetch<IcEntry[]>('/consolidation/intercompany') });
}

export function useRates() {
  return useQuery({ queryKey: ['rates'], queryFn: () => apiFetch<Rate[]>('/consolidation/rates') });
}

export function useCompanyAccounts(organizationId?: string) {
  return useQuery({
    queryKey: ['company-accounts', organizationId],
    queryFn: () => apiFetch<PickAccount[]>(`/consolidation/accounts?organizationId=${organizationId}`),
    enabled: !!organizationId,
  });
}

/** Any consolidation call that changes something; refreshes groups, reports, entries and rates. */
export function useConsolidationAction<T = unknown>() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method = 'POST', body }: { path: string; method?: string; body?: unknown }) =>
      apiFetch<T>(`/consolidation${path}`, { method, body: body ? JSON.stringify(body) : undefined }),
    onSuccess: () => {
      for (const k of ['groups', 'consolidated', 'intercompany', 'rates']) qc.invalidateQueries({ queryKey: [k] });
    },
  });
}
