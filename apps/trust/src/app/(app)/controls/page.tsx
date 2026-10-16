import Link from 'next/link';
import { controls } from '@/lib/queries';
import { pageSession } from '@/components/guard';
import {
  Card, ControlStatusBadge, Empty, FrameworkTag, PageHead, ago,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ControlsPage() {
  const s = await pageSession();

  const rows = await controls(s);

  // Group by category so the list reads as a programme rather than an alphabet.
  const byCategory = new Map<string, typeof rows>();
  for (const c of rows) {
    const k = c.category ?? 'Uncategorised';
    byCategory.set(k, [...(byCategory.get(k) ?? []), c]);
  }

  const implemented = rows.filter((c) => c.status === 'implemented').length;

  return (
    <>
      <PageHead
        eyebrow="Controls"
        title="Control library"
        sub={
          <>
            {rows.length} controls, {implemented} implemented. Each maps to requirements in
            every framework at once — so implementing one moves several readiness figures.
          </>
        }
      />

      {rows.length === 0 ? (
        <Card>
          <Empty>No controls yet. Run <code className="hash">npm run db:seed</code>.</Empty>
        </Card>
      ) : (
        <div className="space-y-6">
          {[...byCategory.entries()].map(([category, items]) => (
            <section key={category}>
              <h2 className="mb-2 text-sm font-semibold text-ink">{category}</h2>
              <Card>
                <ul className="divide-y divide-line">
                  {items.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/controls/${c.key}`}
                        className="block px-4 py-3 transition-colors hover:bg-surface-2"
                      >
                        <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                          <code className="hash mt-0.5 shrink-0 text-xs font-medium text-accent">
                            {c.key}
                          </code>
                          <p className="min-w-0 flex-1 text-sm font-medium text-ink">{c.title}</p>
                          <div className="flex shrink-0 flex-wrap items-center gap-1">
                            {c.frameworks.map((f) => (
                              <FrameworkTag key={f} k={f} />
                            ))}
                          </div>
                          <ControlStatusBadge status={c.status} />
                        </div>
                        <p className="mt-1 text-xs text-ink-3">
                          <span className="tnum">{c.mapped_requirements}</span> requirements ·{' '}
                          <span className="tnum">{c.evidence_count}</span> evidence items · last
                          evidence {ago(c.latest_evidence)}
                          {c.monitor_count > 0 ? (
                            <span className="text-ok"> · {c.monitor_count} monitor</span>
                          ) : (
                            <span> · no monitor</span>
                          )}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
