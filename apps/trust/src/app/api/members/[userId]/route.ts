import { route, jsonBody, requireString } from '@/lib/api';
import { setMemberRole, removeMember, type Role } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** PATCH /api/members/:userId   { role } */
export const PATCH = route(async (session, req, ctx) => {
  const { userId } = await ctx.params;
  const role = requireString(await jsonBody(req), 'role') as Role;
  // Demoting the last owner is refused in auth.ts: a tenant with no owner cannot be
  // administered by anyone afterwards.
  const updated = await setMemberRole(session.tenantId, userId, role, {
    userId: session.userId,
    role: session.role,
  });
  return { ok: true, role: updated };
}, { admin: true });

/** DELETE /api/members/:userId — access ends on that person's next request. */
export const DELETE = route(async (session, _req, ctx) => {
  const { userId } = await ctx.params;
  await removeMember(session.tenantId, userId, { userId: session.userId, role: session.role });
  return { ok: true };
}, { admin: true });
