import PasskeyButton from './passkey-button';
import { DEMO_MODE, DEMO_EMAIL, DEMO_PASSWORD, DEMO_RESET_MINUTES } from '@/lib/config';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'Invalid email or password.',
  locked: 'Account temporarily locked after too many failed attempts. Try again in 15 minutes.',
  disabled: 'This account has been disabled. Contact your administrator.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const returnTo = sp.return_to ?? '/account';
  const error = sp.error ? (ERRORS[sp.error] ?? 'Sign-in failed.') : null;

  return (
    <div className="center-wrap">
      <div className="card">
        <div className="brand brand-lockup">
          <img src="/synergy-logo-on-dark.png" alt="Synergy Technologies" width={240} height={53} />
          <h1>Sign in to Synergy</h1>
        </div>
        {sp.logged_out && <div className="notice">You have been signed out.</div>}
        {sp.reset && <div className="notice">Password updated — sign in with your new password.</div>}
        {error && <div className="error">{error}</div>}
        {DEMO_MODE && (
          <div className="notice">
            <strong>This is a public demo.</strong> Sign in with the shared demo account:
            <br />Email: <code className="k">{DEMO_EMAIL}</code>
            <br />Password: <code className="k">{DEMO_PASSWORD}</code>
            <br />Everything resets to the sample content every{' '}
            {DEMO_RESET_MINUTES === 60 ? 'hour' : `${DEMO_RESET_MINUTES} minutes`}, and no email leaves the server.
          </div>
        )}
        <form method="POST" action="/api/auth/login">
          <input type="hidden" name="return_to" value={returnTo} />
          <label>Email</label>
          <input name="email" type="email" autoComplete="username" autoFocus required
            defaultValue={DEMO_MODE ? DEMO_EMAIL : undefined} />
          <label>Password</label>
          <input name="password" type="password" autoComplete="current-password" required
            defaultValue={DEMO_MODE ? DEMO_PASSWORD : undefined} />
          <button type="submit" className="primary-brand">Sign in</button>
        </form>
        <PasskeyButton returnTo={returnTo} />
        <p className="footer-note">
          <a href="/forgot">Forgot password?</a>
        </p>
        <p className="footer-note">Single sign-on for the Synergy platform</p>
      </div>
    </div>
  );
}
