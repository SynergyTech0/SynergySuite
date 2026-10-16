import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings as SettingsIcon } from 'lucide-react';
import { useClickOutside } from '../hooks/useClickOutside';

type Item = { name: string; href: string };
type Column = { heading: string; items: Item[] };

// Mirrors QuickBooks' gear menu: Your Company / Lists / Tools / Profile.
const COLUMNS: Column[] = [
  {
    heading: 'Your Company',
    items: [
      { name: 'Account and settings', href: '/settings' },
      { name: 'Manage users', href: '/settings' },
      { name: 'Chart of accounts', href: '/accounts' },
    ],
  },
  {
    heading: 'Lists',
    items: [
      { name: 'Products and services', href: '/inventory/bundles' },
      { name: 'Recurring transactions', href: '/journals' },
      { name: 'Tax classification', href: '/tax-classification' },
    ],
  },
  {
    heading: 'Tools',
    items: [
      { name: 'Reconcile', href: '/banking' },
      { name: 'Tax filing', href: '/payroll/tax-filing' },
      { name: 'Import data', href: '/settings' },
    ],
  },
  {
    heading: 'Profile',
    items: [
      { name: 'User profile', href: '/settings' },
    ],
  },
];

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        aria-label="Settings"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <SettingsIcon className="w-5 h-5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-[34rem] max-w-[calc(100vw-1rem)] bg-white rounded-xl shadow-lg border border-gray-200 p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
