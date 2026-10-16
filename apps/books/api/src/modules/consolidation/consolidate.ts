/**
 * Pure consolidation arithmetic: translate each company into the group's currency, add them up
 * account by account, and take out intercompany activity. Free of Nest and Prisma for testing.
 *
 * Translation follows the current-rate method: balance sheet accounts at the closing rate,
 * income and expenses at the period's average rate. Equity accounts use the closing rate too
 * (Books keeps no historical equity rates), and the gap that leaves is shown as the currency
 * translation adjustment, so each company's translated balance sheet still balances.
 */

export type AccountKind = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export interface AccountActivity {
  accountNumber: string;
  name: string;
  type: AccountKind;
  subtype?: string | null;
  /** Everything posted up to the report's end date. */
  cumDebit: number;
  cumCredit: number;
  /** Posted within the report period. */
  perDebit: number;
  perCredit: number;
  /** The intercompany share of the above, with counterparties inside the group. */
  elimCumDebit: number;
  elimCumCredit: number;
  elimPerDebit: number;
  elimPerCredit: number;
}

export interface CompanyInput {
  id: string;
  name: string;
  currency: string;
  /** Multiply local amounts by these to get the reporting currency. */
  closingRate: number;
  averageRate: number;
  accounts: AccountActivity[];
}

export interface Columns {
  byCompany: number[];
  eliminations: number;
  consolidated: number;
}

