import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import clsx from 'clsx';

export type StatTone = 'default' | 'success' | 'warning' | 'danger' | 'accent';

const TONE: Record<StatTone, { bg: string; fg: string }> = {
  default: { bg: 'bg-primary-50', fg: 'text-primary-600' },
  success: { bg: 'bg-green-100', fg: 'text-green-700' },
  warning: { bg: 'bg-amber-100', fg: 'text-amber-700' },
  danger: { bg: 'bg-red-100', fg: 'text-red-700' },
  accent: { bg: 'bg-accent-50', fg: 'text-accent-700' },
};

/** A single KPI tile (icon + value + label), QuickBooks dashboard style. */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: string;
  icon?: LucideIcon;
  tone?: StatTone;
}) {
  const t = TONE[tone];
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
      {Icon && (
        <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', t.bg)}>
          <Icon className={clsx('w-5 h-5', t.fg)} />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xl font-bold text-gray-900 tabular-nums leading-tight">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </div>
  );
}

/** Responsive grid wrapper for a row of StatCards. */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">{children}</div>;
}
