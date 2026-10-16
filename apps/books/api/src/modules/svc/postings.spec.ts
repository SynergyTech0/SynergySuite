import { parsePosting } from './postings';

const ok = {
  reference: 'commerce:sale:S-000001',
  kind: 'sale',
  date: '2026-10-16',
  description: 'Sale S-000001',
  lines: [
    { account: '1010', debit: 10.5, credit: 0, description: 'cash' },
    { account: '4010', debit: 0, credit: 10, description: 'sales' },
    { account: '2300', debit: 0, credit: 0.5, description: 'tax' },
  ],
};

describe('parsePosting', () => {
  it('accepts a balanced entry', () => {
    expect(parsePosting(ok)).toMatchObject({ reference: ok.reference, kind: 'sale', lines: ok.lines });
  });

  it('refuses one that does not balance to the cent', () => {
    expect(() => parsePosting({ ...ok, lines: [ok.lines[0], { ...ok.lines[1], credit: 10.49 }] })).toThrow(/does not balance/);
  });

  it('refuses lines with both or neither side, and bad amounts', () => {
    expect(() => parsePosting({ ...ok, lines: [{ account: '1', debit: 1, credit: 1 }, ok.lines[1]] })).toThrow(/not both/);
    expect(() => parsePosting({ ...ok, lines: [{ account: '1', debit: 0, credit: 0 }, ok.lines[1]] })).toThrow(/not both/);
    expect(() => parsePosting({ ...ok, lines: [{ account: '1', debit: -1 }, ok.lines[1]] })).toThrow(/positive amount/);
    expect(() => parsePosting({ ...ok, lines: [{ account: '1', debit: 1.005 }, ok.lines[1]] })).toThrow(/two decimals/);
  });

  it('checks the kind, date and reference', () => {
    expect(() => parsePosting({ ...ok, kind: 'gift' })).toThrow(/kind/);
    expect(() => parsePosting({ ...ok, date: '16/10/2026' })).toThrow(/date/);
    expect(() => parsePosting({ ...ok, reference: '' })).toThrow(/reference/);
  });

  it('reads a vendor bill', () => {
    const p = parsePosting({ ...ok, kind: 'receipt', bill: { vendor: { name: 'Acme', email: 'a@acme.test' }, number: 'PO-00001-R1', vendorRef: 'INV-7', dueDays: 400 } });
    expect(p.bill).toEqual({ vendor: { name: 'Acme', email: 'a@acme.test' }, number: 'PO-00001-R1', vendorRef: 'INV-7', dueDays: 30 });
  });
});
