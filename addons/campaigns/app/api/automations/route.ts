import { NextResponse } from 'next/server';
import { listAutomations, createAutomation } from '@/lib/repo';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await listAutomations());
}

export async function POST(req: Request) {
  const { name, trigger, audience_id, template_id, delay_min } = await req.json();
  if (!name?.trim() || !audience_id || !template_id)
    return NextResponse.json({ error: 'name, audience_id, template_id required' }, { status: 400 });
  return NextResponse.json(await createAutomation(
    name.trim(), trigger || 'contact_added', audience_id, template_id, Number(delay_min ?? 0)));
}
