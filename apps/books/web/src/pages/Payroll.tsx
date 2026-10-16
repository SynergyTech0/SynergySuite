import { Plus, DollarSign, Users, Calendar, Loader2 } from 'lucide-react';
import { PageHeader, StatGrid, StatCard, Card, DataTable, StatusPill } from '../components/ui';
import type { Column } from '../components/ui';
import { formatMoney, formatDate } from '../lib/format';
import { num } from '../hooks/useOrgList';
import { usePayrollRuns } from '../hooks/usePayroll';
import type { PayrollRun } from '../hooks/usePayroll';

export function Payroll() {
  const { data, isLoading, isError, error } = usePayrollRuns();
  const runs = data?.runs ?? [];

  const ytdGross = runs.reduce((s, r) => s + num(r.totalGrossPay), 0);
  const ytdNet = runs.reduce((s, r) => s + num(r.totalNetPay), 0);
  const lastEmployees = runs[0]?.employeeCount ?? 0;

  const columns: Column<PayrollRun>[] = [
    { key: 'num', header: 'Run #', render: (r) => <span className="font-medium text-primary-600">{r.runNumber}</span> },
    {
      key: 'period',
      header: 'Pay period',
      render: (r) => (
        <span className="text-gray-700">
          {formatDate(r.periodStart)} – {formatDate(r.periodEnd)}
        </span>
      ),
    },
    { key: 'payDate', header: 'Pay date', render: (r) => <span className="text-gray-500">{r.payDate ? formatDate(r.payDate) : '—'}</span> },
    { key: 'emp', header: 'Employees', align: 'right', render: (r) => <span className="tabular-nums">{r.employeeCount ?? 0}</span> },
    { key: 'gross', header: 'Gross', align: 'right', render: (r) => <span className="tabular-nums">{formatMoney(num(r.totalGrossPay))}</span> },
    { key: 'net', header: 'Net', align: 'right', render: (r) => <span className="tabular-nums font-medium text-gray-900">{formatMoney(num(r.totalNetPay))}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Payroll"
        subtitle="Run payroll and manage pay periods"
        actions={
          <button className="btn-primary">
            <Plus className="w-4 h-4 mr-2" />
            Run payroll
          </button>
        }
      />

      <StatGrid>
        <StatCard label="Payroll runs" value={String(data?.total ?? 0)} icon={Calendar} tone="default" />
        <StatCard label="Gross (YTD)" value={formatMoney(ytdGross)} icon={DollarSign} tone="warning" />
        <StatCard label="Net paid (YTD)" value={formatMoney(ytdNet)} icon={DollarSign} tone="success" />
        <StatCard label="Employees (last run)" value={String(lastEmployees)} icon={Users} tone="accent" />
      </StatGrid>

      <Card>
        {isLoading ? (
          <div className="px-4 py-12 text-center text-sm text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
            Loading payroll runs…
          </div>
        ) : isError ? (
          <div className="px-4 py-12 text-center text-sm text-red-500">
            {(error as Error)?.message || 'Failed to load payroll.'}
          </div>
        ) : (
          <DataTable columns={columns} rows={runs} rowKey={(r) => r.id} emptyMessage="No payroll runs yet." />
        )}
      </Card>
    </div>
  );
}
