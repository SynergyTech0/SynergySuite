import { NextResponse } from 'next/server';
import { getContactByToken, recordEvent } from '@/lib/repo';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ cid: string; token: string }> }) {
  const { cid, token } = await params;
  const dest = new URL(req.url).searchParams.get('u');
  let target = 'about:blank';
  try {
    if (dest) target = decodeURIComponent(dest);
  } catch { /* keep fallback */ }
  // only allow http(s) redirects
  if (!/^https?:\/\//i.test(target)) target = 'about:blank';
  try {
    const c = await getContactByToken(token);
    if (c) await recordEvent(cid, c.id, c.email, 'click', target);
  } catch { /* never break the redirect */ }
  if (target === 'about:blank') return NextResponse.json({ error: 'invalid link' }, { status: 400 });
  return NextResponse.redirect(target, 302);
}
