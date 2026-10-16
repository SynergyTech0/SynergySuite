import { useState } from 'react';
import { Plus, Search, ChevronRight, ChevronDown, Edit, Trash2 } from 'lucide-react';
import clsx from 'clsx';

const accountTypes = ['All', 'Asset', 'Liability', 'Equity', 'Revenue', 'Expense'];

const accounts = [
  {
    id: '1',
    code: '1000',
    name: 'Cash and Cash Equivalents',
    type: 'Asset',
    subType: 'Current Asset',
    balance: 125000,
    children: [
      { id: '1a', code: '1010', name: 'Checking Account', type: 'Asset', subType: 'Current Asset', balance: 85000 },
      { id: '1b', code: '1020', name: 'Savings Account', type: 'Asset', subType: 'Current Asset', balance: 40000 },
    ],
  },
  { id: '2', code: '1100', name: 'Accounts Receivable', type: 'Asset', subType: 'Current Asset', balance: 45200 },
  { id: '3', code: '1500', name: 'Fixed Assets', type: 'Asset', subType: 'Fixed Asset', balance: 150000, children: [
    { id: '3a', code: '1510', name: 'Equipment', type: 'Asset', subType: 'Fixed Asset', balance: 75000 },
    { id: '3b', code: '1590', name: 'Accumulated Depreciation', type: 'Asset', subType: 'Fixed Asset', balance: -25000 },
  ]},
  { id: '4', code: '2000', name: 'Accounts Payable', type: 'Liability', subType: 'Current Liability', balance: 28000 },
  { id: '5', code: '3000', name: "Owner's Equity", type: 'Equity', subType: 'Equity', balance: 200000 },
  { id: '6', code: '4000', name: 'Revenue', type: 'Revenue', subType: 'Operating Revenue', balance: 328500 },
  { id: '7', code: '5000', name: 'Cost of Goods Sold', type: 'Expense', subType: 'COGS', balance: 120000 },
  { id: '8', code: '6000', name: 'Operating Expenses', type: 'Expense', subType: 'Operating Expense', balance: 92000, children: [
    { id: '8a', code: '6100', name: 'Salaries and Wages', type: 'Expense', subType: 'Operating Expense', balance: 65000 },
    { id: '8b', code: '6200', name: 'Rent Expense', type: 'Expense', subType: 'Operating Expense', balance: 18000 },
    { id: '8c', code: '6300', name: 'Utilities', type: 'Expense', subType: 'Operating Expense', balance: 9000 },
  ]},
];

export function ChartOfAccounts() {
  const [selectedType, setSelectedType] = useState('All');
  const [expandedAccounts, setExpandedAccounts] = useState<string[]>(['1', '3', '8']);
  const [searchQuery, setSearchQuery] = useState('');

  const toggleExpanded = (id: string) => {
    setExpandedAccounts((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const filteredAccounts = accounts.filter(
    (acc) =>
      (selectedType === 'All' || acc.type === selectedType) &&
      (searchQuery === '' ||
        acc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        acc.code.includes(searchQuery))
  );

  const formatCurrency = (amount: number) => {
    const formatted = Math.abs(amount).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    });
    return amount < 0 ? `(${formatted})` : formatted;
  };

  const renderAccount = (account: typeof accounts[0], level = 0) => (
    <div key={account.id}>
      <div
        className={clsx(
          'flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100',
          level > 0 && 'bg-gray-50/50'
        )}
        style={{ paddingLeft: `${16 + level * 24}px` }}
      >
        <div className="flex items-center gap-3">
          {account.children && account.children.length > 0 ? (
            <button
              onClick={() => toggleExpanded(account.id)}
              className="p-0.5 hover:bg-gray-200 rounded"
            >
              {expandedAccounts.includes(account.id) ? (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-500" />
              )}
            </button>
          ) : (
            <div className="w-5" />
          )}
          <span className="font-mono text-sm text-gray-500 w-16">{account.code}</span>
          <span className="font-medium text-gray-900">{account.name}</span>
        </div>
        <div className="flex items-center gap-6">
          <span className="text-xs text-gray-500 w-24">{account.subType}</span>
          <span className={clsx(
            'font-mono text-sm w-28 text-right',
            account.balance < 0 ? 'text-red-600' : 'text-gray-900'
          )}>
            {formatCurrency(account.balance)}
          </span>
          <div className="flex items-center gap-1">
            <button className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors">
              <Edit className="w-4 h-4 text-gray-400" />
            </button>
            <button className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors">
              <Trash2 className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        </div>
      </div>
      {account.children && expandedAccounts.includes(account.id) && (
        <div>
          {account.children.map((child) => renderAccount(child as any, level + 1))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Chart of Accounts</h1>
          <p className="text-gray-500 mt-1">Manage your general ledger accounts</p>
        </div>
        <button className="btn-primary">
          <Plus className="w-4 h-4 mr-2" />
          Add Account
        </button>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search accounts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input pl-9"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {accountTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => setSelectedType(type)}
                  className={clsx(
                    'px-3 py-1.5 text-sm rounded-lg transition-colors',
                    selectedType === type
                      ? 'bg-primary-100 text-primary-700 font-medium'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  )}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="divide-y divide-gray-100">
          <div className="flex items-center justify-between px-4 py-2 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            <div className="flex items-center gap-3">
              <div className="w-5" />
              <span className="w-16">Code</span>
              <span>Account Name</span>
            </div>
            <div className="flex items-center gap-6">
              <span className="w-24">Type</span>
              <span className="w-28 text-right">Balance</span>
              <span className="w-16">Actions</span>
            </div>
          </div>
          {filteredAccounts.map((account) => renderAccount(account))}
        </div>
      </div>
    </div>
  );
}
