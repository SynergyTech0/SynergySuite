import { q, now } from './db';

export async function audit(event: string, actor: string, detail: Record<string, unknown> = {}, req?: Request) {
  const ip = req?.headers.get('x-forwarded-for') ?? '';
  await q(
    `INSERT INTO sa_audit (at_ms, actor, event, detail, ip)
     VALUES ($1::bigint, $2::text, $3::text, $4::jsonb, $5::text)`,
    [now(), actor, event, JSON.stringify(detail), ip],
  );
}
