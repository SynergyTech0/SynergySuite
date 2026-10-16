import { NextResponse } from 'next/server';
import { getCampaign, campaignStats, recentEvents } from '@/lib/repo';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const camp = await getCampaign(id);
  if (!camp) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const stats = await campaignStats(id);
  const events = await recentEvents(id);
  return NextResponse.json({ campaign: camp, stats, events });
}
