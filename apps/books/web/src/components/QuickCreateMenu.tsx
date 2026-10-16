import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import clsx from 'clsx';
import { useClickOutside } from '../hooks/useClickOutside';

type Item = { name: string; href: string };
type Column = { heading: string; items: Item[] };

// QuickBooks' "+ New" is grouped by who/what the transaction is about.
// Each item routes to the relevant workspace (create flows land here once pages are data-wired).
const COLUMNS: Column[] = [
  {
    heading: 'Customers',
    items: [
      { name: 'Invoice', href: '/invoices' },
      { name: 'Receive payment', href: '/invoices' },
      { name: 'Estimate', href: '/customers' },
      { name: 'Sales receipt', href: '/invoices' },
      { name: 'Customer', href: '/customers' },
    ],
  },
  {
    heading: 'Vendors',
    items: [
      { name: 'Bill', href: '/bills' },
      { name: 'Expense', href: '/bills' },
      { name: 'Check', href: '/banking/print-checks' },
      { name: 'Purchase order', href: '/bills' },
      { name: 'Vendor', href: '/vendors' },
    ],
  },
  {
    heading: 'Other',
    items: [
      { name: 'Bank deposit', href: '/banking/mobile-deposit' },
      { name: 'Transfer', href: '/banking/transactions' },
      { name: 'Journal entry', href: '/journals' },
      { name: 'Inventory bundle', href: '/inventory/bundles' },
    ],
  },
];

export function QuickCreateMenu() {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));

  return (
    <div className="relative px-3 pt-3 pb-1" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-colors',
          'bg-primary-600 text-white hover:bg-primary-700 shadow-sm',
        )}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Plus className="w-4 h-4" strokeWidth={2.5} />
        New
      </button>

      {open && (
        <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-white rounded-xl shadow-lg border border-gray-200 p-4">
          <div className="grid grid-cols-1 gap-4">
            {COLUMNS.map((col) => (
              <div key={col.heading}>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                  {col.heading}
                </p>
                <div className="space-y-0.5">
                  {col.items.map((item) => (
                    <Link
                      key={item.name}
                      to={item.href}
                      onClick={() => setOpen(false)}
                      className="block px-2 py-1.5 text-sm text-gray-700 rounded-md hover:bg-primary-50 hover:text-primary-700 transition-colors"
                    >
                      {item.name}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
