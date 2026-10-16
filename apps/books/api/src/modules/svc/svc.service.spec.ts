import { BadRequestException } from '@nestjs/common';
import { parseSvcJournal, svcAuthorized } from './svc.service';

const line = (number: string, type: string, debit: string, credit: string) => ({
  account: { number, name: `Account ${number}`, type },
  debit,
  credit,
});

const valid = {
  reference: 'HR-PAYRUN-1',
  date: '2026-10-16',
  description: 'Payroll 1',
  source: 'PAYROLL',
  lines: [line('6100', 'EXPENSE', '1000.00', '0.00'), line('2220', 'LIABILITY', '0.00', '250.50'), line('2210', 'LIABILITY', '0', '749.50')],
};

describe('svc journals', () => {
  it('accepts a balanced payroll entry', () => {
    const j = parseSvcJournal(valid);
    expect(j.lines.map((l) => [l.account.number, l.debit, l.credit])).toEqual([
      ['6100', 1000, 0],
      ['2220', 0, 250.5],
      ['2210', 0, 749.5],
    ]);
  });

  it('refuses an unbalanced entry', () => {
    expect(() => parseSvcJournal({ ...valid, lines: [valid.lines[0], valid.lines[1]] })).toThrow(BadRequestException);
  });

  it('refuses a line with both or neither side', () => {
    expect(() => parseSvcJournal({ ...valid, lines: [line('6100', 'EXPENSE', '5', '5'), line('2210', 'LIABILITY', '0', '0')] })).toThrow(
      /either a debit or a credit/,
    );
  });

  it('refuses bad amounts, types, sources and references', () => {
    expect(() => parseSvcJournal({ ...valid, lines: [line('6100', 'EXPENSE', '-1', '0'), valid.lines[2]] })).toThrow(BadRequestException);
    expect(() => parseSvcJournal({ ...valid, lines: [line('6100', 'EXPENSE', '1.234', '0'), valid.lines[2]] })).toThrow(BadRequestException);
    expect(() => parseSvcJournal({ ...valid, lines: [line('6100', 'INCOME', '1', '0'), line('2210', 'LIABILITY', '0', '1')] })).toThrow(/account type/);
    expect(() => parseSvcJournal({ ...valid, source: 'MANUAL' })).toThrow(/source/);
    expect(() => parseSvcJournal({ ...valid, reference: 'has spaces' })).toThrow(/reference/);
    expect(() => parseSvcJournal({ ...valid, date: '16/10/2026' })).toThrow(/date/);
  });

  it('only answers the right token', () => {
    expect(svcAuthorized('Bearer abc', 'abc')).toBe(true);
    expect(svcAuthorized('Bearer abd', 'abc')).toBe(false);
    expect(svcAuthorized('Bearer abc', '')).toBe(false);
    expect(svcAuthorized(undefined, 'abc')).toBe(false);
  });
});
