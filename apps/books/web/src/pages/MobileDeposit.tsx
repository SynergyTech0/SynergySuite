import { useState } from 'react';
import { Plus, X, Upload, Loader2 } from 'lucide-react';
import { SimpleListPage, StatusPill } from '../components/ui';
import type { Column } from '../components/ui';
import { useNicheList } from '../hooks/useNicheList';
import { useBankAccounts, useNicheCreate } from '../hooks/useBankAccounts';
import { num } from '../hooks/useOrgList';
import { formatMoney, formatDate } from '../lib/format';

type Deposit = {
  id: string;
  referenceNumber?: string | null;
  payerName?: string | null;
  checkAmount?: string | number | null;
  status?: string | null;
  uploadedAt?: string | null;
};

type DepositForm = {
  bankAccountId: string;
  amount: string;
  checkNumber: string;
  payerName: string;
  memo: string;
  frontImageBase64: string;
  backImageBase64: string;
};

const EMPTY: DepositForm = { bankAccountId: '', amount: '', checkNumber: '', payerName: '', memo: '', frontImageBase64: '', backImageBase64: '' };

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function MobileDeposit() {
  const q = useNicheList<Deposit>('mobile-deposits', '/mobile-deposits?organizationId={org}', (d) => d.deposits ?? []);
  const banks = useBankAccounts();
  const create = useNicheCreate<Record<string, unknown>>('/mobile-deposits', 'mobile-deposits');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<DepositForm>(EMPTY);

  const set = (k: keyof DepositForm, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const onFile = async (k: 'frontImageBase64' | 'backImageBase64', file?: File) => {
    if (file) set(k, await readFileAsDataUrl(file));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        bankAccountId: form.bankAccountId,
        amount: parseFloat(form.amount) || 0,
        checkNumber: form.checkNumber || undefined,
        payerName: form.payerName || undefined,
        memo: form.memo || undefined,
        frontImageBase64: form.frontImageBase64,
        backImageBase64: form.backImageBase64,
      },
      {
        onSuccess: () => {
          setOpen(false);
          setForm(EMPTY);
        },
      },
    );
  };

  const columns: Column<Deposit>[] = [
    { key: 'ref', header: 'Reference', render: (r) => <span className="font-mono text-gray-700">{r.referenceNumber || '—'}</span> },
    { key: 'payer', header: 'Payer', render: (r) => <span className="font-medium text-gray-900">{r.payerName || '—'}</span> },
    { key: 'date', header: 'Uploaded', render: (r) => <span className="text-gray-500">{r.uploadedAt ? formatDate(r.uploadedAt) : '—'}</span> },
    { key: 'amt', header: 'Amount', align: 'right', render: (r) => <span className="tabular-nums">{formatMoney(num(r.checkAmount))}</span> },
    { key: 'status', header: 'Status', render: (r) => (r.status ? <StatusPill status={r.status} /> : <span className="text-gray-300">—</span>) },
  ];

  const noBanks = !banks.isLoading && (banks.data?.length ?? 0) === 0;

  return (
    <>
      <SimpleListPage
        title="Mobile Deposit"
        subtitle="Deposit checks by photo capture"
        columns={columns}
        rows={q.data ?? []}
        rowKey={(r) => r.id}
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        empty="No mobile deposits yet."
        actions={
          <button className="btn-primary" onClick={() => setOpen(true)} disabled={noBanks} title={noBanks ? 'Add a bank account first' : undefined}>
            <Plus className="w-4 h-4 mr-2" />
            New deposit
          </button>
        }
      />

      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">Deposit a check</h2>
              <button type="button" onClick={() => setOpen(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="label">Deposit to</label>
                <select className="input" value={form.bankAccountId} onChange={(e) => set('bankAccountId', e.target.value)} required autoFocus>
                  <option value="">Select account…</option>
                  {(banks.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.accountName} · ••{b.accountNumber}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Amount</label>
                  <input type="number" className="input" placeholder="0.00" step="0.01" min="0" value={form.amount} onChange={(e) => set('amount', e.target.value)} required />
                </div>
                <div>
                  <label className="label">Check #</label>
                  <input className="input" value={form.checkNumber} onChange={(e) => set('checkNumber', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Payer name</label>
                <input className="input" value={form.payerName} onChange={(e) => set('payerName', e.target.value)} />
              </div>
              <div>
                <label className="label">Memo</label>
                <input className="input" value={form.memo} onChange={(e) => set('memo', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(['frontImageBase64', 'backImageBase64'] as const).map((k, i) => (
                  <label key={k} className="flex flex-col items-center justify-center gap-1 border-2 border-dashed border-gray-300 rounded-lg py-4 cursor-pointer hover:border-primary-400 text-xs text-gray-500">
                    <Upload className="w-5 h-5" />
                    {form[k] ? 'Photo attached' : i === 0 ? 'Front of check' : 'Back of check'}
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(k, e.target.files?.[0])} />
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-400">Photos of the front and back of the check are required.</p>
              {create.isError && <p className="text-sm text-red-600">{(create.error as Error)?.message || 'Could not record deposit.'}</p>}
            </div>
            <div className="p-4 border-t bg-gray-50 rounded-b-xl flex gap-2">
              <button
                type="submit"
                disabled={create.isPending || !form.bankAccountId || !form.amount || !form.frontImageBase64 || !form.backImageBase64}
                className="flex-1 btn-primary"
              >
                {create.isPending ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Record deposit'}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="flex-1 btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
