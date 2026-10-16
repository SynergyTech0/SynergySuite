import { NextResponse } from 'next/server';
import { q } from '@/lib/db';
import { recordEvent, setContactStatus } from '@/lib/repo';

export const dynamic = 'force-dynamic';

async function unsubscribe(cid: string, email: string | null, token: string | null) {
  let row: { id: string; email: string; audience_id: string } | undefined;
  if (token) {
    row = (await q<any>('SELECT id, email, audience_id FROM contacts WHERE token=$1 LIMIT 1', [token]))[0];
  } else if (email) {
    row = (await q<any>('SELECT id, email, audience_id FROM contacts WHERE email=$1 LIMIT 1', [email.toLowerCase()]))[0];
  }
  if (row) {
    await setContactStatus(row.id, 'unsubscribed');
    await recordEvent(cid, row.id, row.email, 'unsub', null);
  }
  return row;
}

const page = (msg: string) => new Response(
  `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<div style="font-family:system-ui;max-width:480px;margin:80px auto;text-align:center;color:#1a1a1a">
<h2>${msg}</h2><p style="color:#666">You can close this window.</p></div>`,
  { headers: { 'Content-Type': 'text/html' } });

// Browser click (from footer link)
export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const sp = new URL(req.url).searchParams;
  const row = await unsubscribe(cid, sp.get('email'), sp.get('token'));
  return page(row ? "You've been unsubscribed." : 'Subscription not found.');
}

// One-click List-Unsubscribe-Post from Gmail/Outlook
export async function POST(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const sp = new URL(req.url).searchParams;
  await unsubscribe(cid, sp.get('email'), sp.get('token'));
  return NextResponse.json({ ok: true });
}
