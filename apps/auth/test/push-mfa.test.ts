import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

/*
 * "Approve on your phone" against a real Postgres (TEST_DATABASE_URL, skipped without it) and a
 * stub Pager on localhost, never the real one. Requests go through the real route handlers:
 * password sign-in, then the push start/check, then the session the browser ends up with.
 */
const setEnv = (k: string, v: string) => { process.env[k] = v; };
const url = process.env.TEST_DATABASE_URL;
if (url) setEnv('DATABASE_URL', url);
setEnv('SA_ENCRYPTION_KEY', randomBytes(32).toString('hex'));
// Both made fresh each run, so a leak anywhere is a match on a value nobody else has.
const stubBearer = `pgr_test_${randomBytes(12).toString('hex')}`;
const userPw = `Test-${randomBytes(6).toString('hex')}-9x`;
const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/* --- the stub Pager --- */
type Approval = { id: number; status: string; body: Record<string, unknown> };
const pager = {
  approvals: new Map<number, Approval>(),
  creates: [] as { auth: string | undefined; body: Record<string, unknown> }[],
  polls: [] as { auth: string | undefined; path: string }[],
  mode: 'ok' as 'ok' | 'create_503' | 'status_500' | 'weird_status' | 'wrong_id',
  nextId: 1000,
};
let server: Server;
let pagerBase = '';

function startPager(): Promise<void> {
  server = createServer((rq, rs) => {
    let raw = '';
    rq.on('data', (c) => (raw += c));
    rq.on('end', () => {
      const send = (code: number, o: unknown) => { rs.writeHead(code, { 'content-type': 'application/json' }); rs.end(JSON.stringify(o)); };
      if (rq.headers.authorization !== `Bearer ${stubBearer}`) return send(401, { error: 'unauthorized' });
      if (rq.method === 'POST' && rq.url === '/v1/approvals') {
        const body = JSON.parse(raw || '{}');
        pager.creates.push({ auth: rq.headers.authorization, body });
        if (pager.mode === 'create_503') return send(503, { error: 'down' });
        const id = pager.nextId++;
        pager.approvals.set(id, { id, status: 'pending', body });
        return send(200, { id, status: 'pending', new: true });
      }
      const m = rq.url?.match(/^\/v1\/approvals\/(\d+)\/status\?wait=(\d+)$/);
      if (rq.method === 'GET' && m) {
        pager.polls.push({ auth: rq.headers.authorization, path: rq.url! });
        if (pager.mode === 'status_500') return send(500, { error: 'boom' });
        const a = pager.approvals.get(Number(m[1]));
        if (!a) return send(404, { error: 'not_found' });
        if (pager.mode === 'weird_status') return send(200, { id: a.id, status: 'maybe', decided_at: null });
        if (pager.mode === 'wrong_id') return send(200, { id: a.id + 1, status: 'approved', decided_at: Date.now() });
        return send(200, { id: a.id, status: a.status, decided_at: a.status === 'pending' ? null : Date.now() });
      }
      send(404, { error: 'not_found' });
    });
  });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => {
    pagerBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    res();
  }));
}

