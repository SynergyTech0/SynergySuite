import { useState } from 'react';
import { Search, CheckCircle, Clock, AlertCircle, ArrowUpRight, ArrowDownRight, Sparkles, Link2, Ban, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useBankTransactions } from '../hooks/useBankTransactions';
import { useAutoCategorize } from '../hooks/useBankAccounts';
import { num } from '../hooks/useOrgList';
import { formatDate } from '../lib/format';

// Filter tabs → API statuses. "For review" is the bank feed's UNMATCHED queue; categorizing clears it.
const FILTERS: { key: string; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'UNMATCHED', label: 'For Review' },
  { key: 'CLEARED', label: 'Categorized' },
  { key: 'MATCHED', label: 'Matched' },
  { key: 'RECONCILED', label: 'Reconciled' },
  { key: 'EXCLUDED', label: 'Excluded' },
];

export function BankTransactions() {
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const allQ = useBankTransactions(undefined, 1000);
  const autoCategorize = useAutoCategorize();

  const all = allQ.data?.items ?? [];
  const countOf = (status: string) => all.filter((t) => t.status === status).length;
  const q = search.trim().toLowerCase();
  const transactions = all
    .filter((t) => statusFilter === 'ALL' || t.status === statusFilter)
    .filter(
      (t) =>
        !q ||
        (t.description ?? '').toLowerCase().includes(q) ||
        (t.merchantName ?? '').toLowerCase().includes(q) ||
        (t.categoryAccount?.name ?? '').toLowerCase().includes(q),
    )
    .map((t) => {
      const credit = t.transactionType === 'CREDIT';
      return { ...t, credit, signed: credit ? Math.abs(num(t.amount)) : -Math.abs(num(t.amount)) };
    });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'RECONCILED':
        return <span className="badge-success"><CheckCircle className="w-3 h-3 mr-1" />Reconciled</span>;
      case 'CLEARED':
      case 'CREATED':
        return <span className="badge-info"><Sparkles className="w-3 h-3 mr-1" />Categorized</span>;
      case 'MATCHED':
        return <span className="badge-info"><Link2 className="w-3 h-3 mr-1" />Matched</span>;
      case 'PENDING':
        return <span className="badge-warning"><Clock className="w-3 h-3 mr-1" />Pending</span>;
      case 'UNMATCHED':
        return <span className="badge-danger"><AlertCircle className="w-3 h-3 mr-1" />For Review</span>;
      case 'EXCLUDED':
        return <span className="badge bg-gray-100 text-gray-600"><Ban className="w-3 h-3 mr-1" />Excluded</span>;
      default:
        return <span className="badge">{status}</span>;
    }
  };

  const formatCurrency = (amount: number) => {
    const formatted = Math.abs(amount).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    });
    return amount < 0 ? `-${formatted}` : `+${formatted}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bank Transactions</h1>
          <p className="text-gray-500 mt-1">Review and categorize imported transactions</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary">
            <Link2 className="w-4 h-4 mr-2" />
            Reconcile
          </button>
          <button className="btn-primary" onClick={() => autoCategorize.mutate(true)} disabled={autoCategorize.isPending}>
            {autoCategorize.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
            Auto-Categorize All
          </button>
        </div>
      </div>

      {autoCategorize.data && (
        <p className="text-sm text-gray-700">
          Categorized {autoCategorize.data.categorized + autoCategorize.data.aiCategorized} of {autoCategorize.data.total}
          {autoCategorize.data.remaining > 0 && ` · ${autoCategorize.data.remaining} still need review`}.
        </p>
      )}
      {autoCategorize.isError && (
        <p className="text-sm text-red-600">{(autoCategorize.error as Error).message || 'Auto-categorize failed.'}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <p className="stat-value">{allQ.data?.total ?? 0}</p>
          <p className="stat-label">Total Transactions</p>
        </div>
        <div className="stat-card">
          <p className="stat-value text-yellow-600">{countOf('PENDING')}</p>
          <p className="stat-label">Pending at Bank</p>
        </div>
        <div className="stat-card">
          <p className="stat-value text-red-600">{countOf('UNMATCHED')}</p>
          <p className="stat-label">Needs Review</p>
        </div>
        <div className="stat-card">
          <p className="stat-value text-green-600">{countOf('RECONCILED')}</p>
          <p className="stat-label">Reconciled</p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search transactions..."
                className="input pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  className={clsx(
                    'px-3 py-1.5 text-sm rounded-lg transition-colors',
                    statusFilter === key
                      ? 'bg-primary-100 text-primary-700 font-medium'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Account</th>
                <th>Category</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {allQ.isLoading && (
                <tr>
                  <td colSpan={6} className="text-center text-gray-400 py-8">
                    <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
                    Loading…
                  </td>
                </tr>
              )}
              {allQ.isError && (
                <tr>
                  <td colSpan={6} className="text-center text-red-600 py-8">
                    {(allQ.error as Error).message || 'Transactions could not be loaded.'}
                  </td>
                </tr>
              )}
              {allQ.isSuccess && transactions.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-gray-500 py-8">
                    {all.length === 0
                      ? 'No bank transactions yet. Connect a bank account to import them.'
                      : 'No transactions match this filter.'}
                  </td>
                </tr>
              )}
              {transactions.map((txn) => (
                <tr key={txn.id} className="hover:bg-gray-50">
                  <td className="text-gray-500">{formatDate(txn.transactionDate)}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      {txn.credit ? (
                        <ArrowDownRight className="w-4 h-4 text-green-500" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4 text-red-500" />
                      )}
                      <span className="font-medium">{txn.description || txn.merchantName || '-'}</span>
                    </div>
                  </td>
                  <td className="text-gray-500 text-sm">{txn.bankAccount?.accountName ?? '-'}</td>
                  <td>
                    {txn.categoryAccount ? (
                      <span className="text-sm">{txn.categoryAccount.name}</span>
                    ) : (
                      <span className="text-gray-400 text-sm italic">Uncategorized</span>
                    )}
                  </td>
                  <td className={clsx(
                    'text-right font-mono',
                    txn.signed >= 0 ? 'text-green-600' : 'text-red-600'
                  )}>
                    {formatCurrency(txn.signed)}
                  </td>
                  <td>{getStatusBadge(txn.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
