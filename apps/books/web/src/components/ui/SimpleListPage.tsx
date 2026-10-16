import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { PageHeader } from './PageHeader';
import { Card } from './Card';
import { DataTable } from './DataTable';
import type { Column } from './DataTable';

/** A title + card + live table with loading/error/empty states — for the many simple list pages. */
export function SimpleListPage<T>({
  title,
  subtitle,
  actions,
  columns,
  rows,
  rowKey,
  isLoading,
  isError,
  error,
  empty = 'No records yet.',
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  empty?: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      {children}
      <Card>
        {isLoading ? (
          <div className="px-4 py-12 text-center text-sm text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
            Loading…
          </div>
        ) : isError ? (
          <div className="px-4 py-12 text-center text-sm text-red-500">
            {(error as Error)?.message || 'Failed to load.'}
          </div>
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={rowKey} emptyMessage={empty} />
        )}
      </Card>
    </div>
  );
}
