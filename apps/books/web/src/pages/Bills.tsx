import { Plus, Search, DollarSign, Clock, CheckCircle, AlertCircle, FileCheck } from 'lucide-react';

const bills = [
  { id: 'BILL-2024-00001', vendor: 'Office Depot', date: '2024-01-15', due: '2024-02-14', amount: 450, paid: 0, status: 'PENDING' },
  { id: 'BILL-2024-00002', vendor: 'AWS', date: '2024-01-10', due: '2024-02-09', amount: 1200, paid: 0, status: 'APPROVED' },
  { id: 'BILL-2024-00003', vendor: 'Acme Landlord LLC', date: '2024-01-05', due: '2024-01-20', amount: 3000, paid: 3000, status: 'PAID' },
  { id: 'BILL-2024-00004', vendor: 'John Smith Consulting', date: '2024-01-02', due: '2024-01-17', amount: 5000, paid: 0, status: 'OVERDUE' },
  { id: 'BILL-2024-00005', vendor: 'Jane Doe Design', date: '2024-01-01', due: '2024-01-31', amount: 3500, paid: 0, status: 'DRAFT' },
];

export function Bills() {
  const getStatusBadge = (status: string) => {
    const configs: Record<string, { class: string; icon: any }> = {
      DRAFT: { class: 'badge bg-gray-100 text-gray-800', icon: null },
      PENDING: { class: 'badge-warning', icon: Clock },
      APPROVED: { class: 'badge-info', icon: FileCheck },
      PAID: { class: 'badge-success', icon: CheckCircle },
      OVERDUE: { class: 'badge-danger', icon: AlertCircle },
    };
    const config = configs[status] || configs.DRAFT;
    const Icon = config.icon;
    return (
      <span className={config.class}>
        {Icon && <Icon className="w-3 h-3 mr-1" />}
        {status.charAt(0) + status.slice(1).toLowerCase()}
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
        <button className="btn-primary">
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
              <p className="stat-value text-lg">$1,650</p>
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
              <p className="stat-value text-lg">$1,200</p>
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
              <p className="stat-value text-lg">$5,000</p>
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
              <p className="stat-value text-lg">$3,000</p>
              <p className="text-xs text-gray-500">Paid (MTD)</p>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Search bills..." className="input pl-9" />
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
              {bills.map((bill) => (
                <tr key={bill.id}>
                  <td className="font-mono text-primary-600">{bill.id}</td>
                  <td className="font-medium">{bill.vendor}</td>
                  <td className="text-gray-500">{bill.date}</td>
                  <td className="text-gray-500">{bill.due}</td>
                  <td className="text-right font-mono">${bill.amount.toLocaleString()}</td>
                  <td className="text-right font-mono">${(bill.amount - bill.paid).toLocaleString()}</td>
                  <td>{getStatusBadge(bill.status)}</td>
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
