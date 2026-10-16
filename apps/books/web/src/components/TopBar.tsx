import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Search, HelpCircle, Bell, ChevronDown, Check } from 'lucide-react';
import clsx from 'clsx';
import { useClickOutside } from '../hooks/useClickOutside';
import { SettingsMenu } from './SettingsMenu';
import { useCompanies, useSwitchCompany } from '../hooks/usePlanning';

function CompanySwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
  const { data: companies } = useCompanies();
  const switchTo = useSwitchCompany();
  const navigate = useNavigate();
  const current = companies?.find((c) => c.current);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors max-w-[12rem]"
      >
        <span className="truncate">{current?.name ?? 'Company'}</span>
        <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-64 bg-white rounded-xl shadow-lg border border-gray-200 py-1">
          <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Switch company
          </p>
          {(companies ?? []).map((c) => (
            <button
              key={c.id}
              disabled={switchTo.isPending}
              onClick={() => {
                setOpen(false);
                if (!c.current) switchTo.mutate(c.id, { onSuccess: () => navigate('/dashboard') });
              }}
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <span className="truncate">
                {c.name} <span className="text-gray-400">{c.currency}</span>
              </span>
              {c.current && <Check className="w-4 h-4 text-primary-600 shrink-0" />}
            </button>
          ))}
          <button
            onClick={() => {
              setOpen(false);
              navigate('/consolidation');
            }}
            className="w-full px-3 py-2 text-left text-sm text-primary-600 hover:bg-gray-50 border-t border-gray-100"
          >
            Manage companies and groups
          </button>
        </div>
      )}
    </div>
  );
}

function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
  const items = [
    { title: '3 invoices are overdue', meta: 'Receivables · today' },
    { title: 'Bank feed has 12 transactions to review', meta: 'Banking · 2h ago' },
    { title: 'Form 941 filing due in 5 days', meta: 'Payroll · yesterday' },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-accent-500 rounded-full ring-2 ring-white" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-80 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900">Notifications</p>
          </div>
          <div className="divide-y divide-gray-100">
            {items.map((n) => (
              <div key={n.title} className="px-4 py-3 hover:bg-gray-50 cursor-pointer">
                <p className="text-sm text-gray-800">{n.title}</p>
                <p className="text-xs text-gray-400 mt-0.5">{n.meta}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <header className="sticky top-0 z-30 bg-white border-b border-gray-200">
      <div className="flex items-center gap-2 h-14 px-3 sm:px-4">
        <button
          className="lg:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-100"
          onClick={onMenuClick}
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <CompanySwitcher />

        {/* Global search */}
        <div className="flex-1 max-w-md mx-auto hidden sm:block">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="search"
              placeholder="Search transactions, customers, reports…"
              className={clsx(
                'w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-gray-100 border border-transparent',
                'placeholder-gray-400 focus:outline-none focus:bg-white focus:border-primary-500 focus:ring-1 focus:ring-primary-500',
              )}
            />
          </div>
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <button
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors hidden sm:inline-flex"
            aria-label="Help"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
          <NotificationsMenu />
          <SettingsMenu />
          <button
            className="ml-1 flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Account"
          >
            <span className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center text-white text-sm font-semibold">
              JD
            </span>
            <span className="hidden md:block text-sm font-medium text-gray-700">Jane Doe</span>
          </button>
        </div>
      </div>
    </header>
  );
}
