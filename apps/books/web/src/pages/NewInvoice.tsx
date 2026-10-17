import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Send, Loader2 } from 'lucide-react';
import { LineItemGrid, blankLine, lineAmount } from '../components/ui';
import type { LineItem } from '../components/ui';
import { formatMoney } from '../lib/format';
import { useOrgList } from '../hooks/useOrgList';
import { useCreateInvoice } from '../hooks/useInvoices';
import { useInventoryItems } from '../hooks/useInventory';

const TERMS = ['Due on receipt', 'Net 15', 'Net 30', 'Net 60'];

type CustomerOption = { id: string; name: string };

/**
 * Full-page invoice document — the QuickBooks transaction-form archetype, wired to the live API:
 * loads real customers, and Save posts to POST /organizations/:org/invoices.
 */
export function NewInvoice() {
  const navigate = useNavigate();
  const { data: customerData } = useOrgList<CustomerOption>('customers');
  const customers = customerData?.items ?? [];
  const create = useCreateInvoice();
  // Suggest the company's own products and services; any text can still be typed.
  const { data: inventory } = useInventoryItems();
  const itemOptions = (inventory ?? []).map((i) => i.name);

  const [customerId, setCustomerId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [terms, setTerms] = useState('Net 30');
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<LineItem[]>([blankLine(), blankLine()]);

  const subtotal = useMemo(() => lines.reduce((s, l) => s + lineAmount(l), 0), [lines]);
  // The invoice is saved without sales tax lines, so the total is the subtotal.
  const total = subtotal;

  const payloadLines = lines
    .filter((l) => l.item || l.description || l.rate > 0)
    .map((l) => ({
      description: [l.item, l.description].filter(Boolean).join(' — ') || 'Item',
      quantity: l.qty,
      unitPrice: l.rate,
    }));

  const canSave = !!customerId && payloadLines.length > 0 && !create.isPending;

  const save = () => {
    if (!canSave) return;
    create.mutate(
      { customerId, invoiceDate, dueDate: dueDate || undefined, terms, lines: payloadLines },
      { onSuccess: () => navigate('/invoices') },
    );
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/invoices')} className="p-2 rounded-lg hover:bg-gray-100" aria-label="Back">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Invoice</h1>
            <p className="text-sm text-gray-500">New</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Balance due</p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">{formatMoney(total)}</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 border-b border-gray-200">
          <div>
            <label className="label">Customer</label>
            <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Select a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <label className="label mt-4">Terms</label>
            <select className="input" value={terms} onChange={(e) => setTerms(e.target.value)}>
              {TERMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Invoice date</label>
              <input type="date" className="input" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div>
              <label className="label">Due date</label>
              <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="p-6 border-b border-gray-200">
          <LineItemGrid lines={lines} onChange={setLines} itemOptions={itemOptions} />
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div />
          <div className="md:justify-self-end w-full md:max-w-xs">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Subtotal</span>
                <span className="tabular-nums text-gray-900">{formatMoney(subtotal)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-gray-200">
                <span className="font-semibold text-gray-900">Total</span>
                <span className="tabular-nums font-bold text-gray-900 text-lg">{formatMoney(total)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {create.isError && (
        <p className="text-sm text-red-600 mt-3">{(create.error as Error)?.message || 'Could not save invoice.'}</p>
      )}

      <div className="sticky bottom-0 mt-4 flex items-center justify-end gap-2 bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
        <button className="btn-secondary" onClick={() => navigate('/invoices')}>
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
              Save invoice
            </>
          )}
        </button>
        <button className="btn-primary" onClick={save} disabled={!canSave}>
          <Send className="w-4 h-4 mr-2" />
          Save &amp; send
        </button>
      </div>
    </div>
  );
}
