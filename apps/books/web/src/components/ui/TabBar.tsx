import clsx from 'clsx';

export type Tab = { key: string; label: string; count?: number };

/** Underline tab bar with optional count pills (bank-feed review, reports, etc.). */
export function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: Tab[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-gray-200">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={clsx(
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              on ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700',
            )}
          >
            {t.label}
            {typeof t.count === 'number' && (
              <span
                className={clsx(
                  'ml-2 px-1.5 py-0.5 rounded-full text-xs font-semibold',
                  on ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-500',
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
