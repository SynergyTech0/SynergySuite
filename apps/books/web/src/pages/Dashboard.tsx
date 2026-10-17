import { useNavigate } from 'react-router-dom';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  FileText,
  CheckCircle,
  Clock,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
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
import { formatMoney, formatDate } from '../lib/format';
import { useIncomeStatement, useMonthlyIncome, useArAging } from '../hooks/useIncomeStatement';
import { useJournals } from '../hooks/useJournals';
import { useTaxClassificationStats, categoryLabel } from '../hooks/useTaxClassification';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Year to date, and the same span of last year for the change badges. */
function ytdRanges() {
  const now = new Date();
  const y = now.getFullYear();
  const lastYearToday = new Date(y - 1, now.getMonth(), now.getDate());
  return {
    current: { start: `${y}-01-01`, end: iso(now) },
    prior: { start: `${y - 1}-01-01`, end: iso(lastYearToday) },
  };
}

/** Percent change vs last year; null when last year has nothing to compare with. */
function change(current: number, prior: number | undefined): number | null {
  if (prior === undefined || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

/** Up/down badge for a real year-over-year change; `goodWhenUp` colors it. */
function ChangeBadge({ pct, goodWhenUp = true }: { pct: number | null; goodWhenUp?: boolean }) {
  if (pct === null) return null;
  const up = pct >= 0;
  const good = up === goodWhenUp;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`flex items-center text-sm ${good ? 'text-green-600' : 'text-red-600'}`} title="Compared with the same period last year">
      <Icon className="w-4 h-4 mr-1" />
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const { current, prior } = ytdRanges();
  const ytd = useIncomeStatement(current.start, current.end);
  const lastYear = useIncomeStatement(prior.start, prior.end);
  const monthly = useMonthlyIncome(6);
  const aging = useArAging();
  const recent = useJournals({ take: 5 });
  const taxStats = useTaxClassificationStats();

  const revenue = ytd.data?.totals?.totalRevenue ?? 0;
  const expenses = ytd.data?.totals?.totalExpenses ?? 0;
  const netIncome = ytd.data?.totals?.netIncome ?? revenue - expenses;
  const prev = lastYear.data?.totals;

  const receivable = aging.data?.summary.total ?? 0;
  const openInvoices = aging.data
    ? Object.values(aging.data.detail).reduce((n, bucket) => n + bucket.length, 0)
    : 0;

  const money = (v: number, loading: boolean) => (loading ? '…' : formatMoney(v));
  const hasMonthlyActivity = monthly.data.some((m) => m.revenue !== 0 || m.expenses !== 0);
  const categories = (taxStats.data?.byCategory ?? []).slice().sort((a, b) => b.count - a.count);
  const entries = recent.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">Financial overview and AI tax insights</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-card" data-testid="revenue-widget">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-green-600" />
            </div>
            <ChangeBadge pct={change(revenue, prev?.totalRevenue)} />
          </div>
          <div className="mt-4">
            <p className="stat-value">{money(revenue, ytd.isLoading)}</p>
            <p className="stat-label">Total Revenue (YTD)</p>
          </div>
        </div>

        <div className="stat-card" data-testid="expense-widget">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
              <TrendingDown className="w-5 h-5 text-red-600" />
            </div>
            <ChangeBadge pct={change(expenses, prev?.totalExpenses)} goodWhenUp={false} />
          </div>
          <div className="mt-4">
            <p className="stat-value">{money(expenses, ytd.isLoading)}</p>
            <p className="stat-label">Total Expenses (YTD)</p>
          </div>
        </div>

        <div className="stat-card" data-testid="ar-widget">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            {openInvoices > 0 && <span className="badge-info">{openInvoices} open</span>}
          </div>
          <div className="mt-4">
            <p className="stat-value">{money(receivable, aging.isLoading)}</p>
            <p className="stat-label">Accounts Receivable</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-purple-600" />
            </div>
            <ChangeBadge pct={change(netIncome, prev?.netIncome)} />
          </div>
          <div className="mt-4">
            <p className="stat-value">{money(netIncome, ytd.isLoading)}</p>
            <p className="stat-label">Net Income (YTD)</p>
          </div>
        </div>
      </div>

      {(ytd.isError || aging.isError) && (
        <p className="text-sm text-red-600">Some figures could not be loaded. Refresh the page to try again.</p>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-semibold">Revenue vs Expenses</h2>
            <p className="text-sm text-gray-500 mt-1">Last 6 months</p>
          </div>
          <div className="card-body">
            <div className="h-64">
              {monthly.isLoading ? (
                <div className="h-full flex items-center justify-center text-sm text-gray-400">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  Loading…
                </div>
              ) : !hasMonthlyActivity ? (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <p className="text-sm font-medium text-gray-700">No revenue or expenses yet</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Posted invoices, bills and journal entries will chart here month by month.
                  </p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthly.data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" stroke="#6b7280" fontSize={12} />
                    <YAxis stroke="#6b7280" fontSize={12} tickFormatter={(v) => `$${v / 1000}k`} />
                    <Tooltip
                      formatter={(value: number) => [formatMoney(value), '']}
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
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-semibold">Tax Classification Summary</h2>
            <p className="text-sm text-gray-500 mt-1">AI-powered categorization with IRC citations</p>
          </div>
          <div className="card-body">
            {taxStats.isLoading ? (
              <div className="py-8 text-center text-sm text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
                Loading…
              </div>
            ) : categories.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm font-medium text-gray-700">Nothing classified yet</p>
                <p className="text-xs text-gray-500 mt-1">
                  Classified journal lines are summarized here by tax category.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {categories.map((item) => (
                  <div key={item.category ?? 'none'} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-primary-500" />
                      <span className="text-sm font-medium text-gray-700">{categoryLabel(item.category)}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">
                        {item.count} line{item.count === 1 ? '' : 's'}
                      </p>
                      {item.avgConfidence !== null && (
                        <p className="text-xs text-gray-500">{Math.round(item.avgConfidence * 100)}% avg confidence</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {taxStats.data?.accuracy != null && (
              <div className="mt-6 p-3 bg-accent-50 rounded-lg">
                <div className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-accent-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-accent-700">
                      {(taxStats.data.accuracy * 100).toFixed(1)}% marked correct
                    </p>
                    <p className="text-xs text-accent-600 mt-0.5">Based on your feedback on classifications</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent activity */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Recent Transactions</h2>
            <p className="text-sm text-gray-500 mt-1">Latest journal entries in your books</p>
          </div>
          <button className="btn-secondary text-sm" onClick={() => navigate('/journals')}>
            View All
          </button>
        </div>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {recent.isLoading ? (
                <tr>
                  <td colSpan={4} className="text-center text-gray-400 py-8">
                    <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
                    Loading…
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center text-gray-500 py-8">
                    No transactions yet. Invoices, bills and journal entries you record will appear here.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-gray-400">{entry.entryNumber ?? entry.journalNumber}</span>
                        <span>{entry.description || 'Journal entry'}</span>
                      </div>
                    </td>
                    <td className="text-gray-500">{formatDate(entry.journalDate)}</td>
                    <td className="font-mono">{formatMoney(entry.totalDebit)}</td>
                    <td>
                      {entry.status === 'POSTED' ? (
                        <span className="badge-success">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Posted
                        </span>
                      ) : entry.status === 'VOIDED' || entry.status === 'REVERSED' ? (
                        <span className="badge-info">
                          <AlertCircle className="w-3 h-3 mr-1" />
                          {entry.status === 'VOIDED' ? 'Voided' : 'Reversed'}
                        </span>
                      ) : (
                        <span className="badge-warning">
                          <Clock className="w-3 h-3 mr-1" />
                          {entry.status.charAt(0) + entry.status.slice(1).toLowerCase().replace('_', ' ')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
