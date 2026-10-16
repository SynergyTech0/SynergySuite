import { NextResponse } from 'next/server';
import { listTemplates, createTemplate, type Block } from '@/lib/repo';
import { blocksToHtml } from '@/lib/render';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await listTemplates());
}

export async function POST(req: Request) {
  const { name, subject, blocks, preheader } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const bl: Block[] = Array.isArray(blocks) ? blocks : [];
  const html = blocksToHtml(bl, { preheader });
  return NextResponse.json(await createTemplate(name.trim(), subject ?? '', bl, html));
}
