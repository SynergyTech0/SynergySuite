import clsx from 'clsx';

export type PillVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const STYLES: Record<PillVariant, string> = {
  success: 'bg-green-100 text-green-800',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
  info: 'bg-primary-100 text-primary-700',
  neutral: 'bg-gray-100 text-gray-700',
};

// Default mapping for the accounting status vocabularies used across SynergyBooks.
const DEFAULT_MAP: Record<string, PillVariant> = {
  PAID: 'success', COMPLETED: 'success', ACTIVE: 'success', APPROVED: 'success',
  CLEARED: 'success', RECONCILED: 'success', FUNDED: 'success', ACCEPTED: 'success',
  OPEN: 'warning', PARTIAL: 'warning', PENDING: 'warning', PENDING_APPROVAL: 'warning',
  PROCESSING: 'warning', IN_PROGRESS: 'warning', UPLOADED: 'warning', SOFT_CLOSE: 'warning',
  SENT: 'info', SUBMITTED: 'info', MATCHED: 'info',
  OVERDUE: 'danger', FAILED: 'danger', REJECTED: 'danger', RETURNED: 'danger',
  DISCREPANCY: 'danger', WRITTEN_OFF: 'danger',
  DRAFT: 'neutral', VOID: 'neutral', VOIDED: 'neutral', CANCELLED: 'neutral',
  EXCLUDED: 'neutral', CLOSED: 'neutral', LOCKED: 'neutral', ARCHIVED: 'neutral',
};

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** QuickBooks-style status pill. Pass an explicit `variant` to override the default color map. */
export function StatusPill({
  status,
  variant,
  label,
}: {
  status: string;
  variant?: PillVariant;
  label?: string;
}) {
  const v = variant ?? DEFAULT_MAP[status.toUpperCase()] ?? 'neutral';
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold',
        STYLES[v],
      )}
    >
      {label ?? titleCase(status)}
    </span>
  );
}
