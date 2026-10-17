import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, DollarSign, Clock, CheckCircle, AlertCircle, FileCheck, Loader2 } from 'lucide-react';
import { useBills } from '../hooks/useBills';
import type { Bill } from '../hooks/useBills';
import { num } from '../hooks/useOrgList';
import { formatMoney, formatDate } from '../lib/format';

/** The status to show: an unpaid bill past its due date reads as overdue. */
function displayStatus(bill: Bill, today: Date): string {
  const open = ['APPROVED', 'PARTIAL', 'OVERDUE'].includes(bill.status) && num(bill.amountDue) > 0;
  if (open && new Date(bill.dueDate) < today) return 'OVERDUE';
  return bill.status;
}

export function Bills() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const billsQ = useBills();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const allBills = billsQ.data?.items ?? [];

  const sumDue = (pred: (b: Bill) => boolean) =>
    allBills.filter(pred).reduce((sum, b) => sum + num(b.amountDue), 0);
  const pendingApproval = sumDue((b) => b.status === 'DRAFT' || b.status === 'PENDING_APPROVAL');
  const approved = sumDue((b) => ['APPROVED', 'PARTIAL'].includes(b.status) && displayStatus(b, today) !== 'OVERDUE');
  const overdue = sumDue((b) => displayStatus(b, today) === 'OVERDUE');
  const paidMtd = allBills
    .filter((b) => {
      if (!b.paidAt) return false;
      const d = new Date(b.paidAt);
      return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
    })
    .reduce((sum, b) => sum + num(b.amountPaid), 0);

  const q = search.trim().toLowerCase();
  const bills = q
    ? allBills.filter(
        (b) => b.billNumber.toLowerCase().includes(q) || (b.vendor?.name ?? '').toLowerCase().includes(q),
      )
    : allBills;

  const getStatusBadge = (status: string) => {
    const configs: Record<string, { class: string; icon: any; label?: string }> = {
      DRAFT: { class: 'badge bg-gray-100 text-gray-800', icon: null },
      PENDING_APPROVAL: { class: 'badge-warning', icon: Clock, label: 'Pending' },
      APPROVED: { class: 'badge-info', icon: FileCheck },
      PARTIAL: { class: 'badge-info', icon: FileCheck, label: 'Partially paid' },
      PAID: { class: 'badge-success', icon: CheckCircle },
      OVERDUE: { class: 'badge-danger', icon: AlertCircle },
      VOID: { class: 'badge bg-gray-100 text-gray-500', icon: null },
    };
    const config = configs[status] || configs.DRAFT;
    const Icon = config.icon;
    return (
      <span className={config.class}>
        {Icon && <Icon className="w-3 h-3 mr-1" />}
        {config.label ?? status.charAt(0) + status.slice(1).toLowerCase()}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bills</h1>
          <p className="text-gray-500 mt-1">Manage vendor bills and payments</p>
        </div>
        <button className="btn-primary" onClick={() => navigate('/bills/new')}>
          <Plus className="w-4 h-4 mr-2" />
          Create Bill
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-yellow-100 rounded-lg flex items-center justify-center">
              <Clock className="w-4 h-4 text-yellow-600" />
            </div>
            <div>
              <p className="stat-value text-lg">{formatMoney(pendingApproval)}</p>
              <p className="text-xs text-gray-500">Pending Approval</p>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
              <FileCheck className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="stat-value text-lg">{formatMoney(approved)}</p>
              <p className="text-xs text-gray-500">Approved</p>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
              <AlertCircle className="w-4 h-4 text-red-600" />
            </div>
            <div>
              <p className="stat-value text-lg">{formatMoney(overdue)}</p>
              <p className="text-xs text-gray-500">Overdue</p>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <p className="stat-value text-lg">{formatMoney(paidMtd)}</p>
              <p className="text-xs text-gray-500">Paid (MTD)</p>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search bills..."
              className="input pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Bill #</th>
                <th>Vendor</th>
                <th>Date</th>
                <th>Due Date</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Balance</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {billsQ.isLoading && (
                <tr>
                  <td colSpan={8} className="text-center text-gray-400 py-8">
                    <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
                    Loading…
                  </td>
                </tr>
              )}
              {billsQ.isError && (
                <tr>
                  <td colSpan={8} className="text-center text-red-600 py-8">
                    {(billsQ.error as Error).message || 'Bills could not be loaded.'}
                  </td>
                </tr>
              )}
              {billsQ.isSuccess && bills.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-gray-500 py-8">
                    {q ? 'No bills match your search.' : 'No bills yet.'}
                  </td>
                </tr>
              )}
              {bills.map((bill) => (
                <tr key={bill.id}>
                  <td className="font-mono text-primary-600">{bill.billNumber}</td>
                  <td className="font-medium">{bill.vendor?.name ?? '-'}</td>
                  <td className="text-gray-500">{formatDate(bill.billDate)}</td>
                  <td className="text-gray-500">{formatDate(bill.dueDate)}</td>
                  <td className="text-right font-mono">{formatMoney(num(bill.totalAmount))}</td>
                  <td className="text-right font-mono">{formatMoney(num(bill.amountDue))}</td>
                  <td>{getStatusBadge(displayStatus(bill, today))}</td>
                  <td>
                    <button className="btn-secondary text-xs py-1 px-2">
                      <DollarSign className="w-3 h-3 mr-1" />
                      Pay
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
