import { json } from '@/lib/http';
import { currentUser } from '@/lib/session';
import { q } from '@/lib/db';

type AuditRow = { id: string; at_ms: string | number; actor: string; event: string; detail: unknown; ip: string };

export async function GET(req: Request) {
  const auth = await currentUser(req);
  if (!auth || auth.user.role !== 'admin') return json({ error: 'forbidden' }, 403);
  const rows = await q<AuditRow>(`SELECT * FROM sa_audit ORDER BY id DESC LIMIT $1`, [200]);
  return json({
    events: rows.map((r) => ({
      at_ms: Number(r.at_ms), actor: r.actor, event: r.event, detail: r.detail, ip: r.ip,
    })),
  });
}
