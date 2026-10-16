import type { Paycheck } from "./calc";

/**
 * The journal entry a finished pay run puts in Books. Account numbers follow Books' default chart
 * of accounts and can be changed in payroll settings; Books makes any that are missing.
 */

export interface PayrollAccounts {
  wagesExpense: string;
  employerTaxExpense: string;
  benefitsExpense: string;
  taxesPayable: string;
  benefitsPayable: string;
  netPayPayable: string;
}

export const DEFAULT_ACCOUNTS: PayrollAccounts = {
  wagesExpense: "6100",
  employerTaxExpense: "6110",
  benefitsExpense: "6120",
  taxesPayable: "2220",
  benefitsPayable: "2200",
  netPayPayable: "2210",
};

export const ACCOUNT_INFO: Record<keyof PayrollAccounts, { label: string; name: string; type: "EXPENSE" | "LIABILITY" }> = {
  wagesExpense: { label: "Gross wages (expense)", name: "Salaries and Wages", type: "EXPENSE" },
  employerTaxExpense: { label: "Employer payroll taxes (expense)", name: "Payroll Taxes Expense", type: "EXPENSE" },
  benefitsExpense: { label: "Employer benefit contributions (expense)", name: "Employee Benefits", type: "EXPENSE" },
  taxesPayable: { label: "Payroll taxes owed (liability)", name: "Payroll Taxes Payable", type: "LIABILITY" },
  benefitsPayable: { label: "Deductions and benefits owed (liability)", name: "Payroll Liabilities", type: "LIABILITY" },
  netPayPayable: { label: "Net pay owed to employees (liability)", name: "Wages Payable", type: "LIABILITY" },
};

export interface JournalLine {
  account: { number: string; name: string; type: "EXPENSE" | "LIABILITY" };
  debitCents: number;
  creditCents: number;
  description: string;
}

export interface RunTotals {
  grossCents: number;
  deductionsCents: number;
  taxesCents: number;
  netCents: number;
  employerTaxesCents: number;
  employerBenefitsCents: number;
}

export function runTotals(checks: Paycheck[]): RunTotals {
  const t: RunTotals = { grossCents: 0, deductionsCents: 0, taxesCents: 0, netCents: 0, employerTaxesCents: 0, employerBenefitsCents: 0 };
  for (const c of checks) {
    t.grossCents += c.grossCents;
    t.deductionsCents += c.deductionsCents;
    t.taxesCents += c.taxesCents;
    t.netCents += c.netCents;
    t.employerTaxesCents += c.employerTaxesCents;
    t.employerBenefitsCents += c.employerBenefitsCents;
  }
  return t;
}

/** Balanced lines (debits = credits) for one pay run; zero lines are left out. */
export function payrollJournal(t: RunTotals, accounts: PayrollAccounts, label: string): JournalLine[] {
  const acct = (k: keyof PayrollAccounts) => ({ number: accounts[k], name: ACCOUNT_INFO[k].name, type: ACCOUNT_INFO[k].type });
  const lines: JournalLine[] = [
    { account: acct("wagesExpense"), debitCents: t.grossCents, creditCents: 0, description: `${label}: gross wages` },
    { account: acct("employerTaxExpense"), debitCents: t.employerTaxesCents, creditCents: 0, description: `${label}: employer taxes` },
    { account: acct("benefitsExpense"), debitCents: t.employerBenefitsCents, creditCents: 0, description: `${label}: employer contributions` },
    { account: acct("taxesPayable"), debitCents: 0, creditCents: t.taxesCents + t.employerTaxesCents, description: `${label}: taxes withheld and owed` },
    { account: acct("benefitsPayable"), debitCents: 0, creditCents: t.deductionsCents + t.employerBenefitsCents, description: `${label}: deductions and contributions owed` },
    { account: acct("netPayPayable"), debitCents: 0, creditCents: t.netCents, description: `${label}: net pay` },
  ];
  return lines.filter((l) => l.debitCents > 0 || l.creditCents > 0);
}
