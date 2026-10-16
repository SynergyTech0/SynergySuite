import { randomBytes } from 'crypto';
import { redirect, formBody } from '@/lib/http';
import { q, now } from '@/lib/db';
import { findByEmail, b } from '@/lib/users';
import { sha256hex } from '@/lib/oauth';
import { sendMail } from '@/lib/mail';
import { issuer } from '@/lib/keys';
import { audit } from '@/lib/audit';
import { isDemoUser } from '@/lib/config';

const RESET_TTL_MS = 30 * 60 * 1000;

/* Always lands on the same confirmation page regardless of whether the email
 * exists (no account enumeration). */
export async function POST(req: Request) {
  const body = await formBody(req);
  const email = (body.get('email') ?? '').toLowerCase().trim();

  const user = await findByEmail(email);
  if (user && isDemoUser(user.email)) {
    await audit('password.reset_refused_demo', email, {}, req);
  } else if (user && !b(user.disabled)) {
    const token = randomBytes(32).toString('base64url');
    await q(
      `INSERT INTO sa_reset_tokens (token_hash, user_id, expires_ms, created_ms)
       VALUES ($1::text, $2::bigint, $3::bigint, $4::bigint)`,
      [sha256hex(token), user.id, now() + RESET_TTL_MS, now()],
    );
    const link = `${issuer()}/reset?token=${token}`;
    const r = await sendMail(
      email,
      'Reset your SynergyAuth password',
      `A password reset was requested for your account.\n\nReset link (valid 30 minutes):\n${link}\n\nIf you did not request this, ignore this email.`,
    );
    await audit('password.reset_requested', email, { delivered: r.delivered }, req);
  } else {
    await audit('password.reset_requested_unknown', email, {}, req);
  }
  return redirect('/forgot?sent=1');
}
