import { useState, type ReactElement } from 'react';
import { Plus, Search, ChevronRight, ChevronDown, Edit, Trash2, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useAccounts } from '../hooks/useAccounts';
import type { Account } from '../hooks/useAccounts';
import { useTrialBalance } from '../hooks/useIncomeStatement';

const accountTypes = ['All', 'Asset', 'Liability', 'Equity', 'Revenue', 'Expense'];

type AccountRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  subType: string;
  balance: number;
  children?: AccountRow[];
};

const titleCase = (v: string) => v.toLowerCase().replace(/(^|[\s_])\w/g, (m) => m.toUpperCase()).replace(/_/g, ' ');

/** Nest accounts under their parents; each row carries its ledger balance. */
function buildTree(accounts: Account[], balances: Map<string, number>): AccountRow[] {
  const rows = new Map<string, AccountRow>();
  for (const a of accounts) {
    rows.set(a.id, {
      id: a.id,
      code: a.accountNumber,
      name: a.name,
      type: titleCase(a.accountType),
      subType: a.accountSubtype ? titleCase(a.accountSubtype) : '',
      balance: balances.get(a.id) ?? 0,
    });
  }
  const roots: AccountRow[] = [];
  for (const a of accounts) {
    const row = rows.get(a.id)!;
    const parent = a.parentId ? rows.get(a.parentId) : undefined;
    if (parent) (parent.children ??= []).push(row);
    else roots.push(row);
  }
  return roots;
}

export function ChartOfAccounts() {
  const [selectedType, setSelectedType] = useState('All');
  const [collapsedAccounts, setCollapsedAccounts] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const accountsQ = useAccounts();
  const trialBalance = useTrialBalance();

  const balances = new Map<string, number>();
  for (const row of trialBalance.data?.accounts ?? []) {
    if (row.accountId) balances.set(row.accountId, row.balance ?? 0);
  }
  const accounts = buildTree(accountsQ.data ?? [], balances);

  const toggleExpanded = (id: string) => {
    setCollapsedAccounts((prev) =>
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

  const renderAccount = (account: AccountRow, level = 0): ReactElement => (
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
              {!collapsedAccounts.includes(account.id) ? (
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
      {account.children && !collapsedAccounts.includes(account.id) && (
        <div>
          {account.children.map((child) => renderAccount(child, level + 1))}
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
          {(accountsQ.isLoading || trialBalance.isLoading) && (
            <div className="px-4 py-12 text-center text-sm text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
              Loading…
            </div>
          )}
          {accountsQ.isError && (
            <div className="px-4 py-12 text-center text-sm text-red-600">
              {(accountsQ.error as Error).message || 'Accounts could not be loaded.'}
            </div>
          )}
          {accountsQ.isSuccess && !trialBalance.isLoading && filteredAccounts.length === 0 && (
            <div className="px-4 py-12 text-center text-sm text-gray-500">
              {(accountsQ.data ?? []).length === 0 ? 'No accounts yet.' : 'No accounts match your filter.'}
            </div>
          )}
          {!trialBalance.isLoading && filteredAccounts.map((account) => renderAccount(account))}
        </div>
      </div>
    </div>
  );
}
