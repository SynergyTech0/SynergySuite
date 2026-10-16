import { NextResponse } from 'next/server';
import { upsertContact } from '@/lib/repo';
import { onContactAdded } from '@/lib/automation';

export const dynamic = 'force-dynamic';

// Minimal RFC-4180-ish CSV parser (handles quotes, commas, newlines in quotes).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\r') { /* skip */ }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const KNOWN = new Set(['email', 'first_name', 'last_name', 'company']);

export async function POST(req: Request) {
  const { audience_id, csv } = await req.json();
  if (!audience_id || !csv) return NextResponse.json({ error: 'audience_id and csv required' }, { status: 400 });

  const rows = parseCsv(csv);
  if (rows.length < 2) return NextResponse.json({ error: 'need a header row + at least one data row' }, { status: 400 });
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const emailIdx = header.indexOf('email');
  if (emailIdx === -1) return NextResponse.json({ error: "CSV must have an 'email' column" }, { status: 400 });

  let created = 0, updated = 0, skipped = 0;
  for (const r of rows.slice(1)) {
    const email = (r[emailIdx] ?? '').trim();
    if (!EMAIL_RE.test(email)) { skipped++; continue; }
    const rec: any = { email, fields: {} as Record<string, string> };
    header.forEach((h, i) => {
      const v = (r[i] ?? '').trim();
      if (h === 'email') return;
      if (KNOWN.has(h)) rec[h] = v;
      else if (v) rec.fields[h] = v;
    });
    const { contact, created: isNew } = await upsertContact(audience_id, rec);
    if (isNew) { created++; await onContactAdded(audience_id, contact.id); } else updated++;
  }
  return NextResponse.json({ created, updated, skipped });
}
