import { json, formBody } from '@/lib/http';
import { currentUser, listSessions, revokeSession } from '@/lib/session';
import { audit } from '@/lib/audit';
import { isDemoUser } from '@/lib/config';

export async function GET(req: Request) {
  const auth = await currentUser(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  // Everyone signed in to the shared demo account: show only this visitor's own session.
  const demo = isDemoUser(auth.user.email);
  const sessions = (await listSessions(auth.user.id)).filter((s) => !demo || s.sid === auth.session.sid);
  return json({
    sessions: sessions.map((s) => ({
      sid: s.sid.slice(0, 8),
      current: s.sid === auth.session.sid,
      created_ms: Number(s.created_ms),
      ip: s.ip,
      user_agent: s.user_agent,
    })),
  });
}

export async function POST(req: Request) {
  const auth = await currentUser(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  if (isDemoUser(auth.user.email)) {
    return json({ error: 'demo_account', message: "Other visitors' sessions on the demo account can't be ended." }, 403);
  }
  const body = await formBody(req);
  const prefix = body.get('sid_prefix') ?? '';
  const sessions = await listSessions(auth.user.id);
  for (const s of sessions) {
    if (s.sid.startsWith(prefix) && s.sid !== auth.session.sid) {
      await revokeSession(s.sid);
      await audit('session.revoked', auth.user.email, { sid: prefix }, req);
    }
  }
  return json({ ok: true });
}
