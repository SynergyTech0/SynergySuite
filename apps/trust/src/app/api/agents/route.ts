import { route, jsonBody, requireString } from '@/lib/api';
import { listAgents, createAgent } from '@/lib/agents';
import { requestContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** GET /api/agents — enrolled agents, when each last reported, and how many monitors it owns. */
export const GET = route(async (session) => {
  const agents = await listAgents(session.tenantId, session.readOnly);
  return { count: agents.length, agents };
});

/**
 * POST /api/agents   { name, host_label }
 *
 * Returns the token ONCE. Only its hash is stored, so a lost token means enrolling a new
 * agent rather than recovering this one.
 */
export const POST = route(async (session, req) => {
  const body = await jsonBody(req);
  const name = requireString(body, 'name');
  const hostLabel = requireString(body, 'host_label');

  const { id, token } = await createAgent({
    tenantId: session.tenantId,
    name,
    hostLabel,
    createdBy: session.userId,
  });

  const { host } = await requestContext();
  return {
    ok: true,
    agent: { id, name, host_label: hostLabel },
    token,
    install: {
      server: host ? `https://${host}` : '<server-url>',
      hint: 'Set STRUST_SERVER and STRUST_AGENT_TOKEN on the host, then run the agent on a timer.',
    },
  };
}, { admin: true });
