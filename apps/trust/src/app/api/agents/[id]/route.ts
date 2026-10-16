import { route, NotFoundError } from '@/lib/api';
import { revokeAgent, AgentError } from '@/lib/agents';
import { ValidationError } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/agents/:id — revokes the token.
 *
 * Revoke, not delete. The agent's past reports are evidence and its identity is what
 * attributes them; removing the row would orphan that attribution. A revoked agent cannot
 * authenticate, which is the part that matters.
 */
export const DELETE = route(async (session, _req, ctx) => {
  const { id } = await ctx.params;
  try {
    const name = await revokeAgent(session.tenantId, id);
    return { ok: true, revoked: name };
  } catch (err) {
    if (err instanceof AgentError) {
      throw err.code === 'not_found' ? new NotFoundError(err.message) : new ValidationError(err.message);
    }
    throw err;
  }
}, { admin: true });
