import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import { LineItemGrid, blankLine, lineAmount } from '../components/ui';
import type { LineItem } from '../components/ui';
import { formatMoney } from '../lib/format';
import { useOrgList, useCreateOrgResource } from '../hooks/useOrgList';

const ITEMS = ['Rent', 'Utilities', 'Software', 'Supplies', 'Contractor'];

type VendorOption = { id: string; name: string };
type BillPayload = {
  vendorId: string;
  billDate: string;
  dueDate?: string;
  vendorInvoiceNumber?: string;
  lines: { description: string; quantity: number; unitPrice: number }[];
};

/** New Bill document — the transaction-form archetype for A/P; posts to POST /organizations/:org/bills. */
export function NewBill() {
  const navigate = useNavigate();
  const { data: vendorData } = useOrgList<VendorOption>('vendors');
  const vendors = vendorData?.items ?? [];
  const create = useCreateOrgResource<BillPayload>('bills');

  const [vendorId, setVendorId] = useState('');
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [vendorInvoiceNumber, setVendorInvoiceNumber] = useState('');
  const [lines, setLines] = useState<LineItem[]>([blankLine(), blankLine()]);

  const total = useMemo(() => lines.reduce((s, l) => s + lineAmount(l), 0), [lines]);

  const payloadLines = lines
    .filter((l) => l.item || l.description || l.rate > 0)
    .map((l) => ({
      description: [l.item, l.description].filter(Boolean).join(' — ') || 'Item',
      quantity: l.qty,
      unitPrice: l.rate,
    }));

  const canSave = !!vendorId && payloadLines.length > 0 && !create.isPending;

  const save = () => {
    if (!canSave) return;
    create.mutate(
      { vendorId, billDate, dueDate: dueDate || undefined, vendorInvoiceNumber: vendorInvoiceNumber || undefined, lines: payloadLines },
      { onSuccess: () => navigate('/bills') },
    );
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/bills')} className="p-2 rounded-lg hover:bg-gray-100" aria-label="Back">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Bill</h1>
            <p className="text-sm text-gray-500">New</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Total</p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">{formatMoney(total)}</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 border-b border-gray-200">
          <div>
            <label className="label">Vendor</label>
            <select className="input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">Select a vendor…</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <label className="label mt-4">Vendor invoice #</label>
            <input className="input" value={vendorInvoiceNumber} onChange={(e) => setVendorInvoiceNumber(e.target.value)} placeholder="Optional" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Bill date</label>
              <input type="date" className="input" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            </div>
            <div>
              <label className="label">Due date</label>
              <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="p-6 border-b border-gray-200">
          <LineItemGrid lines={lines} onChange={setLines} itemOptions={ITEMS} />
        </div>

        <div className="p-6 flex justify-end">
          <div className="w-full md:max-w-xs flex justify-between text-sm border-t border-gray-200 pt-3">
            <span className="font-semibold text-gray-900">Total</span>
            <span className="tabular-nums font-bold text-gray-900 text-lg">{formatMoney(total)}</span>
          </div>
        </div>
      </div>

      {create.isError && (
        <p className="text-sm text-red-600 mt-3">{(create.error as Error)?.message || 'Could not save bill.'}</p>
      )}

      <div className="sticky bottom-0 mt-4 flex items-center justify-end gap-2 bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
        <button className="btn-secondary" onClick={() => navigate('/bills')}>
          Cancel
        </button>
        <button className="btn-primary" onClick={save} disabled={!canSave}>
          {create.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save bill
            </>
          )}
        </button>
      </div>
    </div>
  );
}
