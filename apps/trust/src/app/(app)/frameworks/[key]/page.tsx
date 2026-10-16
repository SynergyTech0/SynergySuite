import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirementStatuses, frameworkSummaries, EVIDENCE_WINDOW_DAYS } from '@/lib/queries';
import { pageSession } from '@/components/guard';
import {
  Card, Meter, ObligationBadge, PageHead, ReqStatusBadge, Stat, ago, pct,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

const SEGMENTS = [
  { key: 'implemented', cls: 'bg-ok', label: 'Implemented' },
  { key: 'partial', cls: 'bg-warn', label: 'Partial' },
  { key: 'mapped_only', cls: 'bg-info', label: 'Mapped, not done' },
  { key: 'unmapped', cls: 'bg-bad', label: 'No control' },
] as const;

export default async function FrameworkPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const s = await pageSession();

  const [rows, summaries] = await Promise.all([
    requirementStatuses(s, key),
    frameworkSummaries(s),
  ]);
  const summary = summaries.find((f) => f.framework_key === key);
  if (!summary || rows.length === 0) notFound();

  // Group by top-level part, then by section, preserving the catalog's own ordering.
  const parts = new Map<string, { title: string; sections: Map<string, { title: string; rows: typeof rows }> }>();
  for (const r of rows) {
    const part = parts.get(r.root_key) ?? { title: r.root_title, sections: new Map() };
    const sec = part.sections.get(r.section_key) ?? { title: r.section_title, rows: [] };
    sec.rows.push(r);
    part.sections.set(r.section_key, sec);
    parts.set(r.root_key, part);
  }

  const denom = summary.total - summary.counts.not_applicable;

  return (
    <>
      <PageHead
        eyebrow="Framework"
        title={summary.framework_name}
        sub={summary.scope_note ?? undefined}
        right={
          <Link href="/" className="text-xs font-medium text-accent hover:underline">
            Back to overview
          </Link>
        }
      />

      <Card className="mb-6 px-4 py-4">
        <div className="mb-4 flex flex-wrap items-start gap-8">
          <Stat label="In scope" value={String(denom)} hint="requirements" />
          <Stat
            label="Implemented"
            value={pct(summary.implemented_pct)}
            hint={`${summary.counts.implemented} of ${denom}`}
            tone={summary.implemented_pct >= 0.9 ? 'ok' : summary.implemented_pct >= 0.4 ? 'warn' : 'bad'}
          />
          <Stat
            label="Audit ready"
            value={pct(summary.audit_ready_pct)}
            hint={`evidenced in ${EVIDENCE_WINDOW_DAYS}d`}
            tone={summary.audit_ready_pct >= 0.9 ? 'ok' : summary.audit_ready_pct > 0 ? 'warn' : 'bad'}
          />
          {summary.counts.not_applicable > 0 ? (
            <Stat
              label="Not applicable"
              value={String(summary.counts.not_applicable)}
              hint="excluded from the denominator"
            />
          ) : null}
        </div>
        <Meter total={denom} segments={SEGMENTS.map((x) => ({ ...x, n: summary.counts[x.key] }))} />
      </Card>

      <div className="space-y-8">
        {[...parts.entries()].map(([partKey, part]) => (
          <section key={partKey}>
            <h2 className="mb-3 flex items-baseline gap-2 text-sm font-semibold text-ink">
              <code className="hash text-ink-3">{partKey}</code>
              {part.title}
            </h2>
            <div className="space-y-4">
              {[...part.sections.entries()].map(([secKey, sec]) => (
                <Card key={secKey}>
                  <div className="flex items-baseline gap-2 border-b border-line px-4 py-2.5">
                    <code className="hash text-xs text-ink-3">{secKey}</code>
                    <h3 className="text-sm font-medium text-ink">{sec.title}</h3>
                    <span className="tnum ml-auto text-xs text-ink-3">{sec.rows.length}</span>
                  </div>
                  <ul className="divide-y divide-line">
                    {sec.rows.map((r) => (
                      <li key={r.requirement_id} className="px-4 py-3">
                        <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                          <code className="hash mt-0.5 shrink-0 text-xs font-medium text-accent">
                            {r.requirement_key}
                          </code>
                          <p className="min-w-0 flex-1 text-sm font-medium text-ink">{r.title}</p>
                          {r.obligation !== 'required' ? (
                            <ObligationBadge obligation={r.obligation} />
                          ) : null}
                          <ReqStatusBadge status={r.status} />
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed text-ink-2">{r.text}</p>
                        <p className="mt-1.5 text-xs text-ink-3">
                          {r.mapped === 0 ? (
                            <span className="text-bad">
                              No control maps to this requirement — a gap in the programme, not
                              just unfinished work.
                            </span>
                          ) : (
                            <>
                              {r.mapped} control{r.mapped === 1 ? '' : 's'} mapped,{' '}
                              {r.implemented} implemented · evidence {ago(r.latest_evidence)}
                              {r.status === 'implemented' && !r.audit_ready ? (
                                <span className="text-warn">
                                  {' '}· implemented but not evidenced inside the window
                                </span>
                              ) : null}
                            </>
                          )}
                        </p>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
