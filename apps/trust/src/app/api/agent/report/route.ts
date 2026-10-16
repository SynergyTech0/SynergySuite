import { NextResponse } from 'next/server';
import { authenticateAgent, ingestAgentResults, recordAgentVersion, AgentError } from '@/lib/agents';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agent/report   { results: [{ monitor, status, message, observed, content_hash? }] }
 * Authorization: Bearer <agent token>
 *
 * Returns 200 with an accepted/rejected breakdown even when some results are refused: a
 * rejection is information the agent operator needs, and failing the whole request would
 * discard the results that WERE valid.
 */
export async function POST(req: Request) {
  try {
    const agent = await authenticateAgent(req.headers.get('authorization'));
    await recordAgentVersion(agent.agentId, req.headers.get('x-agent-version'));

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.results)) {
      return NextResponse.json({ error: 'body must be { results: [...] }' }, { status: 400 });
    }
    if (body.results.length > 200) {
      return NextResponse.json({ error: 'too many results in one report (max 200)' }, { status: 400 });
    }

    const { accepted, rejected } = await ingestAgentResults(agent, body.results);
    return NextResponse.json(
      { accepted: accepted.length, rejected, monitors: accepted },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    if (err instanceof AgentError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error('[agent/report]', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
