import { NextResponse } from 'next/server';
import { setContactStatus } from '@/lib/repo';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const { id, status } = await req.json();
  if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 });
  await setContactStatus(id, status);
  return NextResponse.json({ ok: true });
}
