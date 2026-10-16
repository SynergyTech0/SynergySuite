import { useState } from 'react';
import { Search, CheckCircle, Clock, AlertCircle, ArrowUpRight, ArrowDownRight, Sparkles, Link2 } from 'lucide-react';
import clsx from 'clsx';

const transactions = [
  { id: '1', date: '2024-01-15', description: 'DEPOSIT - Wire Transfer', amount: 15000, type: 'credit', account: 'Business Checking', status: 'RECONCILED', category: 'Customer Payment', taxCode: 'IRC §61(a)(1)' },
  { id: '2', date: '2024-01-14', description: 'AMZN Mktp US*2K4TY5X', amount: -89.99, type: 'debit', account: 'Credit Card', status: 'CATEGORIZED', category: 'Office Supplies', taxCode: 'IRC §162(a)' },
  { id: '3', date: '2024-01-14', description: 'CHASE CREDIT CRD AUTOPAY', amount: -2500, type: 'debit', account: 'Business Checking', status: 'RECONCILED', category: 'Credit Card Payment', taxCode: null },
  { id: '4', date: '2024-01-13', description: 'UBER *TRIP', amount: -34.50, type: 'debit', account: 'Credit Card', status: 'PENDING', category: null, taxCode: null },
  { id: '5', date: '2024-01-13', description: 'STRIPE TRANSFER', amount: 8750, type: 'credit', account: 'Business Checking', status: 'CATEGORIZED', category: 'Sales Revenue', taxCode: 'IRC §61(a)(2)' },
  { id: '6', date: '2024-01-12', description: 'AWS *SERVICES', amount: -1247.83, type: 'debit', account: 'Credit Card', status: 'CATEGORIZED', category: 'Software & Cloud', taxCode: 'IRC §162(a)' },
  { id: '7', date: '2024-01-11', description: 'COSTCO WHSE', amount: -456.78, type: 'debit', account: 'Credit Card', status: 'NEEDS_REVIEW', category: 'Office Supplies', taxCode: 'IRC §162(a)' },
  { id: '8', date: '2024-01-10', description: 'DEPOSIT - Check #1234', amount: 3200, type: 'credit', account: 'Business Checking', status: 'RECONCILED', category: 'Customer Payment', taxCode: 'IRC §61(a)(1)' },
];

export function BankTransactions() {
  const [statusFilter, setStatusFilter] = useState('ALL');

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'RECONCILED':
        return <span className="badge-success"><CheckCircle className="w-3 h-3 mr-1" />Reconciled</span>;
      case 'CATEGORIZED':
        return <span className="badge-info"><Sparkles className="w-3 h-3 mr-1" />Categorized</span>;
      case 'PENDING':
        return <span className="badge-warning"><Clock className="w-3 h-3 mr-1" />Pending</span>;
      case 'NEEDS_REVIEW':
        return <span className="badge-danger"><AlertCircle className="w-3 h-3 mr-1" />Needs Review</span>;
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
          <button className="btn-primary">
            <Sparkles className="w-4 h-4 mr-2" />
            Auto-Categorize All
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <p className="stat-value">{transactions.length}</p>
          <p className="stat-label">Total Transactions</p>
        </div>
        <div className="stat-card">
          <p className="stat-value text-yellow-600">{transactions.filter(t => t.status === 'PENDING').length}</p>
          <p className="stat-label">Pending Review</p>
        </div>
        <div className="stat-card">
          <p className="stat-value text-red-600">{transactions.filter(t => t.status === 'NEEDS_REVIEW').length}</p>
          <p className="stat-label">Needs Attention</p>
        </div>
        <div className="stat-card">
          <p className="stat-value text-green-600">{transactions.filter(t => t.status === 'RECONCILED').length}</p>
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
              />
            </div>
            <div className="flex gap-2">
              {['ALL', 'PENDING', 'NEEDS_REVIEW', 'CATEGORIZED', 'RECONCILED'].map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={clsx(
                    'px-3 py-1.5 text-sm rounded-lg transition-colors',
                    statusFilter === status
                      ? 'bg-primary-100 text-primary-700 font-medium'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  )}
                >
                  {status === 'ALL' ? 'All' : status.replace('_', ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase())}
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
                <th>Tax Code</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {transactions.map((txn) => (
                <tr key={txn.id} className="hover:bg-gray-50 cursor-pointer">
                  <td className="text-gray-500">{txn.date}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      {txn.type === 'credit' ? (
                        <ArrowDownRight className="w-4 h-4 text-green-500" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4 text-red-500" />
                      )}
                      <span className="font-medium">{txn.description}</span>
                    </div>
                  </td>
                  <td className="text-gray-500 text-sm">{txn.account}</td>
                  <td>
                    {txn.category ? (
                      <span className="text-sm">{txn.category}</span>
                    ) : (
                      <span className="text-gray-400 text-sm italic">Uncategorized</span>
                    )}
                  </td>
                  <td>
                    {txn.taxCode ? (
                      <span className="badge bg-accent-100 text-accent-800 text-xs">{txn.taxCode}</span>
                    ) : (
                      <span className="text-gray-400 text-sm">-</span>
                    )}
                  </td>
                  <td className={clsx(
                    'text-right font-mono',
                    txn.amount >= 0 ? 'text-green-600' : 'text-red-600'
                  )}>
                    {formatCurrency(txn.amount)}
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
