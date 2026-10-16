import { NextResponse } from 'next/server';
import { listAudiences, createAudience } from '@/lib/repo';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await listAudiences());
}

export async function POST(req: Request) {
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });
  return NextResponse.json(await createAudience(name.trim()));
}
