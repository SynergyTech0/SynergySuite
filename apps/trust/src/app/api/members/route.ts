import { route, jsonBody, requireString } from '@/lib/api';
import { addMember, listMembers, pendingInvitations, type Role } from '@/lib/auth';
import { requireAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** GET /api/members — the organisation's members and, for admins, who is still pending. */
export const GET = route(async (session) => {
  const members = await listMembers(session.tenantId);
  const canAdminister = session.role === 'owner' || session.role === 'admin';
  return {
    count: members.length,
    members,
    pending: canAdminister ? await pendingInvitations(session.tenantId) : undefined,
  };
});

/**
 * POST /api/members   { email, role }
 *
 * Adds a member by email. Someone who already uses Trust joins at once; anyone else joins
 * the next time they open Trust through the suite. No link is issued: the suite sign-in
 * already proves who they are.
 */
export const POST = route(async (session, req) => {
  requireAdmin(session);
  const body = await jsonBody(req);
  const result = await addMember({
    tenantId: session.tenantId,
    email: requireString(body, 'email'),
    role: requireString(body, 'role') as Role,
    actor: { userId: session.userId, role: session.role },
  });
  return { ok: true, ...result };
}, { admin: true });
