import {
  actualsByPeriod,
  budgetPeriods,
  closedPeriods,
  fiscalYearEndDate,
  fiscalYearStart,
  forecastLine,
  isFavorable,
  planFor,
  spread,
  variancePercent,
} from './budget-math';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

describe('fiscal years', () => {
  it('runs January to December by default', () => {
    expect(iso(fiscalYearStart(2026))).toBe('2026-01-01');
    expect(iso(fiscalYearEndDate(2026))).toBe('2026-12-31');
  });

  it('ends in the named month of the fiscal year', () => {
    expect(iso(fiscalYearStart(2026, 6))).toBe('2025-07-01');
    expect(iso(fiscalYearEndDate(2026, 6))).toBe('2026-06-30');
  });
});

describe('budgetPeriods', () => {
  it('splits a year into months, quarters or one year', () => {
    const months = budgetPeriods(d('2026-01-01'), d('2026-12-31'), 'MONTHLY');
    expect(months).toHaveLength(12);
    expect(months[1]).toMatchObject({ label: 'Feb 2026' });
    expect(iso(months[1].end)).toBe('2026-02-28');
    const quarters = budgetPeriods(d('2025-07-01'), d('2026-06-30'), 'QUARTERLY');
    expect(quarters.map((q) => iso(q.end))).toEqual(['2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30']);
    expect(budgetPeriods(d('2026-01-01'), d('2026-12-31'), 'ANNUAL')).toHaveLength(1);
  });

  it('refuses a range that ends first', () => {
    expect(() => budgetPeriods(d('2026-05-01'), d('2026-01-31'), 'MONTHLY')).toThrow(/ends before/);
  });
});

describe('spread and planFor', () => {
  it('spreads to the cent with the remainder last', () => {
    expect(spread(100, 3)).toEqual([33.33, 33.33, 33.34]);
    expect(spread(1200, 12).every((x) => x === 100)).toBe(true);
  });

  it('takes explicit period amounts, which must match the period count', () => {
    expect(planFor(2, { periodAmounts: [1.005, 2] })).toEqual([1.01, 2]);
    expect(() => planFor(3, { periodAmounts: [1, 2] })).toThrow(/Give 3 period amounts/);
    expect(planFor(4, { budgetAmount: 10 })).toEqual([2.5, 2.5, 2.5, 2.5]);
  });
});

describe('actualsByPeriod', () => {
  it('buckets monthly activity into periods on each account natural side', () => {
    const periods = budgetPeriods(d('2026-01-01'), d('2026-12-31'), 'QUARTERLY');
    const rows = [
      { accountId: 'rev', month: d('2026-01-01'), debit: 0, credit: 500 },
      { accountId: 'rev', month: d('2026-02-01'), debit: 50, credit: 300 },
      { accountId: 'exp', month: d('2026-05-01'), debit: 200, credit: 20 },
      { accountId: 'exp', month: d('2027-01-01'), debit: 999, credit: 0 },
    ];
    const types = new Map([
      ['rev', 'REVENUE'],
      ['exp', 'EXPENSE'],
    ]);
    const out = actualsByPeriod(rows, periods, types);
    expect(out.get('rev')).toEqual([750, 0, 0, 0]);
    expect(out.get('exp')).toEqual([0, 180, 0, 0]);
  });
});

describe('variance', () => {
  it('calls more revenue and less expense favorable', () => {
    expect(isFavorable('REVENUE', 100, 120)).toBe(true);
    expect(isFavorable('EXPENSE', 100, 120)).toBe(false);
    expect(isFavorable('ASSET', 100, 120)).toBeNull();
    expect(variancePercent(200, 150)).toBe(-25);
    expect(variancePercent(0, 10)).toBeNull();
  });
});

describe('forecastLine', () => {
  const budget = [100, 100, 100, 100];
  const actual = [80, 120, 0, 0];

  it('keeps actuals for closed periods', () => {
    expect(forecastLine(budget, actual, 2, 'BUDGET')).toEqual([80, 120, 100, 100]);
  });

  it('repeats the average closed period for run rate', () => {
    expect(forecastLine(budget, [90, 110, 0, 0], 2, 'RUN_RATE')).toEqual([90, 110, 100, 100]);
    expect(forecastLine(budget, [60, 0, 0, 0], 1, 'RUN_RATE')).toEqual([60, 60, 60, 60]);
  });

  it('extends the trend line', () => {
    expect(forecastLine(budget, [10, 20, 30, 0], 3, 'TREND')).toEqual([10, 20, 30, 40]);
    // One closed period is not a trend: it falls back to run rate.
    expect(forecastLine(budget, [50, 0, 0, 0], 1, 'TREND')).toEqual([50, 50, 50, 50]);
  });

  it('uses the plan when nothing has closed', () => {
    expect(forecastLine(budget, [0, 0, 0, 0], 0, 'TREND')).toEqual(budget);
  });

  it('counts periods that ended by the as-of date as closed', () => {
    const periods = budgetPeriods(d('2026-01-01'), d('2026-12-31'), 'MONTHLY');
    expect(closedPeriods(periods, d('2026-03-31'))).toBe(3);
    expect(closedPeriods(periods, d('2026-03-30'))).toBe(2);
  });
});
