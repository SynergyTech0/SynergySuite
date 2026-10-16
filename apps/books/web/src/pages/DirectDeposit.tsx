import { useState } from 'react';
import { Plus, X, Trash2, Loader2 } from 'lucide-react';
import { SimpleListPage, StatusPill } from '../components/ui';
import type { Column } from '../components/ui';
import { useNicheList } from '../hooks/useNicheList';
import { useBankAccounts, useVendorBankAccounts, useNicheCreate } from '../hooks/useBankAccounts';
import { num } from '../hooks/useOrgList';
import { formatMoney, formatDate } from '../lib/format';

type AchBatch = {
  id: string;
  batchNumber?: string | null;
  effectiveDate?: string | null;
  transactionCount?: number | null;
  totalAmount?: string | number | null;
  totalCredits?: string | number | null;
  status?: string | null;
};

type TxnRow = { vendorBankAccountId: string; amount: string };

const BATCH_TYPES = [
  { value: 'VENDOR_PAYMENT', label: 'Vendor payment' },
  { value: 'PAYROLL', label: 'Payroll' },
  { value: 'REFUND', label: 'Refund' },
  { value: 'COLLECTION', label: 'Collection' },
];

export function DirectDeposit() {
  const q = useNicheList<AchBatch>('ach-batches', '/ach/batches?organizationId={org}', (d) => (Array.isArray(d) ? d : d.batches ?? d.items ?? []));
  const banks = useBankAccounts();
  const recipients = useVendorBankAccounts();
  const create = useNicheCreate<Record<string, unknown>>('/ach/batches', 'ach-batches');

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ bankAccountId: '', batchType: 'VENDOR_PAYMENT', effectiveDate: '', companyName: 'Acme Corporation', companyId: '1234567890' });
  const [rows, setRows] = useState<TxnRow[]>([{ vendorBankAccountId: '', amount: '' }]);

  const resetAndClose = () => {
    setOpen(false);
    setForm({ bankAccountId: '', batchType: 'VENDOR_PAYMENT', effectiveDate: '', companyName: 'Acme Corporation', companyId: '1234567890' });
    setRows([{ vendorBankAccountId: '', amount: '' }]);
  };

  const validRows = rows.filter((r) => r.vendorBankAccountId && parseFloat(r.amount) > 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const transactions = validRows.map((r) => {
      const vba = (recipients.data ?? []).find((v) => v.id === r.vendorBankAccountId)!;
      return {
        recipientType: 'VENDOR',
        recipientId: vba.vendorId,
        recipientBankAccountId: vba.id,
        amount: parseFloat(r.amount),
        transactionType: 'CREDIT',
      };
    });
    create.mutate(
      {
        bankAccountId: form.bankAccountId,
        batchType: form.batchType,
        effectiveDate: form.effectiveDate,
        companyName: form.companyName,
        companyId: form.companyId,
        transactions,
      },
      { onSuccess: resetAndClose },
    );
  };

  const columns: Column<AchBatch>[] = [
    { key: 'num', header: 'Batch #', render: (r) => <span className="font-medium text-primary-600">{r.batchNumber || '—'}</span> },
    { key: 'date', header: 'Effective', render: (r) => <span className="text-gray-500">{r.effectiveDate ? formatDate(r.effectiveDate) : '—'}</span> },
    { key: 'entries', header: 'Entries', align: 'right', render: (r) => <span className="tabular-nums">{r.transactionCount ?? 0}</span> },
    { key: 'amt', header: 'Amount', align: 'right', render: (r) => <span className="tabular-nums">{formatMoney(num(r.totalAmount ?? r.totalCredits))}</span> },
    { key: 'status', header: 'Status', render: (r) => (r.status ? <StatusPill status={r.status} /> : <span className="text-gray-300">—</span>) },
  ];

  const noBanks = !banks.isLoading && (banks.data?.length ?? 0) === 0;
  const noRecipients = !recipients.isLoading && (recipients.data?.length ?? 0) === 0;
  const blocked = noBanks || noRecipients;

  return (
    <>
      <SimpleListPage
        title="Direct Deposit"
        subtitle="ACH batches for payroll and vendor payments"
        columns={columns}
        rows={q.data ?? []}
        rowKey={(r) => r.id}
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        empty="No ACH batches yet."
        actions={
          <button className="btn-primary" onClick={() => setOpen(true)} disabled={blocked} title={blocked ? 'Needs a bank account and a vendor bank account' : undefined}>
            <Plus className="w-4 h-4 mr-2" />
            New batch
          </button>
        }
      />

      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">New ACH batch</h2>
              <button type="button" onClick={resetAndClose} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Fund from</label>
                  <select className="input" value={form.bankAccountId} onChange={(e) => setForm({ ...form, bankAccountId: e.target.value })} required autoFocus>
                    <option value="">Select account…</option>
                    {(banks.data ?? []).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.accountName} · ••{b.accountNumber}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Batch type</label>
                  <select className="input" value={form.batchType} onChange={(e) => setForm({ ...form, batchType: e.target.value })}>
                    {BATCH_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Effective date</label>
                  <input type="date" className="input" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} required />
                </div>
                <div>
                  <label className="label">Company name</label>
                  <input className="input" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} required />
                </div>
                <div>
                  <label className="label">Company ID</label>
                  <input className="input font-mono" value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })} required />
                </div>
              </div>

              <div>
                <label className="label">Payments</label>
                <div className="space-y-2">
                  {rows.map((r, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <select
                        className="input flex-1"
                        value={r.vendorBankAccountId}
                        onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, vendorBankAccountId: e.target.value } : x)))}
                      >
                        <option value="">Select recipient…</option>
                        {(recipients.data ?? []).map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.vendorName} · {v.bankName} {v.accountLast4}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        className="input w-28"
                        placeholder="0.00"
                        step="0.01"
                        min="0"
                        value={r.amount}
                        onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                      />
                      <button
                        type="button"
                        onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : rows)}
                        className="p-2 text-gray-400 hover:text-red-500"
                        aria-label="Remove payment"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setRows([...rows, { vendorBankAccountId: '', amount: '' }])} className="mt-2 text-sm text-primary-600 hover:text-primary-700">
                  + Add payment
                </button>
              </div>

              {create.isError && <p className="text-sm text-red-600">{(create.error as Error)?.message || 'Could not create batch.'}</p>}
            </div>
            <div className="p-4 border-t bg-gray-50 rounded-b-xl flex gap-2">
              <button type="submit" disabled={create.isPending || !form.bankAccountId || !form.effectiveDate || validRows.length === 0} className="flex-1 btn-primary">
                {create.isPending ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Create batch'}
              </button>
              <button type="button" onClick={resetAndClose} className="flex-1 btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
