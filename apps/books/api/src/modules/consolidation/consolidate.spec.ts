import { AccountActivity, CompanyInput, consolidate, matchIntercompany } from './consolidate';

type Row = Partial<AccountActivity> & Pick<AccountActivity, 'accountNumber' | 'name' | 'type'>;
const acct = (r: Row): AccountActivity => ({
  subtype: null,
  cumDebit: 0,
  cumCredit: 0,
  perDebit: 0,
  perCredit: 0,
  elimCumDebit: 0,
  elimCumCredit: 0,
  elimPerDebit: 0,
  elimPerCredit: 0,
  ...r,
});
/** Activity that all falls in the report period. */
const posted = (accountNumber: string, name: string, type: AccountActivity['type'], debit: number, credit: number, elim = false) =>
  acct({
    accountNumber,
    name,
    type,
    cumDebit: debit,
    cumCredit: credit,
    perDebit: debit,
    perCredit: credit,
    ...(elim && { elimCumDebit: debit, elimCumCredit: credit, elimPerDebit: debit, elimPerCredit: credit }),
  });

const company = (id: string, accounts: AccountActivity[], closingRate = 1, averageRate = closingRate, currency = 'USD'): CompanyInput => ({
  id,
  name: id,
  currency,
  closingRate,
  averageRate,
  accounts,
});

