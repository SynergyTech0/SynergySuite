import { Outlet, NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  BookOpen,
  FileText,
  Users,
  Building2,
  Landmark,
  BarChart3,
  Calculator,
  Sparkles,
  Settings,
  X,
  ChevronDown,
  Package,
  Briefcase,
  Target,
  Network,
} from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';
import { TopBar } from './TopBar';
import { SuiteBar } from './SuiteBar';
import { QuickCreateMenu } from './QuickCreateMenu';
import { useTaxAiStatus } from '../hooks/useTaxAi';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Chart of Accounts', href: '/accounts', icon: BookOpen },
  { name: 'Journal Entries', href: '/journals', icon: FileText },
  {
    name: 'Receivables',
    icon: Users,
    children: [
      { name: 'Customers', href: '/customers' },
      { name: 'Invoices', href: '/invoices' },
    ],
  },
  {
    name: 'Payables',
    icon: Building2,
    children: [
      { name: 'Vendors', href: '/vendors' },
      { name: 'Bills', href: '/bills' },
    ],
  },
  {
    name: 'Banking',
    icon: Landmark,
    children: [
      { name: 'Bank Accounts', href: '/banking' },
      { name: 'Spend Cards', href: '/cards' },
      { name: 'For Review', href: '/banking/review' },
      { name: 'Transactions', href: '/banking/transactions' },
      { name: 'Print Checks', href: '/banking/print-checks' },
      { name: 'Mobile Deposit', href: '/banking/mobile-deposit' },
      { name: 'Direct Deposit', href: '/banking/direct-deposit' },
    ],
  },
  {
    name: 'Inventory',
    icon: Package,
    children: [{ name: 'Bundles & Kits', href: '/inventory/bundles' }],
  },
  { name: 'Projects', href: '/projects', icon: Briefcase },
  { name: 'Reports', href: '/reports', icon: BarChart3 },
  { name: 'Budgets', href: '/budgets', icon: Target },
  { name: 'Consolidation', href: '/consolidation', icon: Network },
  { name: 'Tax Classification', href: '/tax-classification', icon: Calculator },
  { name: 'Tax AI', href: '/tax-ai', icon: Sparkles },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const taxAi = useTaxAiStatus();
  const [expandedItems, setExpandedItems] = useState<string[]>([
    'Receivables',
    'Payables',
    'Banking',
    'Inventory',
  ]);

  const toggleExpanded = (name: string) => {
    setExpandedItems((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
    <SuiteBar />
    <div className="flex-1 bg-gray-50 flex">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-gray-900/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-50 w-60 bg-white border-r border-gray-200 flex flex-col transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:relative lg:z-auto',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Brand */}
        <div className="flex items-center justify-between h-14 px-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
              <Calculator className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg text-gray-900">SynergyBooks</span>
          </div>
          <button
            className="lg:hidden p-1 rounded-lg hover:bg-gray-100"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick create (QuickBooks "+ New") */}
        <QuickCreateMenu />

        {/* Primary navigation */}
        <nav className="flex-1 px-2 py-1 space-y-0.5 overflow-y-auto">
          {navigation.map((item) =>
            item.children ? (
              <div key={item.name}>
                <button
                  onClick={() => toggleExpanded(item.name)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100"
                >
                  <div className="flex items-center gap-3">
                    <item.icon className="w-5 h-5 text-gray-400" />
                    {item.name}
                  </div>
                  <ChevronDown
                    className={clsx(
                      'w-4 h-4 transition-transform',
                      expandedItems.includes(item.name) && 'rotate-180',
                    )}
                  />
                </button>
                {expandedItems.includes(item.name) && (
                  <div className="mt-0.5 ml-4 pl-4 border-l border-gray-200 space-y-0.5">
                    {item.children.map((child) => (
                      <NavLink
                        key={child.href}
                        to={child.href}
                        onClick={() => setSidebarOpen(false)}
                        className={({ isActive }) =>
                          clsx(
                            'block px-3 py-1.5 text-sm rounded-lg transition-colors',
                            isActive
                              ? 'bg-primary-50 text-primary-700 font-medium'
                              : 'text-gray-600 hover:bg-gray-100',
                          )
                        }
                      >
                        {child.name}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <NavLink
                key={item.href}
                to={item.href!}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors',
                    isActive
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-gray-700 hover:bg-gray-100',
                  )
                }
              >
                <item.icon className="w-5 h-5 text-gray-400" />
                {item.name}
              </NavLink>
            ),
          )}
        </nav>

        {/* AI tax intelligence badge */}
        <div className="p-3 border-t border-gray-200 shrink-0">
          <div className="flex items-center gap-3 px-3 py-2 bg-accent-50 rounded-lg">
            <div className="w-8 h-8 bg-accent-500 rounded-full flex items-center justify-center shrink-0">
              <span className="text-white text-sm font-medium">AI</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-accent-700">Tax Intelligence</p>
              <p className="text-xs text-accent-600">
                {taxAi.isLoading ? 'Checking…' : taxAi.data?.configured ? 'Active' : 'Not configured'}
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
    </div>
  );
}
