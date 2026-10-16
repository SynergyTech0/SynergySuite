import type { ReactNode } from 'react';
import clsx from 'clsx';

/** White rounded bordered container — the base surface for list cards, panels, and forms. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('bg-white border border-gray-200 rounded-xl overflow-hidden', className)}>
      {children}
    </div>
  );
}