export interface ConsolidatedLine extends Columns {
  accountNumber: string;
  name: string;
  type: AccountKind;
  subtype: string | null;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Activity on the account type's natural side, so assets, expenses, liabilities and revenue read positive. */
export const natural = (type: AccountKind, debit: number, credit: number) =>
  type === 'ASSET' || type === 'EXPENSE' ? debit - credit : credit - debit;

const isPL = (t: AccountKind) => t === 'REVENUE' || t === 'EXPENSE';

function columns(byCompany: number[], eliminations: number): Columns {
  const b = byCompany.map(round2);
  const e = round2(eliminations);
  return { byCompany: b, eliminations: e, consolidated: round2(b.reduce((s, x) => s + x, 0) + e) };
}

function addCols(rows: Columns[], n: number, sign: number[] = rows.map(() => 1)): Columns {
  const byCompany = Array.from({ length: n }, (_, i) => rows.reduce((s, r, k) => s + sign[k] * r.byCompany[i], 0));
  const elim = rows.reduce((s, r, k) => s + sign[k] * r.eliminations, 0);
  return columns(byCompany, elim);
}

/**
 * Consolidates the companies. Accounts line up by number and type; the first company that has
 * an account (put the parent first) names its line.
 */
export function consolidate(companies: CompanyInput[]) {
  const n = companies.length;
  const keyOf = (a: { accountNumber: string; type: string }) => `${a.type}|${a.accountNumber}`;
  const meta = new Map<string, { accountNumber: string; name: string; type: AccountKind; subtype: string | null }>();
  for (const c of companies) {
    for (const a of c.accounts) {
      if (!meta.has(keyOf(a))) meta.set(keyOf(a), { accountNumber: a.accountNumber, name: a.name, type: a.type, subtype: a.subtype ?? null });
    }
  }

  const values = new Map<string, { byCompany: number[]; elim: number }>();
  const netIncomeCum: number[] = [];
  const elimNetIncomeCum: number[] = [];
  const cta: number[] = [];
  const localImbalance: number[] = [];

  companies.forEach((c, i) => {
    let assets = 0;
    let liabilities = 0;
    let equity = 0;
    let niCumLocal = 0;
    let niPerLocal = 0;
    let elimNiCumLocal = 0;
    let elimNiPerLocal = 0;
    let localCheck = 0;
    for (const a of c.accounts) {
      const k = keyOf(a);
      const v = values.get(k) ?? { byCompany: Array(n).fill(0), elim: 0 };
      if (isPL(a.type)) {
        const per = natural(a.type, a.perDebit, a.perCredit);
        const elimPer = natural(a.type, a.elimPerDebit, a.elimPerCredit);
        v.byCompany[i] += per * c.averageRate;
        v.elim -= elimPer * c.averageRate;
        const sign = a.type === 'REVENUE' ? 1 : -1;
        niCumLocal += sign * natural(a.type, a.cumDebit, a.cumCredit);
        niPerLocal += sign * per;
        elimNiCumLocal += sign * natural(a.type, a.elimCumDebit, a.elimCumCredit);
        elimNiPerLocal += sign * elimPer;
      } else {
        const cum = natural(a.type, a.cumDebit, a.cumCredit);
        const elimCum = natural(a.type, a.elimCumDebit, a.elimCumCredit);
        v.byCompany[i] += cum * c.closingRate;
        v.elim -= elimCum * c.closingRate;
        if (a.type === 'ASSET') assets += cum * c.closingRate;
        else if (a.type === 'LIABILITY') liabilities += cum * c.closingRate;
        else equity += cum * c.closingRate;
      }
      localCheck += a.cumDebit - a.cumCredit;
      values.set(k, v);
    }
    // Earnings to date: this period at the average rate, earlier periods at the closing rate.
    const ni = niPerLocal * c.averageRate + (niCumLocal - niPerLocal) * c.closingRate;
    netIncomeCum.push(ni);
    elimNetIncomeCum.push(elimNiPerLocal * c.averageRate + (elimNiCumLocal - elimNiPerLocal) * c.closingRate);
    cta.push(assets - liabilities - equity - ni);
    localImbalance.push(round2(localCheck));
  });

  const lines: ConsolidatedLine[] = [...meta.entries()]
    .sort(([, a], [, b]) => a.accountNumber.localeCompare(b.accountNumber, undefined, { numeric: true }))
    .map(([k, m]) => {
      const v = values.get(k)!;
      return { ...m, ...columns(v.byCompany, v.elim) };
    })
    .filter((l) => l.byCompany.some((x) => x !== 0) || l.eliminations !== 0);

  const of = (t: AccountKind) => lines.filter((l) => l.type === t);
  const revenue = addCols(of('REVENUE'), n);
  const expenses = addCols(of('EXPENSE'), n);
  const netIncome = addCols([revenue, expenses], n, [1, -1]);

  const assets = addCols(of('ASSET'), n);
  const liabilities = addCols(of('LIABILITY'), n);
  const equityAccounts = addCols(of('EQUITY'), n);
  const earnings = columns(netIncomeCum, -elimNetIncomeCum.reduce((s, x) => s + x, 0));
  const translation = columns(cta, 0);
  // Whatever the eliminations leave unmatched: intercompany balances that differ between the two
  // companies, usually from exchange rates. Shown so the consolidated balance sheet balances.
  const elimGap = round2(
    assets.eliminations - liabilities.eliminations - equityAccounts.eliminations - earnings.eliminations,
  );
  const eliminationDifference = columns(Array(n).fill(0), elimGap);
  const totalEquity = addCols([equityAccounts, earnings, translation, eliminationDifference], n);
  const liabilitiesAndEquity = addCols([liabilities, totalEquity], n);

  return {
    companies: companies.map((c, i) => ({
      id: c.id,
      name: c.name,
      currency: c.currency,
      closingRate: c.closingRate,
      averageRate: c.averageRate,
      localImbalance: localImbalance[i],
    })),
    incomeStatement: {
      revenue: of('REVENUE'),
      expenses: of('EXPENSE'),
      totals: { revenue, expenses, netIncome },
    },
    balanceSheet: {
      assets: of('ASSET'),
      liabilities: of('LIABILITY'),
      equity: of('EQUITY'),
      earnings,
      translationAdjustment: translation,
      eliminationDifference,
      totals: {
        assets,
        liabilities,
        equity: totalEquity,
        liabilitiesAndEquity,
        isBalanced: Math.abs(assets.consolidated - liabilitiesAndEquity.consolidated) < 0.01,
      },
    },
  };
}

/**
 * Pairs each company's intercompany receivable from a counterparty with that counterparty's
 * payable back, both in the reporting currency, so mismatches stand out before eliminating.
 */
export function matchIntercompany(
  balances: { organizationId: string; counterpartyId: string; receivable: number; payable: number }[],
  rateOf: (organizationId: string) => number,
) {
  const pairs = new Map<string, { from: string; to: string; receivable: number; payable: number }>();
  for (const b of balances) {
    if (b.receivable) {
      const k = `${b.organizationId}>${b.counterpartyId}`;
      const p = pairs.get(k) ?? { from: b.organizationId, to: b.counterpartyId, receivable: 0, payable: 0 };
      p.receivable += b.receivable * rateOf(b.organizationId);
      pairs.set(k, p);
    }
    if (b.payable) {
      const k = `${b.counterpartyId}>${b.organizationId}`;
      const p = pairs.get(k) ?? { from: b.counterpartyId, to: b.organizationId, receivable: 0, payable: 0 };
      p.payable += b.payable * rateOf(b.organizationId);
      pairs.set(k, p);
    }
  }
  return [...pairs.values()]
    .map((p) => ({ ...p, receivable: round2(p.receivable), payable: round2(p.payable), difference: round2(p.receivable - p.payable) }))
    .filter((p) => p.receivable !== 0 || p.payable !== 0);
}
