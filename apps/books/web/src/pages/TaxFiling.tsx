import { SimpleListPage, StatusPill } from '../components/ui';
import type { Column } from '../components/ui';
import { useNicheList } from '../hooks/useNicheList';
import { num } from '../hooks/useOrgList';
import { formatMoney, formatDate } from '../lib/format';

type Filing = {
  id: string;
  filingType?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  totalTaxDue?: string | number | null;
  status?: string | null;
  dueDate?: string | null;
};

export function TaxFiling() {
  const q = useNicheList<Filing>('eftps-filings', '/eftps/filings?organizationId={org}', (d) => d.filings ?? []);
  const columns: Column<Filing>[] = [
    { key: 'form', header: 'Filing', render: (r) => <span className="font-medium text-gray-900">{(r.filingType || '').replace(/_/g, ' ') || '—'}</span> },
    {
      key: 'period',
      header: 'Period',
      render: (r) => <span className="text-gray-600">{r.periodStart ? `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd || r.periodStart)}` : '—'}</span>,
    },
    { key: 'due', header: 'Due', render: (r) => <span className="text-gray-500">{r.dueDate ? formatDate(r.dueDate) : '—'}</span> },
    { key: 'amt', header: 'Tax due', align: 'right', render: (r) => <span className="tabular-nums">{formatMoney(num(r.totalTaxDue))}</span> },
    { key: 'status', header: 'Status', render: (r) => (r.status ? <StatusPill status={r.status} /> : <span className="text-gray-300">—</span>) },
  ];
  return (
    <SimpleListPage
      title="Payroll Tax Filing"
      subtitle="Federal payroll tax filings (941, 940) and EFTPS deposits"
      columns={columns}
      rows={q.data ?? []}
      rowKey={(r) => r.id}
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      empty="No tax filings yet."
    />
  );
}
