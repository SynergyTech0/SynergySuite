import { NextResponse } from 'next/server';
import { listCampaigns, createCampaign, getTemplate } from '@/lib/repo';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await listCampaigns());
}

export async function POST(req: Request) {
  const { name, audience_id, template_id } = await req.json();
  if (!name?.trim() || !audience_id || !template_id)
    return NextResponse.json({ error: 'name, audience_id, template_id required' }, { status: 400 });
  const tpl = await getTemplate(template_id);
  if (!tpl) return NextResponse.json({ error: 'template not found' }, { status: 404 });
  const camp = await createCampaign(
    name.trim(), audience_id, template_id, tpl.subject ?? '', tpl.html ?? '');
  return NextResponse.json(camp);
}
