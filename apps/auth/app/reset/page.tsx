export const dynamic = 'force-dynamic';

export default async function ResetPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const token = sp.token ?? '';

  return (
    <div className="center-wrap">
      <div className="card">
        <div className="brand">
          <img className="logo" src="/synergy-mark.png" alt="" width={34} height={34} />
          <h1>Choose a new password</h1>
        </div>
        {sp.error === 'expired' && (
          <>
            <div className="error">This reset link is invalid or has expired.</div>
            <p className="footer-note"><a href="/forgot">Request a new link</a></p>
          </>
        )}
        {sp.error === 'policy' && <div className="error">Password must be 12+ characters with a letter and a digit.</div>}
        {token && sp.error !== 'expired' && (
          <form method="POST" action="/api/auth/reset">
            <input type="hidden" name="token" value={token} />
            <label>New password (12+ chars, letter + digit)</label>
            <input name="password" type="password" autoComplete="new-password" autoFocus required />
            <button type="submit">Set password</button>
          </form>
        )}
        {!token && sp.error !== 'expired' && (
          <div className="error">Missing reset token — use the link from your email.</div>
        )}
      </div>
    </div>
  );
}
