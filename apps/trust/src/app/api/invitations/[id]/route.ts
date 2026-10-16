import { route } from '@/lib/api';
import { revokeInvitation } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** DELETE /api/invitations/:id — withdraws a pending "add member" before it is claimed. */
export const DELETE = route(async (session, _req, ctx) => {
  const { id } = await ctx.params;
  await revokeInvitation(session.tenantId, id, session.userId);
  return { ok: true };
}, { admin: true });
