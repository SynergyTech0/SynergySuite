import Link from 'next/link';
import { pageSession } from '@/components/guard';
import { NavLink } from '@/components/ui';
import { SuiteBar } from '@/components/suite-bar';
import { UserMenu } from '@/components/user-menu';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await pageSession();

  return (
    <>
      <SuiteBar user={s.userEmail} domain={process.env.SUITE_DOMAIN} />
      <header className="sticky top-0 z-10 border-b border-line bg-surface/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-1 px-4 py-2.5 sm:px-6">
          <Link href="/" className="mr-3 flex shrink-0 items-center gap-2">
            <span
              aria-hidden
              className="grid size-6 place-items-center rounded bg-accent text-[13px] font-bold text-white"
            >
              T
            </span>
            <span className="text-sm font-semibold tracking-tight">Trust</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-0.5">
            <NavLink href="/" label="Overview" />
            <NavLink href="/controls" label="Controls" />
            <NavLink href="/monitors" label="Monitors" />
            <NavLink href="/evidence" label="Evidence" />
            <NavLink href="/audit" label="Audit log" />
          </nav>
          <div className="ml-auto pl-4">
            <UserMenu
              email={s.userEmail}
              name={s.userName}
              tenantName={s.tenantName}
              role={s.role}
              readOnly={s.readOnly}
              memberships={s.memberships}
              currentTenantId={s.tenantId}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>

      <footer className="mx-auto max-w-7xl px-4 pb-10 text-xs leading-relaxed text-ink-3 sm:px-6">
        Readiness measured against paraphrased criteria — SOC 2 and ISO 27001 text is
        copyrighted; see <code className="hash">NOTICE.md</code>. This tool measures readiness
        and does not attest to compliance: only a licensed CPA firm issues a SOC 2 report, and
        only an accredited body issues an ISO certificate.
      </footer>
    </>
  );
}
