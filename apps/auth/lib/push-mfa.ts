import { randomBytes, randomInt } from 'crypto';
import { q, now } from './db';
import { audit } from './audit';
import { completeMfa, type Session } from './session';
import type { User } from './users';

/*
 * "Approve on your phone": a second factor through Shane's Pager (synergy-pager). The Pager's
 * phone app shows three numbers, only the one shown here plus a passkey approves, a wrong pick
 * denies. This server makes the number, opens the approval and asks the Pager how it ended.
 * The browser only ever asks "how did my approval go?" for its own pending session, and the
 * answer comes from the Pager, so a client can't approve itself or borrow another session's.
 *
 * Config (env only):
 *   SA_PUSH_MFA_USERS  comma-separated emails offered the push (others never see it)
 *   SA_PAGER_URL       default https://alerts.synergytech.cloud
 *   SA_PAGER_TOKEN     the Pager source token. Secret: sent only as the bearer, never logged.
 * Without a token nobody is offered the push. A Pager error never signs anyone in: the
 * person is told and uses a code instead.
 */

const TTL_S = 120;
const GRACE_MS = 15_000; // the Pager's clock and ours, plus the trip there and back
const RATE_WINDOW_MS = 15 * 60 * 1000;
const PER_USER = 5; // approvals sent to one person's phone per window (push-fatigue)
const PER_IP = 10;
const START_TIMEOUT_MS = 5_000;
const MAX_WAIT_S = 25;

// The app compiles without strictNullChecks, so these are flat shapes rather than unions.
export type PushStart = {
  ok: boolean;
  number?: number;
  expires_in?: number;
  error?: 'not_enabled' | 'rate_limited' | 'unavailable';
};

export type PushCheck = {
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'none' | 'unavailable';
  sid?: string; // the new, signed-in session, only with approved
};

type Row = {
  id: string; sid: string; user_id: string; approval_id: string | null; match_num: string;
  status: string; created_ms: string; expires_ms: string;
};

function pagerUrl(): string {
  return (process.env.SA_PAGER_URL || 'https://alerts.synergytech.cloud').replace(/\/+$/, '');
}

function pagerToken(): string {
  return process.env.SA_PAGER_TOKEN ?? '';
}

export function pushUsers(): Set<string> {
  return new Set((process.env.SA_PUSH_MFA_USERS ?? '').split(',').map((e) => e.toLowerCase().trim()).filter(Boolean));
}

export function pushEnabledFor(email: string | null | undefined): boolean {
  if (!pagerToken()) return false;
  return pushUsers().has((email ?? '').toLowerCase().trim());
}

export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
}

function browserOf(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'A browser';
}

function osOf(ua: string): string {
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'an unknown system';
}

/** "<browser> on <OS> · <IP> · <time>", what the phone shows under the title. */
export function summaryFor(req: Request, at = new Date()): string {
  const ua = req.headers.get('user-agent') ?? '';
  const ip = clientIp(req) || 'unknown IP';
  return `${browserOf(ua)} on ${osOf(ua)} · ${ip} · ${at.toISOString().slice(11, 16)} UTC`;
}

async function liveRow(sid: string): Promise<Row | null> {
  const rows = await q<Row>(
    `SELECT * FROM sa_push_approvals WHERE sid = $1::text AND status = 'pending' AND expires_ms > $2::bigint ORDER BY id DESC LIMIT 1`,
    [sid, now()],
  );
  return rows[0] ?? null;
}

async function recentCount(column: 'user_id' | 'ip', value: string): Promise<number> {
  const cast = column === 'user_id' ? 'bigint' : 'text';
  const rows = await q<{ id: string }>(
    `SELECT id FROM sa_push_approvals WHERE ${column} = $1::${cast} AND created_ms > $2::bigint LIMIT 100`,
    [value, now() - RATE_WINDOW_MS],
  );
  return rows.length;
}

async function setStatus(id: string, status: string, from = 'pending'): Promise<boolean> {
  const rows = await q<{ id: string }>(
    `UPDATE sa_push_approvals SET status = $2::text WHERE id = $1::bigint AND status = $3::text RETURNING id`,
    [id, status, from],
  );
  return rows.length > 0;
}

/* Two clicks (or React's double mount) at once still send one approval per pending session. */
const inFlight = new Map<string, Promise<PushStart>>();

export function startPush(req: Request, user: User, session: Session): Promise<PushStart> {
  const running = inFlight.get(session.sid);
  if (running) return running;
  const p = doStart(req, user, session).finally(() => inFlight.delete(session.sid));
  inFlight.set(session.sid, p);
  return p;
}