describe('consolidate', () => {
  it('eliminates an intercompany charge in full', () => {
    // Parent sold 1,000 to outsiders and charged Sub 300 for services; Sub spent it.
    const parent = company('Parent', [
      posted('1010', 'Checking', 'ASSET', 1000, 0),
      posted('1450', 'Intercompany Receivable', 'ASSET', 300, 0, true),
      posted('3000', 'Owner equity', 'EQUITY', 0, 0),
      posted('4000', 'Sales', 'REVENUE', 0, 1000),
      posted('4000', 'Sales', 'REVENUE', 0, 300, true),
    ]);
    // Two rows with the same number add up; merge them like the ledger query would.
    parent.accounts = [
      parent.accounts[0],
      parent.accounts[1],
      acct({ accountNumber: '4000', name: 'Sales', type: 'REVENUE', cumCredit: 1300, perCredit: 1300, elimCumCredit: 300, elimPerCredit: 300 }),
    ];
    const sub = company('Sub', [
      posted('2450', 'Intercompany Payable', 'LIABILITY', 0, 300, true),
      posted('6000', 'Professional fees', 'EXPENSE', 300, 0, true),
    ]);
    const r = consolidate([parent, sub]);

    expect(r.incomeStatement.totals.revenue).toEqual({ byCompany: [1300, 0], eliminations: -300, consolidated: 1000 });
    expect(r.incomeStatement.totals.expenses).toEqual({ byCompany: [0, 300], eliminations: -300, consolidated: 0 });
    expect(r.incomeStatement.totals.netIncome.consolidated).toBe(1000);
    const ic = r.balanceSheet.assets.find((l) => l.accountNumber === '1450')!;
    expect(ic.consolidated).toBe(0);
    expect(r.balanceSheet.totals.assets.consolidated).toBe(1000);
    expect(r.balanceSheet.totals.liabilities.consolidated).toBe(0);
    expect(r.balanceSheet.earnings.consolidated).toBe(1000);
    expect(r.balanceSheet.eliminationDifference.consolidated).toBe(0);
    expect(r.balanceSheet.totals.isBalanced).toBe(true);
  });

  it('keeps the bank lines of an intercompany loan and drops the balances', () => {
    const parent = company('Parent', [
      acct({ accountNumber: '1010', name: 'Checking', type: 'ASSET', cumDebit: 5000, cumCredit: 2000 }),
      acct({ accountNumber: '1450', name: 'Intercompany Receivable', type: 'ASSET', cumDebit: 2000, elimCumDebit: 2000 }),
      acct({ accountNumber: '3000', name: 'Capital', type: 'EQUITY', cumCredit: 5000 }),
    ]);
    const sub = company('Sub', [
      acct({ accountNumber: '1010', name: 'Checking', type: 'ASSET', cumDebit: 2000 }),
      acct({ accountNumber: '2450', name: 'Intercompany Payable', type: 'LIABILITY', cumCredit: 2000, elimCumCredit: 2000 }),
    ]);
    const r = consolidate([parent, sub]);
    expect(r.balanceSheet.assets.find((l) => l.accountNumber === '1010')!.consolidated).toBe(5000);
    expect(r.balanceSheet.totals.assets.consolidated).toBe(5000);
    expect(r.balanceSheet.totals.liabilities.consolidated).toBe(0);
    expect(r.balanceSheet.totals.isBalanced).toBe(true);
  });

  it('translates a foreign subsidiary and books the translation adjustment', () => {
    // Sub keeps EUR. Capital 1,000 and earnings 200 this period; closing 1.10, average 1.05.
    const sub = company(
      'Sub',
      [
        acct({ accountNumber: '1010', name: 'Bank', type: 'ASSET', cumDebit: 1200 }),
        acct({ accountNumber: '3000', name: 'Capital', type: 'EQUITY', cumCredit: 1000 }),
        acct({ accountNumber: '4000', name: 'Sales', type: 'REVENUE', cumCredit: 200, perCredit: 200 }),
      ],
      1.1,
      1.05,
      'EUR',
    );
    const parent = company('Parent', [acct({ accountNumber: '1010', name: 'Checking', type: 'ASSET', cumDebit: 0 })]);
    const r = consolidate([parent, sub]);
    expect(r.incomeStatement.totals.revenue.consolidated).toBe(210);
    expect(r.balanceSheet.totals.assets.consolidated).toBe(1320);
    expect(r.balanceSheet.equity[0].consolidated).toBe(1100);
    expect(r.balanceSheet.earnings.consolidated).toBe(210);
    expect(r.balanceSheet.translationAdjustment.consolidated).toBe(10);
    expect(r.balanceSheet.totals.isBalanced).toBe(true);
  });

  it('shows intercompany balances that do not match after translation', () => {
    const parent = company('Parent', [
      acct({ accountNumber: '1450', name: 'IC Receivable', type: 'ASSET', cumDebit: 1000, elimCumDebit: 1000 }),
      acct({ accountNumber: '1010', name: 'Checking', type: 'ASSET', cumCredit: 1000 }),
    ]);
    const sub = company(
      'Sub',
      [
        acct({ accountNumber: '1010', name: 'Bank', type: 'ASSET', cumDebit: 900 }),
        acct({ accountNumber: '2450', name: 'IC Payable', type: 'LIABILITY', cumCredit: 900, elimCumCredit: 900 }),
      ],
      1.2,
      1.2,
      'EUR',
    );
    const r = consolidate([parent, sub]);
    expect(r.balanceSheet.eliminationDifference.consolidated).toBe(80);
    expect(r.balanceSheet.totals.isBalanced).toBe(true);
    const pairs = matchIntercompany(
      [
        { organizationId: 'Parent', counterpartyId: 'Sub', receivable: 1000, payable: 0 },
        { organizationId: 'Sub', counterpartyId: 'Parent', receivable: 0, payable: 900 },
      ],
      (id) => (id === 'Sub' ? 1.2 : 1),
    );
    expect(pairs).toEqual([{ from: 'Parent', to: 'Sub', receivable: 1000, payable: 1080, difference: -80 }]);
  });

  it('names lines from the first company and flags unbalanced books', () => {
    const parent = company('Parent', [acct({ accountNumber: '6000', name: 'Rent', type: 'EXPENSE', cumDebit: 10, perDebit: 10 })]);
    const sub = company('Sub', [acct({ accountNumber: '6000', name: 'Office rent', type: 'EXPENSE', cumDebit: 5, perDebit: 5 })]);
    const r = consolidate([parent, sub]);
    expect(r.incomeStatement.expenses).toHaveLength(1);
    expect(r.incomeStatement.expenses[0]).toMatchObject({ name: 'Rent', byCompany: [10, 5], consolidated: 15 });
    expect(r.companies[0].localImbalance).toBe(10);
  });
});
