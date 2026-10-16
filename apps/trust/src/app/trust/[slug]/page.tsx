import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { publicTrustCenter } from '@/lib/trust-center';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tc = await publicTrustCenter(slug);
  if (!tc) return { title: 'Not found' };
  return {
    title: `${tc.organisation} — Trust Centre`,
    description: tc.headline ?? `Security and compliance posture for ${tc.organisation}.`,
  };
}

/**
 * Public, unauthenticated. Everything here is aggregate and opt-in — see lib/trust-center.ts
 * for what is deliberately never published and why.
 */
export default async function TrustCenterPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tc = await publicTrustCenter(slug);
  if (!tc) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <header className="border-b border-line pb-6">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Trust Centre
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
          {tc.organisation}
        </h1>
        {tc.headline ? <p className="mt-2 text-base text-ink-2">{tc.headline}</p> : null}
        {tc.intro ? (
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-2">{tc.intro}</p>
        ) : null}
      </header>

      {tc.frameworks.length ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-ink">Frameworks</h2>
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {tc.frameworks.map((f) => (
              <li key={f.name} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                <span className="text-sm font-medium text-ink">{f.name}</span>
                <span className="text-xs text-ink-2">
                  {f.status}
                  {f.targetDate ? ` · target ${f.targetDate}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tc.controlSummary ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-ink">Controls</h2>
          <div className="mt-3 rounded-lg border border-line px-4 py-4">
            <p className="tnum text-2xl font-semibold text-ink">
              {tc.controlSummary.implemented}
              <span className="text-base font-normal text-ink-3"> of {tc.controlSummary.total}</span>
            </p>
            <p className="mt-1 text-xs text-ink-3">
              controls implemented. Individual control status is not published — a public list
              of what is not yet in place would be a map for an attacker. Specifics are shared
              under NDA with prospective customers.
            </p>
          </div>
        </section>
      ) : null}

      {tc.policies.length ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-ink">Policies in force</h2>
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {tc.policies.map((p) => (
              <li key={p.title} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                <span className="text-sm text-ink">{p.title}</span>
                {p.approvedAt ? (
                  <span className="tnum text-xs text-ink-3">
                    approved {new Date(p.approvedAt).toISOString().slice(0, 10)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tc.subprocessors.length ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-ink">Subprocessors</h2>
          <p className="mt-1 text-xs text-ink-3">
            Third parties that may process personal data on our behalf (GDPR Art. 28).
          </p>
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {tc.subprocessors.map((v) => (
              <li key={v.name} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                <span className="text-sm text-ink">{v.name}</span>
                <span className="text-xs text-ink-3">
                  {v.category ?? 'service'}
                  {v.processesPersonalData ? ' · processes personal data' : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tc.securityContact ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-ink">Reporting a security issue</h2>
          <p className="mt-2 text-sm text-ink-2">
            Contact{' '}
            <a href={`mailto:${tc.securityContact}`} className="text-accent hover:underline">
              {tc.securityContact}
            </a>
            .
          </p>
        </section>
      ) : null}

      <footer className="mt-10 border-t border-line pt-5 text-xs leading-relaxed text-ink-3">
        <p>
          <strong className="text-ink-2">This page reports readiness, not attestation.</strong>{' '}
          A SOC 2 report is issued only by a licensed CPA firm, and an ISO 27001 certificate
          only by an accredited certification body. Nothing here is either. Where a framework
          shows a report as issued, ask for the report.
        </p>
        <p className="mt-2">
          Last updated {new Date(tc.updatedAt).toISOString().slice(0, 10)}. Published with
          Synergy Trust.
        </p>
      </footer>
    </div>
  );
}
