import { NextResponse } from 'next/server';
import { getTemplate, updateTemplate, type Block } from '@/lib/repo';
import { blocksToHtml } from '@/lib/render';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTemplate(id);
  if (!t) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(t);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { name, subject, blocks, preheader } = await req.json();
  const bl: Block[] = Array.isArray(blocks) ? blocks : [];
  const html = blocksToHtml(bl, { preheader });
  await updateTemplate(id, name ?? '', subject ?? '', bl, html);
  return NextResponse.json({ ok: true, html });
}
