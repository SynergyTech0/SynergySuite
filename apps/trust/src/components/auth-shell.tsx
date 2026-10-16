import Link from 'next/link';

/** Centred card for pages shown without app navigation (no access yet). */
export function AuthShell({
  title,
  sub,
  children,
  wide = false,
}: {
  title: string;
  sub?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full items-center justify-center px-4 py-10">
      <div className={wide ? 'w-full max-w-xl' : 'w-full max-w-sm'}>
        <Link href="/" className="mb-6 flex items-center gap-2">
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded bg-accent text-sm font-bold text-white"
          >
            T
          </span>
          <span className="text-base font-semibold tracking-tight">Trust</span>
        </Link>
        <h1 className="text-lg font-semibold tracking-tight text-ink">{title}</h1>
        {sub ? <p className="mt-1 mb-5 text-sm text-ink-2">{sub}</p> : <div className="mb-5" />}
        <div className="rounded-lg border border-line bg-surface-2/60 p-5">{children}</div>
      </div>
    </div>
  );
}
