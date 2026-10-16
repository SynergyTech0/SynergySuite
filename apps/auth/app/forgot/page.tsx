export const dynamic = 'force-dynamic';

export default async function ForgotPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <div className="center-wrap">
      <div className="card">
        <div className="brand">
          <img className="logo" src="/synergy-mark.png" alt="" width={34} height={34} />
          <h1>Reset password</h1>
        </div>
        {sp.sent ? (
          <>
            <div className="notice">
              If that address has an account, a reset link is on its way. It expires in 30 minutes.
            </div>
            <p className="footer-note"><a href="/login">Back to sign in</a></p>
          </>
        ) : (
          <>
            <p className="sub">Enter your email and we&apos;ll send you a reset link.</p>
            <form method="POST" action="/api/auth/forgot">
              <label>Email</label>
              <input name="email" type="email" autoComplete="username" autoFocus required />
              <button type="submit">Send reset link</button>
            </form>
            <p className="footer-note"><a href="/login">Back to sign in</a></p>
          </>
        )}
      </div>
    </div>
  );
}