describe.skipIf(!url)('approve on your phone', async () => {
  const { q, pool } = await import('../lib/db');
  const { createUser } = await import('../lib/users');
  const { encryptSecret } = await import('../lib/crypto');
  const { generateSecret, totpCode } = await import('../lib/totp');
  const { currentUser } = await import('../lib/session');
  const push = await import('../lib/push-mfa');
  const login = await import('../app/api/auth/login/route');
  const mfa = await import('../app/api/auth/mfa/route');
  const pushRoute = await import('../app/api/auth/mfa/push/route');

  const logged: string[] = [];
  const seen: string[] = []; // every status, header and body this app answered with

  let n = 0;
  const unique = () => `${Date.now().toString(36)}${(n++).toString(36)}${randomBytes(2).toString('hex')}`;
  // Addresses are fresh each run too, so earlier runs' requests in the same database don't count.
  const run = randomBytes(2);
  const ipFor = () => `10.${run[0]}.${run[1]}.${(n++ % 250) + 1}`;
  const usePager = (base: string, bearer = stubBearer) => { setEnv('SA_PAGER_URL', base); setEnv('SA_PAGER_TOKEN', bearer); };

  function enable(...emails: string[]) {
    const set = push.pushUsers();
    for (const e of emails) set.add(e);
    setEnv('SA_PUSH_MFA_USERS', [...set].join(','));
  }

  async function newUser(opts: { push?: boolean; totp?: string } = {}) {
    const email = `push-${unique()}@example.com`;
    const user = await createUser({ email, password: userPw });
    if (opts.totp) {
      await q(`UPDATE sa_users SET mfa_enabled = 1::bigint, mfa_secret = $2::text WHERE id + 0 = $1::bigint`, [user.id, encryptSecret(opts.totp)]);
    }
    if (opts.push) enable(email);
    return { email, id: user.id };
  }

  async function record(res: Response): Promise<Response> {
    const text = await res.clone().text();
    seen.push(`${res.status} ${JSON.stringify([...res.headers.entries()])} ${text}`);
    return res;
  }

  const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').match(/sa_sess=([a-f0-9]{64})/)?.[1] ?? null;

  /** Password step, as the login form posts it. Returns the browser's session cookie. */
  async function signIn(email: string, ip: string) {
    const res = await record(await login.POST(new Request('http://auth.test/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip, 'user-agent': CHROME_WIN },
      body: new URLSearchParams({ email, password: userPw, return_to: '/account' }).toString(),
    })));
    return { location: res.headers.get('location'), sid: cookieOf(res)! };
  }

  async function call(sid: string, ip: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
    const res = await record(await pushRoute.POST(new Request('http://auth.test/api/auth/mfa/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `sa_sess=${sid}`, 'x-forwarded-for': ip, 'user-agent': CHROME_WIN, ...headers },
      body: JSON.stringify(body),
    })));
    return { status: res.status, body: await res.json(), sid: cookieOf(res) };
  }

  const start = (sid: string, ip: string) => call(sid, ip, { action: 'start' });
  const check = (sid: string, ip: string, extra: Record<string, unknown> = {}) => call(sid, ip, { action: 'check', wait: 0, return_to: '/account', ...extra });

  const signedIn = async (sid: string) => !!(await currentUser(new Request('http://auth.test/', { headers: { cookie: `sa_sess=${sid}` } })));
  const session = async (sid: string) => (await q<{ mfa_ok: string; revoked: string }>(`SELECT mfa_ok, revoked FROM sa_sessions WHERE sid = $1::text`, [sid]))[0];
  const events = async (email: string) => q<{ event: string; detail: Record<string, unknown> }>(
    `SELECT event, detail FROM sa_audit WHERE actor = $1::text ORDER BY id`, [email]);
  const lastApproval = () => [...pager.approvals.values()].at(-1)!;

  beforeAll(async () => {
    await startPager();
    usePager(pagerBase);
    setEnv('SA_PUSH_MFA_USERS', '');
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(' ')); });
    }
    await q('SELECT 1');
  });
  beforeEach(() => {
    pager.mode = 'ok';
    usePager(pagerBase);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await new Promise((res) => server.close(res));
    await pool().end();
  });

  it('only people in SA_PUSH_MFA_USERS are offered the push, and only with a token', async () => {
    const plain = await newUser({ totp: generateSecret() });
    const ip = ipFor();
    const { location, sid } = await signIn(plain.email, ip);
    expect(location).toMatch(/^\/login\/mfa/);
    expect(push.pushEnabledFor(plain.email)).toBe(false);
    const creates = pager.creates.length;
    const r = await start(sid, ip);
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'not_enabled' });
    expect(pager.creates.length).toBe(creates);
    expect((await check(sid, ip)).body.status).toBe('none');
    expect(await signedIn(sid)).toBe(false);

    // Someone with no MFA at all still signs in with the password alone, as before.
    const none = await newUser();
    expect((await signIn(none.email, ipFor())).location).toBe('/account');

    const listed = await newUser({ push: true });
    expect(push.pushEnabledFor(listed.email.toUpperCase())).toBe(true);
    usePager(pagerBase, '');
    expect(push.pushEnabledFor(listed.email)).toBe(false);
  });

  it('a listed user gets the MFA step even without codes, and approval signs them in with a new sid', async () => {
    const u = await newUser({ push: true });
    const ip = ipFor();
    const { location, sid } = await signIn(u.email, ip);
    expect(location).toMatch(/^\/login\/mfa/);
    expect(Number((await session(sid)).mfa_ok)).toBe(0);

    const s = await start(sid, ip);
    expect(s.status).toBe(200);
    expect(s.body.number).toBeGreaterThanOrEqual(10);
    expect(s.body.number).toBeLessThanOrEqual(99);
    expect(s.body.expires_in).toBe(120);
    const sent = pager.creates.at(-1)!;
    expect(sent.auth).toBe(`Bearer ${stubBearer}`);
    expect(sent.body).toMatchObject({ title: 'Sign-in to Synergy', risk: 'high', ttl_seconds: 120, match: s.body.number });
    expect(String(sent.body.key)).toMatch(/^signin-[0-9a-f]{32}$/);
    expect(String(sent.body.summary)).toMatch(new RegExp(`^Chrome on Windows · ${ip.replace(/\./g, '\\.')} · \\d\\d:\\d\\d UTC$`));
    const row = (await q<{ approval_id: string; match_num: string; status: string }>(
      `SELECT approval_id, match_num, status FROM sa_push_approvals WHERE sid = $1::text`, [sid]))[0];
    expect(Number(row.approval_id)).toBe(lastApproval().id);
    expect(Number(row.match_num)).toBe(s.body.number);

    const p = await check(sid, ip);
    expect(p.body.status).toBe('pending');
    expect(p.sid).toBeNull();
    expect(await signedIn(sid)).toBe(false);

    lastApproval().status = 'approved';
    const done = await check(sid, ip, { return_to: '/hub' });
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ status: 'approved', redirect: '/hub' });
    expect(done.sid).toMatch(/^[a-f0-9]{64}$/);
    expect(done.sid).not.toBe(sid);
    expect(Number((await session(done.sid!)).mfa_ok)).toBe(1);
    expect(Number((await session(sid)).revoked)).toBe(1);
    expect(await signedIn(done.sid!)).toBe(true);
    expect(await signedIn(sid)).toBe(false);

    // The old cookie is spent: no second approval out of the same pending session.
    expect((await check(sid, ip)).status).toBe(401);
    const ev = await events(u.email);
    expect(ev.map((e) => e.event)).toEqual(['login.password_ok', 'mfa.push_sent', 'mfa.ok']);
    expect(ev[2].detail).toMatchObject({ method: 'push', approval_id: lastApproval().id });
  });

  it('one live approval per pending session, even when asked twice at once', async () => {
    const u = await newUser({ push: true });
    const ip = ipFor();
    const { sid } = await signIn(u.email, ip);
    const before = pager.creates.length;
    const [a, b] = await Promise.all([start(sid, ip), start(sid, ip)]);
    const c = await start(sid, ip);
    expect(pager.creates.length - before).toBe(1);
    expect(a.body.number).toBe(b.body.number);
    expect(c.body.number).toBe(a.body.number);
  });

  it('denied, expired and unknown answers never sign anyone in', async () => {
    for (const answer of ['denied', 'expired'] as const) {
      const u = await newUser({ push: true });
      const ip = ipFor();
      const { sid } = await signIn(u.email, ip);
      await start(sid, ip);
      lastApproval().status = answer;
      const r = await check(sid, ip);
      expect(r.body).toEqual({ status: answer });
      expect(r.sid).toBeNull();
      expect(await signedIn(sid)).toBe(false);
      expect(Number((await session(sid)).mfa_ok)).toBe(0);
      expect((await events(u.email)).map((e) => e.event)).toContain(`mfa.push_${answer}`);
      // That approval is over: a later "approved" for it changes nothing.
      lastApproval().status = 'approved';
      expect((await check(sid, ip)).body.status).toBe('none');
      expect(await signedIn(sid)).toBe(false);
      // Retry sends a fresh approval.
      expect((await start(sid, ip)).status).toBe(200);
    }

    for (const mode of ['weird_status', 'wrong_id'] as const) {
      const u = await newUser({ push: true });
      const ip = ipFor();
      const { sid } = await signIn(u.email, ip);
      await start(sid, ip);
      lastApproval().status = 'approved';
      pager.mode = mode;
      const r = await check(sid, ip);
      expect(r.body).toEqual({ status: 'unavailable' });
      expect(r.sid).toBeNull();
      expect(await signedIn(sid)).toBe(false);
    }
  });

  it('runs out on our own clock too, whatever the Pager says afterwards', async () => {
    const u = await newUser({ push: true });
    const ip = ipFor();
    const { sid } = await signIn(u.email, ip);
    await start(sid, ip);
    await q(`UPDATE sa_push_approvals SET expires_ms = $2::bigint WHERE sid = $1::text`, [sid, Date.now() - 1000]);
    lastApproval().status = 'approved';
    expect((await check(sid, ip)).body).toEqual({ status: 'expired' });
    expect((await check(sid, ip)).body).toEqual({ status: 'none' });
    expect(await signedIn(sid)).toBe(false);
  });

  it('an approval only completes the session it was sent for, whatever the browser sends', async () => {
    const u = await newUser({ push: true });
    const ipA = ipFor();
    const ipB = ipFor();
    const a = await signIn(u.email, ipA);
    const b = await signIn(u.email, ipB);
    await start(a.sid, ipA);
    const approvalA = lastApproval();
    await start(b.sid, ipB);
    approvalA.status = 'approved';

    const forged = await check(b.sid, ipB, { approval_id: approvalA.id, id: approvalA.id, status: 'approved', sid: a.sid });
    expect(forged.body).toEqual({ status: 'pending' });
    expect(forged.sid).toBeNull();
    expect(await signedIn(b.sid)).toBe(false);
    expect(pager.polls.at(-1)!.path).not.toContain(`/${approvalA.id}/`);

    const asserted = await call(b.sid, ipB, { action: 'approve', approval_id: approvalA.id });
    expect(asserted.status).toBe(400);
    expect(await signedIn(b.sid)).toBe(false);

    const cross = await call(b.sid, ipB, { action: 'start' }, { origin: 'https://evil.example', host: 'auth.test' });
    expect(cross.status).toBe(403);

    expect((await check(a.sid, ipA)).body.status).toBe('approved');
    expect(await signedIn(b.sid)).toBe(false);
    // No pending session, no answer at all.
    expect((await check('f'.repeat(64), ipA)).status).toBe(401);
  });

  it('a Pager outage falls back to codes and never signs anyone in', async () => {
    const secret = generateSecret();
    const u = await newUser({ push: true, totp: secret });
    const ip = ipFor();
    const { sid } = await signIn(u.email, ip);

    pager.mode = 'create_503';
    let r = await start(sid, ip);
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: 'unavailable' });
    expect(await signedIn(sid)).toBe(false);

    usePager('http://127.0.0.1:9'); // nothing listens there
    r = await start(sid, ip);
    expect(r.status).toBe(503);
    expect(await signedIn(sid)).toBe(false);

    usePager(pagerBase);
    pager.mode = 'ok';
    r = await start(sid, ip);
    expect(r.status).toBe(200);
    lastApproval().status = 'approved';
    pager.mode = 'status_500';
    expect((await check(sid, ip)).body).toEqual({ status: 'unavailable' });
    usePager('http://127.0.0.1:9');
    expect((await check(sid, ip)).body).toEqual({ status: 'unavailable' });
    expect(await signedIn(sid)).toBe(false);
    const ev = (await events(u.email)).filter((e) => e.event === 'mfa.push_unavailable');
    expect(ev.map((e) => e.detail.stage)).toEqual(['create', 'create', 'status', 'status']);

    // The code still works, with the same sid rotation.
    const res = await record(await mfa.POST(new Request('http://auth.test/api/auth/mfa', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `sa_sess=${sid}`, 'x-forwarded-for': ip },
      body: new URLSearchParams({ code: totpCode(secret), return_to: '/account' }).toString(),
    })));
    expect(res.headers.get('location')).toBe('/account');
    const fresh = cookieOf(res)!;
    expect(fresh).not.toBe(sid);
    expect(await signedIn(fresh)).toBe(true);
    expect(await signedIn(sid)).toBe(false);
  });

  it('limits approvals per person and per address', async () => {
    const u = await newUser({ push: true });
    const ip = ipFor();
    const { sid } = await signIn(u.email, ip);
    for (let i = 0; i < 5; i++) {
      expect((await start(sid, ip)).status).toBe(200);
      lastApproval().status = 'denied';
      expect((await check(sid, ip)).body.status).toBe('denied');
    }
    const before = pager.creates.length;
    // A new pending session or address doesn't reset the person's limit.
    const other = await signIn(u.email, ipFor());
    const limited = await start(other.sid, ipFor());
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: 'rate_limited' });
    expect(pager.creates.length).toBe(before);
    expect((await events(u.email)).map((e) => e.event)).toContain('mfa.push_rate_limited');

    const shared = ipFor();
    const people = [await newUser({ push: true }), await newUser({ push: true }), await newUser({ push: true })];
    let sent = 0;
    for (const p of people) {
      const s = await signIn(p.email, shared);
      for (let i = 0; i < 4 && sent < 10; i++) {
        expect((await start(s.sid, shared)).status).toBe(200);
        sent++;
        lastApproval().status = 'denied';
        await check(s.sid, shared);
      }
    }
    expect(sent).toBe(10);
    const fresh = await newUser({ push: true });
    const s = await signIn(fresh.email, shared);
    expect((await start(s.sid, shared)).status).toBe(429);
    expect((await start(s.sid, ipFor())).status).toBe(200);
  });

  it('the Pager token is never in an answer, the audit log or the console', async () => {
    const all = (await q<{ detail: unknown; event: string }>(`SELECT event, detail FROM sa_audit`)).map((r) => JSON.stringify(r));
    expect(seen.length).toBeGreaterThan(20);
    expect(all.length).toBeGreaterThan(20);
    for (const text of [...seen, ...all, ...logged]) expect(text).not.toContain(stubBearer);
    expect(seen.join('\n')).not.toContain(stubBearer.slice(-12));
    // It did go to the Pager, as the bearer and nowhere else in the request.
    expect(pager.creates.every((c) => c.auth === `Bearer ${stubBearer}` && !JSON.stringify(c.body).includes(stubBearer))).toBe(true);
    expect(pager.polls.every((p) => p.auth === `Bearer ${stubBearer}` && !p.path.includes(stubBearer))).toBe(true);
  });

  it('describes the browser for the phone', () => {
    const at = new Date('2026-10-28T14:03:00Z');
    const r = (ua: string, ip = '203.0.113.7') => push.summaryFor(new Request('http://x/', { headers: { 'user-agent': ua, 'x-forwarded-for': `${ip}, 10.0.0.1` } }), at);
    expect(r(CHROME_WIN)).toBe('Chrome on Windows · 203.0.113.7 · 14:03 UTC');
    expect(r('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iOS · 203.0.113.7 · 14:03 UTC');
    expect(r('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Gecko/20100101 Firefox/131.0')).toBe('Firefox on macOS · 203.0.113.7 · 14:03 UTC');
    expect(r('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0')).toBe('Edge on Windows · 203.0.113.7 · 14:03 UTC');
    expect(push.summaryFor(new Request('http://x/'), at)).toBe('A browser on an unknown system · unknown IP · 14:03 UTC');
  });
});
