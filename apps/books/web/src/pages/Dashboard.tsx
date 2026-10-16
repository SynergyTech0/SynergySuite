import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  FileText,
  AlertCircle,
  CheckCircle,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const revenueData = [
  { month: 'Jan', revenue: 45000, expenses: 32000 },
  { month: 'Feb', revenue: 52000, expenses: 35000 },
  { month: 'Mar', revenue: 48000, expenses: 31000 },
  { month: 'Apr', revenue: 61000, expenses: 38000 },
  { month: 'May', revenue: 55000, expenses: 34000 },
  { month: 'Jun', revenue: 67000, expenses: 42000 },
];

const taxClassifications = [
  { category: 'Ordinary Income', count: 156, amount: 245000 },
  { category: 'Business Expense', count: 89, amount: 78000 },
  { category: 'Depreciation', count: 12, amount: 15000 },
  { category: 'COGS', count: 45, amount: 120000 },
];

const recentTransactions = [
  { id: 1, description: 'Customer Payment - Invoice #1234', amount: 5000, type: 'credit', date: '2024-01-15', status: 'classified' },
  { id: 2, description: 'Office Supplies - Staples', amount: 250, type: 'debit', date: '2024-01-14', status: 'classified' },
  { id: 3, description: 'Software Subscription - AWS', amount: 1200, type: 'debit', date: '2024-01-14', status: 'pending' },
  { id: 4, description: 'Consulting Services Revenue', amount: 8500, type: 'credit', date: '2024-01-13', status: 'classified' },
  { id: 5, description: 'Travel - Client Meeting', amount: 450, type: 'debit', date: '2024-01-12', status: 'review' },
];

export function Dashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">Financial overview and AI tax insights</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-green-600" />
            </div>
            <span className="flex items-center text-sm text-green-600">
              <ArrowUpRight className="w-4 h-4 mr-1" />
              12.5%
            </span>
          </div>
          <div className="mt-4">
            <p className="stat-value">$328,500</p>
            <p className="stat-label">Total Revenue (YTD)</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
              <TrendingDown className="w-5 h-5 text-red-600" />
            </div>
            <span className="flex items-center text-sm text-red-600">
              <ArrowDownRight className="w-4 h-4 mr-1" />
              3.2%
            </span>
          </div>
          <div className="mt-4">
            <p className="stat-value">$212,000</p>
            <p className="stat-label">Total Expenses (YTD)</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <span className="badge-info">23 pending</span>
          </div>
          <div className="mt-4">
            <p className="stat-value">$45,200</p>
            <p className="stat-label">Accounts Receivable</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-purple-600" />
            </div>
            <span className="flex items-center text-sm text-green-600">
              <ArrowUpRight className="w-4 h-4 mr-1" />
              18.3%
            </span>
          </div>
          <div className="mt-4">
            <p className="stat-value">$116,500</p>
            <p className="stat-label">Net Income (YTD)</p>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-semibold">Revenue vs Expenses</h2>
          </div>
          <div className="card-body">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="month" stroke="#6b7280" fontSize={12} />
                  <YAxis stroke="#6b7280" fontSize={12} tickFormatter={(v) => `$${v / 1000}k`} />
                  <Tooltip
                    formatter={(value: number) => [`$${value.toLocaleString()}`, '']}
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stackId="1"
                    stroke="#22c55e"
                    fill="#dcfce7"
                    name="Revenue"
                  />
                  <Area
                    type="monotone"
                    dataKey="expenses"
                    stackId="2"
                    stroke="#ef4444"
                    fill="#fee2e2"
                    name="Expenses"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-semibold">Tax Classification Summary</h2>
            <p className="text-sm text-gray-500 mt-1">AI-powered categorization with IRC citations</p>
          </div>
          <div className="card-body">
            <div className="space-y-4">
              {taxClassifications.map((item, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-primary-500" />
                    <span className="text-sm font-medium text-gray-700">{item.category}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">${item.amount.toLocaleString()}</p>
                    <p className="text-xs text-gray-500">{item.count} transactions</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 p-3 bg-accent-50 rounded-lg">
              <div className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-accent-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-accent-700">98.5% Classification Accuracy</p>
                  <p className="text-xs text-accent-600 mt-0.5">
                    Based on user feedback and tax professional review
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Recent Transactions</h2>
            <p className="text-sm text-gray-500 mt-1">Latest activity with AI tax classification</p>
          </div>
          <button className="btn-secondary text-sm">View All</button>
        </div>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Tax Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {recentTransactions.map((txn) => (
                <tr key={txn.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      {txn.type === 'credit' ? (
                        <ArrowDownRight className="w-4 h-4 text-green-500" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4 text-red-500" />
                      )}
                      <span>{txn.description}</span>
                    </div>
                  </td>
                  <td className="text-gray-500">{txn.date}</td>
                  <td className={txn.type === 'credit' ? 'text-green-600' : 'text-red-600'}>
                    {txn.type === 'credit' ? '+' : '-'}${txn.amount.toLocaleString()}
                  </td>
                  <td>
                    {txn.status === 'classified' && (
                      <span className="badge-success">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Classified
                      </span>
                    )}
                    {txn.status === 'pending' && (
                      <span className="badge-warning">
                        <Clock className="w-3 h-3 mr-1" />
                        Pending
                      </span>
                    )}
                    {txn.status === 'review' && (
                      <span className="badge-info">
                        <AlertCircle className="w-3 h-3 mr-1" />
                        Review
                      </span>
                    )}
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
