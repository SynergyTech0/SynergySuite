import { NextResponse } from 'next/server';
import { listContacts, upsertContact } from '@/lib/repo';
import { onContactAdded } from '@/lib/automation';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const audience = new URL(req.url).searchParams.get('audience');
  if (!audience) return NextResponse.json({ error: 'audience required' }, { status: 400 });
  return NextResponse.json(await listContacts(audience));
}

export async function POST(req: Request) {
  const body = await req.json();
  const { audience_id, email, first_name, last_name, company, fields } = body;
  if (!audience_id || !email) return NextResponse.json({ error: 'audience_id and email required' }, { status: 400 });
  const { contact, created } = await upsertContact(audience_id, { email, first_name, last_name, company, fields });
  if (created) await onContactAdded(audience_id, contact.id);
  return NextResponse.json({ contact, created });
}
