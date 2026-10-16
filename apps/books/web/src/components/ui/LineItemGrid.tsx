import { Plus, Trash2 } from 'lucide-react';
import { formatMoney } from '../../lib/format';

export type LineItem = {
  id: string;
  item: string;
  description: string;
  qty: number;
  rate: number;
};

export const lineAmount = (l: LineItem): number => l.qty * l.rate;

let seq = 0;
export const blankLine = (): LineItem => ({
  id: `line-${Date.now()}-${seq++}`,
  item: '',
  description: '',
  qty: 1,
  rate: 0,
});

/**
 * The editable line-item grid at the heart of every QuickBooks transaction document
 * (invoice, bill, estimate, PO). Controlled: owns no state, calls `onChange` with the
 * next array. Amount is derived (qty × rate) and always read-only.
 */
export function LineItemGrid({
  lines,
  onChange,
  itemOptions = [],
}: {
  lines: LineItem[];
  onChange: (next: LineItem[]) => void;
  itemOptions?: string[];
}) {
  const update = (id: string, patch: Partial<LineItem>) =>
    onChange(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const remove = (id: string) => onChange(lines.filter((l) => l.id !== id));
  const add = () => onChange([...lines, blankLine()]);

  const num = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <th className="px-3 py-2 text-left w-8">#</th>
              <th className="px-3 py-2 text-left min-w-[10rem]">Product / Service</th>
              <th className="px-3 py-2 text-left min-w-[14rem]">Description</th>
              <th className="px-3 py-2 text-right w-24">Qty</th>
              <th className="px-3 py-2 text-right w-32">Rate</th>
              <th className="px-3 py-2 text-right w-32">Amount</th>
              <th className="px-3 py-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id} className="border-b border-gray-100 last:border-0">
                <td className="px-3 py-1.5 text-sm text-gray-400">{i + 1}</td>
                <td className="px-3 py-1.5">
                  <input
                    list="line-item-options"
                    value={l.item}
                    onChange={(e) => update(l.id, { item: e.target.value })}
                    placeholder="Select…"
                    className="w-full px-2 py-1.5 text-sm rounded-md border border-transparent hover:border-gray-300 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    value={l.description}
                    onChange={(e) => update(l.id, { description: e.target.value })}
                    placeholder="Description"
                    className="w-full px-2 py-1.5 text-sm rounded-md border border-transparent hover:border-gray-300 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={l.qty}
                    onChange={(e) => update(l.id, { qty: num(e.target.value) })}
                    className="w-full px-2 py-1.5 text-sm text-right tabular-nums rounded-md border border-transparent hover:border-gray-300 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={l.rate}
                    onChange={(e) => update(l.id, { rate: num(e.target.value) })}
                    className="w-full px-2 py-1.5 text-sm text-right tabular-nums rounded-md border border-transparent hover:border-gray-300 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none"
                  />
                </td>
                <td className="px-3 py-1.5 text-sm text-right tabular-nums text-gray-900 font-medium">
                  {formatMoney(lineAmount(l))}
                </td>
                <td className="px-3 py-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => remove(l.id)}
                    className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                    aria-label="Remove line"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <datalist id="line-item-options">
        {itemOptions.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>

      <button
        type="button"
        onClick={add}
        className="flex items-center gap-2 px-3 py-2.5 w-full text-sm font-medium text-primary-700 hover:bg-primary-50 border-t border-gray-200"
      >
        <Plus className="w-4 h-4" />
        Add line
      </button>
    </div>
  );
}
