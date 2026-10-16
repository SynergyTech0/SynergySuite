import Link from 'next/link';
import { notFound } from 'next/navigation';
import { controlDetail } from '@/lib/queries';
import { pageSession } from '@/components/guard';
import { ControlEditor } from '@/components/control-editor';
import {
  Card, CardHead, ControlStatusBadge, CoverageBadge, Empty, FrameworkTag, ObligationBadge,
  PageHead, RunStatusBadge, ago, when,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ControlPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const s = await pageSession();

  const detail = await controlDetail(s, key);
  if (!detail) notFound();
  const { control, mappings, evidence, monitors } = detail;

  const byFramework = new Map<string, typeof mappings>();
  for (const m of mappings) {
    byFramework.set(m.framework_key, [...(byFramework.get(m.framework_key) ?? []), m]);
  }

  return (
    <>
      <PageHead
        eyebrow={control.category ?? 'Control'}
        title={control.title}
        sub={control.objective}
        right={
          <div className="flex items-center gap-3">
            <ControlStatusBadge status={control.status} />
            <Link href="/controls" className="text-xs font-medium text-accent hover:underline">
              All controls
            </Link>
          </div>
        }
      />

      <p className="mb-6 -mt-3">
        <code className="hash text-xs text-ink-3">{control.key}</code>
      </p>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {control.guidance ? (
            <Card>
              <CardHead title="Implementation guidance" />
              <p className="px-4 py-3 text-sm leading-relaxed text-ink-2">{control.guidance}</p>
            </Card>
          ) : null}

          <Card>
            <CardHead
              title="What this control satisfies"
              sub={`${mappings.length} requirements across ${byFramework.size} framework${byFramework.size === 1 ? '' : 's'}`}
            />
            {mappings.length === 0 ? (
              <Empty>
                Not mapped to any requirement. An unmapped control costs effort without moving
                any readiness figure — either map it or retire it.
              </Empty>
            ) : (
              <div className="divide-y divide-line">
                {[...byFramework.entries()].map(([fw, items]) => (
                  <div key={fw} className="px-4 py-3">
                    <div className="mb-2 flex items-center gap-2">
                      <FrameworkTag k={fw} />
                      <span className="text-xs text-ink-3">
                        {items.length} requirement{items.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <ul className="space-y-2.5">
                      {items.map((m) => (
                        <li key={`${fw}-${m.requirement_key}`}>
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <code className="hash shrink-0 text-xs font-medium text-accent">
                              {m.requirement_key}
                            </code>
                            <span className="min-w-0 flex-1 text-sm text-ink">
                              {m.requirement_title}
                            </span>
                            {m.obligation !== 'required' ? (
                              <ObligationBadge obligation={m.obligation} />
                            ) : null}
                            <CoverageBadge coverage={m.coverage} />
                          </div>
                          {m.rationale ? (
                            <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
                              {m.rationale}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHead
              title="Evidence"
              sub="Append-only. A correction inserts a superseding row; nothing is ever rewritten."
            />
            {evidence.length === 0 ? (
              <Empty>
                No evidence. However this control is actually operating, an auditor cannot test
                it from this record.
              </Empty>
            ) : (
              <ul className="divide-y divide-line">
                {evidence.map((e) => (
                  <li key={e.id} className="px-4 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm text-ink">{e.title}</p>
                      <p className="text-xs text-ink-3">{when(e.collected_at)}</p>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-3">
                      {e.kind}
                      {e.collector ? ` · ${e.collector}@${e.collector_version}` : ''}
                    </p>
                    <p className="hash mt-0.5 text-[11px] text-ink-3">
                      sha256 {e.content_hash}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHead title="Update" />
            <div className="px-4 py-3">
              <ControlEditor
                controlKey={control.key}
                status={control.status}
                naRationale={control.na_rationale}
                notes={control.notes}
              />
            </div>
          </Card>

          <Card>
            <CardHead title="Monitors" sub="Automated evidence for this control" />
            {monitors.length === 0 ? (
              <Empty>
                No monitor. Evidence for this control has to be gathered by hand every period.
              </Empty>
            ) : (
              <ul className="divide-y divide-line">
                {monitors.map((m) => (
                  <li key={m.id} className="px-4 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 text-sm text-ink">{m.title}</p>
                      <RunStatusBadge status={m.last_status} />
                    </div>
                    <p className="mt-0.5 text-xs text-ink-3">
                      {m.kind} · {m.severity} · {ago(m.last_run)}
                    </p>
                    {m.last_message ? (
                      <p className="mt-1 text-xs text-ink-2">{m.last_message}</p>
                    ) : null}
                    <Link
                      href={`/monitors/${m.key}`}
                      className="mt-1 inline-block text-xs font-medium text-accent hover:underline"
                    >
                      Run history →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {control.na_rationale ? (
            <Card>
              <CardHead title="Not-applicable rationale" />
              <p className="px-4 py-3 text-sm leading-relaxed text-ink-2">
                {control.na_rationale}
              </p>
            </Card>
          ) : null}

          {control.notes ? (
            <Card>
              <CardHead title="Implementation notes" />
              <p className="whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed text-ink-2">
                {control.notes}
              </p>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