async function doStart(req: Request, user: User, session: Session): Promise<PushStart> {
  if (!pushEnabledFor(user.email)) return { ok: false, error: 'not_enabled' };

  const live = await liveRow(session.sid);
  if (live) {
    return { ok: true, number: Number(live.match_num), expires_in: Math.max(0, Math.round((Number(live.expires_ms) - GRACE_MS - now()) / 1000)) };
  }

  const ip = clientIp(req);
  if ((await recentCount('user_id', user.id)) >= PER_USER || (ip && (await recentCount('ip', ip)) >= PER_IP)) {
    await audit('mfa.push_rate_limited', user.email, {}, req);
    return { ok: false, error: 'rate_limited' };
  }

  const number = randomInt(10, 100);
  const created = now();
  const rows = await q<{ id: string }>(
    `INSERT INTO sa_push_approvals (sid, user_id, match_num, status, ip, created_ms, expires_ms)
     VALUES ($1::text, $2::bigint, $3::bigint, 'failed', $4::text, $5::bigint, $6::bigint) RETURNING id`,
    [session.sid, user.id, number, ip, created, created + TTL_S * 1000 + GRACE_MS],
  );
  const rowId = rows[0].id;

  let approvalId: number | null = null;
  let reason = '';
  try {
    const res = await fetch(`${pagerUrl()}/v1/approvals`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pagerToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: `signin-${randomBytes(16).toString('hex')}`,
        title: 'Sign-in to Synergy',
        summary: summaryFor(req, new Date(created)),
        risk: 'high',
        ttl_seconds: TTL_S,
        match: number,
      }),
      signal: AbortSignal.timeout(START_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { id?: unknown; status?: unknown; new?: unknown } | null;
    if (!res.ok) reason = `http_${res.status}`;
    else if (!body || !Number.isSafeInteger(body.id) || body.status !== 'pending' || body.new === false) reason = 'bad_answer';
    else approvalId = body.id as number;
  } catch (e) {
    reason = e instanceof Error ? e.name : 'error'; // never the message: keep URLs and headers out of the log
  }

  if (approvalId === null) {
    await audit('mfa.push_unavailable', user.email, { stage: 'create', reason }, req);
    return { ok: false, error: 'unavailable' };
  }
  await q(`UPDATE sa_push_approvals SET approval_id = $2::bigint, status = 'pending' WHERE id = $1::bigint`, [rowId, approvalId]);
  await audit('mfa.push_sent', user.email, { approval_id: approvalId }, req);
  return { ok: true, number, expires_in: TTL_S };
}

/*
 * How the approval bound to THIS pending session went, asking the Pager (long-polling up to
 * `wait` seconds). Only the Pager saying "approved" for that very approval id completes MFA,
 * once, with the same sid rotation as a code.
 */
export async function checkPush(req: Request, user: User, session: Session, wait = 0): Promise<PushCheck> {
  if (!pushEnabledFor(user.email)) return { status: 'none' };
  const row = await liveRow(session.sid);
  if (!row) {
    // Ours ran out without a decision.
    const stale = await q<Row>(
      `SELECT * FROM sa_push_approvals WHERE sid = $1::text AND status = 'pending' ORDER BY id DESC LIMIT 1`,
      [session.sid],
    );
    if (stale[0] && (await setStatus(stale[0].id, 'expired'))) {
      await audit('mfa.push_expired', user.email, { approval_id: Number(stale[0].approval_id) }, req);
      return { status: 'expired' };
    }
    return { status: 'none' };
  }

  const approvalId = Number(row.approval_id);
  const remaining = Math.floor((Number(row.expires_ms) - now()) / 1000);
  const w = Math.max(0, Math.min(MAX_WAIT_S, Math.floor(wait) || 0, remaining));
  let status = '';
  let reason = '';
  try {
    const res = await fetch(`${pagerUrl()}/v1/approvals/${approvalId}/status?wait=${w}`, {
      headers: { Authorization: `Bearer ${pagerToken()}` },
      signal: AbortSignal.timeout(w * 1000 + START_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { id?: unknown; status?: unknown } | null;
    if (!res.ok) reason = `http_${res.status}`;
    else if (!body || Number(body.id) !== approvalId || typeof body.status !== 'string') reason = 'bad_answer';
    else status = body.status;
  } catch (e) {
    reason = e instanceof Error ? e.name : 'error';
  }

  if (reason || !['pending', 'approved', 'denied', 'expired'].includes(status)) {
    await audit('mfa.push_unavailable', user.email, { stage: 'status', approval_id: approvalId, reason: reason || 'unknown_status' }, req);
    return { status: 'unavailable' };
  }
  if (status === 'pending') return { status: 'pending' };

  if (status === 'denied' || status === 'expired') {
    if (await setStatus(row.id, status)) await audit(`mfa.push_${status}`, user.email, { approval_id: approvalId }, req);
    return { status };
  }

  // approved: claim it once, then retire the pending sid for a signed-in one.
  if (Number(row.expires_ms) <= now() || !(await setStatus(row.id, 'approved'))) return { status: 'none' };
  const sid = await completeMfa(session.sid, user.id, req);
  if (!sid) return { status: 'none' };
  await audit('mfa.ok', user.email, { method: 'push', approval_id: approvalId }, req);
  return { status: 'approved', sid };
}
