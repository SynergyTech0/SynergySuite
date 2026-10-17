import { redirect } from 'next/navigation';
import { pageUser } from '@/lib/server-session';
import { decide, fetchDevices, getCompliance } from '@/lib/device-access';

export const dynamic = 'force-dynamic';

const PLATFORM: Record<string, string> = {
  windows: 'Windows', darwin: 'Mac', linux: 'Linux', ios: 'iPhone or iPad', android: 'Android',
};

/* Where sign-in lands when a device of the person's doesn't meet the compliance policies. */
export default async function DeviceBlockedPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const raw = sp.return_to ?? '';
  const returnTo = raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\') ? raw : '/account';
  const auth = await pageUser();
  if (!auth) redirect(`/login?return_to=${encodeURIComponent(returnTo)}`);

  const result = decide(await getCompliance(), auth.user.email, await fetchDevices(auth.user.email));
  const devices = 'devices' in result ? result.devices : [];

  return (
    <div className="center-wrap">
      <div className="card" style={{ maxWidth: 520 }}>
        <div className="brand">
          <img className="logo" src="/synergy-mark.png" alt="" width={34} height={34} />
          <h1>{result.allowed ? 'You can sign in now' : 'A device needs attention'}</h1>
        </div>
        {result.allowed ? (
          <p className="sub">Your devices meet your organization&apos;s policies.</p>
        ) : result.reason === 'no_device' ? (
          <p className="sub">
            Your organization only allows sign-in from devices it manages, and none is set up for{' '}
            {auth.user.email}. Ask your administrator to help you enroll a device.
          </p>
        ) : (
          <>
            <p className="sub">
              Signing in as {auth.user.email} is paused until these devices meet your organization&apos;s
              policies. Fix the settings below on each device. It reports back on its own, usually
              within an hour, or sooner if you restart it.
            </p>
            {devices.map((d) => (
              <div key={d.id} className="panel" style={{ padding: 16, marginBottom: 12 }}>
                <h2 style={{ marginBottom: 6 }}>{d.name}</h2>
                <div className="sub" style={{ marginBottom: 8 }}>
                  {PLATFORM[d.platform] ?? d.platform} · last checked in {new Date(d.last_seen).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                </div>
                <ul style={{ paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                  {d.failing.map((f, i) => (
                    <li key={i}><strong>{f.label}</strong>{f.detail ? `: ${f.detail}` : ''}</li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
        <a className="btn" href={returnTo} style={{ display: 'block', textAlign: 'center' }}>
          {result.allowed ? 'Continue' : 'Try again'}
        </a>
        <p className="footer-note"><a href="/api/oidc/logout">Sign out</a></p>
      </div>
    </div>
  );
}
