import { NextResponse } from 'next/server';
import { authenticateAgent, assignmentsFor, recordAgentVersion, AgentError } from '@/lib/agents';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agent/assignments
 * Authorization: Bearer <agent token>
 *
 * What this agent should measure. The agent does not choose — it asks. That is the whole
 * trust boundary: a token on a customer machine authenticates a submitter of observations,
 * never an author of what gets observed.
 */
export async function GET(req: Request) {
  try {
    const agent = await authenticateAgent(req.headers.get('authorization'));
    await recordAgentVersion(agent.agentId, req.headers.get('x-agent-version'));
    const assignments = await assignmentsFor(agent);
    return NextResponse.json(
      { agent: { name: agent.name, host: agent.hostLabel }, count: assignments.length, assignments },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    if (err instanceof AgentError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error('[agent/assignments]', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
