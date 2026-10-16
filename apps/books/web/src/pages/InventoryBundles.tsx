import { useState } from 'react';
import { Plus, X, Trash2, Loader2 } from 'lucide-react';
import { SimpleListPage, StatusPill } from '../components/ui';
import type { Column } from '../components/ui';
import { useNicheList } from '../hooks/useNicheList';
import { useInventoryItems } from '../hooks/useInventory';
import { useNicheCreate } from '../hooks/useBankAccounts';
import { num } from '../hooks/useOrgList';
import { formatMoney } from '../lib/format';

type Bundle = {
  id: string;
  name: string;
  sku?: string | null;
  totalComponentCost?: string | number | null;
  isActive?: boolean | null;
};

type Line = { inventoryItemId: string; quantity: string };

export function InventoryBundles() {
  const q = useNicheList<Bundle>('inventory-bundles', '/inventory/bundles?organizationId={org}', (d) => (Array.isArray(d) ? d : d.items ?? []));
  const inventory = useInventoryItems();
  const create = useNicheCreate<Record<string, unknown>>('/inventory/bundles', 'inventory-bundles');

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ sku: '', name: '', bundleType: 'BUNDLE', sellingPrice: '' });
  const [lines, setLines] = useState<Line[]>([{ inventoryItemId: '', quantity: '1' }]);

  const resetAndClose = () => {
    setOpen(false);
    setForm({ sku: '', name: '', bundleType: 'BUNDLE', sellingPrice: '' });
    setLines([{ inventoryItemId: '', quantity: '1' }]);
  };

  const validLines = lines.filter((l) => l.inventoryItemId && parseFloat(l.quantity) > 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        sku: form.sku,
        name: form.name,
        bundleType: form.bundleType,
        sellingPrice: parseFloat(form.sellingPrice) || 0,
        items: validLines.map((l) => ({ inventoryItemId: l.inventoryItemId, quantity: parseFloat(l.quantity) })),
      },
      { onSuccess: resetAndClose },
    );
  };

  const columns: Column<Bundle>[] = [
    { key: 'name', header: 'Bundle', render: (r) => <span className="font-medium text-primary-600">{r.name}</span> },
    { key: 'sku', header: 'SKU', render: (r) => <span className="font-mono text-gray-500">{r.sku || '—'}</span> },
    { key: 'cost', header: 'Component cost', align: 'right', render: (r) => <span className="tabular-nums">{formatMoney(num(r.totalComponentCost))}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusPill status={r.isActive === false ? 'Inactive' : 'Active'} variant={r.isActive === false ? 'neutral' : 'success'} />,
    },
  ];

  const noItems = !inventory.isLoading && (inventory.data?.length ?? 0) === 0;

  return (
    <>
      <SimpleListPage
        title="Bundles & Kits"
        subtitle="Grouped inventory items sold as a unit"
        columns={columns}
        rows={q.data ?? []}
        rowKey={(r) => r.id}
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        empty="No bundles yet."
        actions={
          <button className="btn-primary" onClick={() => setOpen(true)} disabled={noItems} title={noItems ? 'Add inventory items first' : undefined}>
            <Plus className="w-4 h-4 mr-2" />
            New bundle
          </button>
        }
      />

      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">New bundle</h2>
              <button type="button" onClick={resetAndClose} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Name</label>
                  <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
                </div>
                <div>
                  <label className="label">SKU</label>
                  <input className="input font-mono" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Type</label>
                  <select className="input" value={form.bundleType} onChange={(e) => setForm({ ...form, bundleType: e.target.value })}>
                    <option value="BUNDLE">Bundle</option>
                    <option value="KIT">Kit</option>
                    <option value="ASSEMBLY">Assembly</option>
                  </select>
                </div>
                <div>
                  <label className="label">Selling price</label>
                  <input type="number" className="input" placeholder="0.00" step="0.01" min="0" value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} required />
                </div>
              </div>

              <div>
                <label className="label">Components</label>
                <div className="space-y-2">
                  {lines.map((l, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <select
                        className="input flex-1"
                        value={l.inventoryItemId}
                        onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, inventoryItemId: e.target.value } : x)))}
                      >
                        <option value="">Select item…</option>
                        {(inventory.data ?? []).map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name} · {it.sku}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        className="input w-20"
                        min="1"
                        step="1"
                        value={l.quantity}
                        onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                      />
                      <button
                        type="button"
                        onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : lines)}
                        className="p-2 text-gray-400 hover:text-red-500"
                        aria-label="Remove component"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setLines([...lines, { inventoryItemId: '', quantity: '1' }])} className="mt-2 text-sm text-primary-600 hover:text-primary-700">
                  + Add component
                </button>
              </div>

              {create.isError && <p className="text-sm text-red-600">{(create.error as Error)?.message || 'Could not create bundle.'}</p>}
            </div>
            <div className="p-4 border-t bg-gray-50 rounded-b-xl flex gap-2">
              <button type="submit" disabled={create.isPending || !form.name || !form.sku || validLines.length === 0} className="flex-1 btn-primary">
                {create.isPending ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Create bundle'}
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
