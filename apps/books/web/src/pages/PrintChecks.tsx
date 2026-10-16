import { SimpleListPage, StatusPill } from '../components/ui';
import type { Column } from '../components/ui';
import { useNicheList } from '../hooks/useNicheList';
import { num } from '../hooks/useOrgList';
import { formatMoney, formatDate } from '../lib/format';

type Check = {
  id: string;
  checkNumber?: string | number | null;
  payeeName?: string | null;
  amount?: string | number | null;
  checkDate?: string | null;
  status?: string | null;
};

export function PrintChecks() {
  const q = useNicheList<Check>('check-history', '/check-printing/history?organizationId={org}', (d) => d.checks ?? []);
  const columns: Column<Check>[] = [
    { key: 'num', header: 'Check #', render: (r) => <span className="font-mono text-gray-700">{r.checkNumber ?? '—'}</span> },
    { key: 'payee', header: 'Payee', render: (r) => <span className="font-medium text-gray-900">{r.payeeName || '—'}</span> },
    { key: 'date', header: 'Date', render: (r) => <span className="text-gray-500">{r.checkDate ? formatDate(r.checkDate) : '—'}</span> },
    { key: 'amt', header: 'Amount', align: 'right', render: (r) => <span className="tabular-nums">{formatMoney(num(r.amount))}</span> },
    { key: 'status', header: 'Status', render: (r) => (r.status ? <StatusPill status={r.status} /> : <span className="text-gray-300">—</span>) },
  ];
  return (
    <SimpleListPage
      title="Print Checks"
      subtitle="Printed and issued checks"
      columns={columns}
      rows={q.data ?? []}
      rowKey={(r) => r.id}
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      empty="No checks printed yet."
    />
  );
}
