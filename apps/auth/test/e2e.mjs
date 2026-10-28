/*
 * SynergyAuth end-to-end verification. Requires the dev server on :3500.
 * Exercises: discovery, login+lockout, TOTP MFA enroll/login, backup codes,
 * PKCE code flow, tokens, userinfo, refresh rotation + reuse detection,
 * introspection, revocation, client_credentials, logout, app passwords (set
 * PROXY_SHARED_SECRET for the server and this test to check them end to end), and the suite's
 * AI model setting: write-only key, encrypted at rest, served only to the internal network, and the
 * suite header's launcher list (/api/launcher: who sees which app, CORS for SUITE_DOMAIN's apps only).
 * With E2E_DEVICES_PORT set (the server started with DEVICES_INTERNAL_URL=http://localhost:<port>
 * and DEVICES_SVC_TOKEN=$E2E_DEVICES_TOKEN), it also plays Devices to check device compliance.
 * With E2E_PAGER_PORT set (see that section for the server env), it plays the Pager to check
 * "approve on your phone" sign-in.
 */
import { createHmac, createHash, randomBytes, generateKeyPairSync, createSign } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { createServer } from 'http';

const BASE = process.env.ISSUER_URL ?? 'http://localhost:3500';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

/* --- minimal TOTP (mirrors lib/totp.ts) --- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(s) {
  let bits = '';
  for (const ch of s.toUpperCase()) {
    const v = B32.indexOf(ch);
    if (v === -1) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const out = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, (i + 1) * 8), 2);
  return out;
}
function totp(secret, at = Math.floor(Date.now() / 1000)) {
  const counter = Buffer.alloc(8);
  counter.writeBigInt64BE(BigInt(Math.floor(at / 30)));
  const h = createHmac('sha1', b32decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const bin = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return (bin % 1e6).toString().padStart(6, '0');
}

/* --- cookie jar --- */
function jar() {
  const cookies = new Map();
  return {
    absorb(res) {
      const set = res.headers.getSetCookie?.() ?? [];
      for (const c of set) {
        const [pair] = c.split(';');
        const idx = pair.indexOf('=');
        const name = pair.slice(0, idx), val = pair.slice(idx + 1);
        if (val === '' || c.includes('Max-Age=0')) cookies.delete(name);
        else cookies.set(name, val);
      }
    },
    header() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

async function req(method, path, { body, cookies, headers = {}, redirect = 'manual' } = {}) {
  const h = { ...headers };
  if (cookies) h.cookie = cookies.header();
  if (body && !h['content-type']) h['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(BASE + path, {
    method, headers: h, redirect,
    body: body ? (typeof body === 'string' ? body : new URLSearchParams(body).toString()) : undefined,
  });
  if (cookies) cookies.absorb(res);
  return res;
}

const form = (o) => new URLSearchParams(o).toString();
const b64url = (buf) => buf.toString('base64url');

/* --- minimal CBOR encoder (enough for WebAuthn attestation objects) --- */
function cborUint(major, n) {
  const m = major << 5;
  if (n < 24) return Buffer.from([m | n]);
  if (n < 256) return Buffer.from([m | 24, n]);
  if (n < 65536) return Buffer.from([m | 25, n >> 8, n & 0xff]);
  const b = Buffer.alloc(5); b[0] = m | 26; b.writeUInt32BE(n, 1); return b;
}
function cbor(value) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value >= 0 ? cborUint(0, value) : cborUint(1, -1 - value);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([cborUint(2, value.length), value]);
  if (typeof value === 'string') {
    const b = Buffer.from(value, 'utf8');
    return Buffer.concat([cborUint(3, b.length), b]);
  }
  if (value instanceof Map) {
    const parts = [cborUint(5, value.size)];
    for (const [k, v] of value) parts.push(cbor(k), cbor(v));
    return Buffer.concat(parts);
  }
  throw new Error('cbor: unsupported ' + typeof value);
}

/* --- software WebAuthn authenticator (P-256, attestation "none") --- */
function makeAuthenticator(rpId) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credId = randomBytes(16);
  const rpIdHash = createHash('sha256').update(rpId).digest();
  const cose = new Map([
    [1, 2], [3, -7],
    [-1, 1],
    [-2, Buffer.from(jwk.x, 'base64url')],
    [-3, Buffer.from(jwk.y, 'base64url')],
  ]);
  return {
    credIdB64: b64url(credId),
    register(challenge, origin) {
      const flags = 0x45; // UP | UV | AT
      const counter = Buffer.alloc(4);
      const authData = Buffer.concat([
        rpIdHash, Buffer.from([flags]), counter,
        Buffer.alloc(16), // aaguid
        Buffer.from([credId.length >> 8, credId.length & 0xff]), credId,
        cbor(cose),
      ]);
      const attObj = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
      const cdj = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }));
      return {
        id: b64url(credId), rawId: b64url(credId), type: 'public-key',
        clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64url(cdj), attestationObject: b64url(attObj), transports: ['internal'] },
      };
    },
    assert(challenge, origin, counterVal = 1) {
      const counter = Buffer.alloc(4); counter.writeUInt32BE(counterVal);
      const authData = Buffer.concat([rpIdHash, Buffer.from([0x05]), counter]); // UP | UV
      const cdj = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
      const sig = createSign('SHA256')
        .update(Buffer.concat([authData, createHash('sha256').update(cdj).digest()]))
        .sign(privateKey);
      return {
        id: b64url(credId), rawId: b64url(credId), type: 'public-key', clientExtensionResults: {},
        response: {
          clientDataJSON: b64url(cdj), authenticatorData: b64url(authData),
          signature: b64url(sig), userHandle: null,
        },
      };
    },
  };
}

async function main() {
  const suffix = randomBytes(4).toString('hex');
  const userEmail = `e2e-${suffix}@example.com`;
  const userPw = 'CorrectHorse99x';

  console.log('== 1. Discovery & JWKS ==');
  const disc = await (await req('GET', '/.well-known/openid-configuration')).json();
  ok('discovery has issuer', disc.issuer === BASE);
  ok('discovery advertises PKCE S256', (disc.code_challenge_methods_supported ?? []).includes('S256'));
  const jwksDoc = await (await req('GET', '/api/oidc/jwks')).json();
  ok('JWKS has an RS256 key', jwksDoc.keys?.[0]?.alg === 'RS256' && !!jwksDoc.keys[0].n);

  console.log('== 2. Admin login (password only) ==');
  const adminJar = jar();
  const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
  const adminPw = process.env.E2E_ADMIN_PASSWORD;
  if (!adminPw) throw new Error('Set E2E_ADMIN_PASSWORD (from seed output)');
  let r = await req('POST', '/api/auth/login', { body: { email: adminEmail, password: adminPw, return_to: '/account' }, cookies: adminJar });
  ok('admin login redirects to /account', r.status === 303 && r.headers.get('location') === '/account', `got ${r.status} ${r.headers.get('location')}`);

  console.log('== 3. Admin creates test user + clients ==');
  r = await req('POST', '/api/admin/users', {
    body: JSON.stringify({ action: 'create', email: userEmail, password: userPw, name: 'E2E User' }),
    cookies: adminJar, headers: { 'content-type': 'application/json' },
  });
  ok('user created', r.status === 200, `got ${r.status}`);

  r = await req('POST', '/api/admin/clients', {
    body: JSON.stringify({ action: 'create', name: `e2e-conf-${suffix}`, redirect_uris: 'http://localhost:4000/callback', first_party: '1', client_credentials: '1' }),
    cookies: adminJar, headers: { 'content-type': 'application/json' },
  });
  const conf = await r.json();
  ok('confidential client created w/ one-time secret', r.status === 200 && !!conf.client_secret);

  r = await req('POST', '/api/admin/clients', {
    body: JSON.stringify({ action: 'create', name: `e2e-pub-${suffix}`, redirect_uris: 'http://localhost:4000/callback', first_party: '1', public_client: '1' }),
    cookies: adminJar, headers: { 'content-type': 'application/json' },
  });
  const pub = await r.json();
  ok('public client created (no secret)', r.status === 200 && pub.client_secret === null);

  console.log('== 4. Lockout policy ==');
  const lockJar = jar();
  for (let i = 0; i < 5; i++) {
    r = await req('POST', '/api/auth/login', { body: { email: userEmail, password: 'wrong-password-1', return_to: '/account' }, cookies: lockJar });
  }
  ok('5th failure redirects with error=locked', (r.headers.get('location') ?? '').includes('error=locked'));
  r = await req('POST', '/api/auth/login', { body: { email: userEmail, password: userPw, return_to: '/account' }, cookies: lockJar });
  ok('correct password rejected while locked', (r.headers.get('location') ?? '').includes('error=locked'));
  // unlock for the rest of the test
  r = await req('GET', '/api/admin/users', { cookies: adminJar });
  const allUsers = (await r.json()).users;
  const testUser = allUsers.find((u) => u.email === userEmail);
  await req('POST', '/api/admin/users', {
    body: JSON.stringify({ action: 'enable', user_id: testUser.id }),
    cookies: adminJar, headers: { 'content-type': 'application/json' },
  });
  // enable clears disabled but not lock; reset via reset_password (also revokes sessions)
  await req('POST', '/api/admin/users', {
    body: JSON.stringify({ action: 'reset_password', user_id: testUser.id, password: userPw }),
    cookies: adminJar, headers: { 'content-type': 'application/json' },
  });

  console.log('== 5. User login + MFA enrollment ==');
  const userJar = jar();
  r = await req('POST', '/api/auth/login', { body: { email: userEmail, password: userPw, return_to: '/account' }, cookies: userJar });
  // may still be locked if lockout window applies to lock timestamp; report clearly
  ok('user logs in after admin reset', r.headers.get('location') === '/account', `got ${r.headers.get('location')}`);

  r = await req('POST', '/api/account/mfa', {
    body: JSON.stringify({ action: 'enroll' }), cookies: userJar, headers: { 'content-type': 'application/json' },
  });
  const enroll = await r.json();
  ok('enroll returns secret + QR', r.status === 200 && !!enroll.secret && (enroll.qr_data_url ?? '').startsWith('data:image/png'));

  r = await req('POST', '/api/account/mfa', {
    body: JSON.stringify({ action: 'verify', code: totp(enroll.secret) }), cookies: userJar, headers: { 'content-type': 'application/json' },
  });
  const verified = await r.json();
  ok('verify activates MFA + returns 10 backup codes', r.status === 200 && verified.backup_codes?.length === 10);
  const backupCodes = verified.backup_codes ?? [];

  console.log('== 6. MFA-gated login ==');
  const mfaJar = jar();
  r = await req('POST', '/api/auth/login', { body: { email: userEmail, password: userPw, return_to: '/account' }, cookies: mfaJar });
  ok('password step redirects to /login/mfa', (r.headers.get('location') ?? '').startsWith('/login/mfa'));
  r = await req('GET', '/api/oidc/authorize?' + form({
    client_id: conf.client_id, redirect_uri: 'http://localhost:4000/callback', response_type: 'code', scope: 'openid',
  }), { cookies: mfaJar });
  ok('authorize refuses MFA-pending session (sends to login)', (r.headers.get('location') ?? '').startsWith('/login'));
  r = await req('POST', '/api/auth/mfa', { body: { code: '000000', return_to: '/account' }, cookies: mfaJar });
  ok('wrong TOTP rejected', (r.headers.get('location') ?? '').includes('error=1'));
  r = await req('POST', '/api/auth/mfa', { body: { code: totp(enroll.secret), return_to: '/account' }, cookies: mfaJar });
  ok('correct TOTP completes login', r.headers.get('location') === '/account');

  console.log('== 7. Backup code login ==');
  const buJar = jar();
  await req('POST', '/api/auth/login', { body: { email: userEmail, password: userPw, return_to: '/account' }, cookies: buJar });
  r = await req('POST', '/api/auth/mfa', { body: { code: backupCodes[0], return_to: '/account' }, cookies: buJar });
  ok('backup code accepted', r.headers.get('location') === '/account');
  const buJar2 = jar();
  await req('POST', '/api/auth/login', { body: { email: userEmail, password: userPw, return_to: '/account' }, cookies: buJar2 });
  r = await req('POST', '/api/auth/mfa', { body: { code: backupCodes[0], return_to: '/account' }, cookies: buJar2 });
  ok('same backup code rejected on reuse', (r.headers.get('location') ?? '').includes('error=1'));

  console.log('== 8. OIDC code flow + PKCE (public client) ==');
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const authUrl = '/api/oidc/authorize?' + form({
    client_id: pub.client_id, redirect_uri: 'http://localhost:4000/callback', response_type: 'code',
    scope: 'openid profile email', state: 'xyz123', nonce: 'n0nce', code_challenge: challenge, code_challenge_method: 'S256',
  });
  r = await req('GET', authUrl, { cookies: mfaJar });
  let loc = r.headers.get('location') ?? '';
  ok('authorize redirects to RP with code+state', loc.startsWith('http://localhost:4000/callback?') && loc.includes('state=xyz123'), loc);
  const code = new URL(loc).searchParams.get('code');

  r = await req('GET', '/api/oidc/authorize?' + form({
    client_id: pub.client_id, redirect_uri: 'http://localhost:4000/callback', response_type: 'code', scope: 'openid',
  }), { cookies: mfaJar });
  ok('public client without PKCE is rejected', (r.headers.get('location') ?? '').includes('error=invalid_request'));

  r = await req('POST', '/api/oidc/token', { body: { grant_type: 'authorization_code', code, redirect_uri: 'http://localhost:4000/callback', client_id: pub.client_id, code_verifier: 'wrong-verifier-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } });
  ok('token exchange with wrong PKCE verifier fails', r.status === 400);
  r = await req('POST', '/api/oidc/token', { body: { grant_type: 'authorization_code', code, redirect_uri: 'http://localhost:4000/callback', client_id: pub.client_id, code_verifier: verifier } });
  ok('used code cannot be replayed', r.status === 400);

  // fresh code, correct exchange
  r = await req('GET', authUrl, { cookies: mfaJar });
  const code2 = new URL(r.headers.get('location')).searchParams.get('code');
  r = await req('POST', '/api/oidc/token', { body: { grant_type: 'authorization_code', code: code2, redirect_uri: 'http://localhost:4000/callback', client_id: pub.client_id, code_verifier: verifier } });
  const tokens = await r.json();
  ok('token exchange succeeds', r.status === 200 && !!tokens.access_token && !!tokens.id_token && !!tokens.refresh_token, JSON.stringify(tokens).slice(0, 120));
  const idClaims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString());
  ok('id_token carries nonce + email + aud', idClaims.nonce === 'n0nce' && idClaims.email === userEmail && idClaims.aud === pub.client_id);

  console.log('== 9. userinfo / introspect ==');
  r = await req('GET', '/api/oidc/userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` } });
  const ui = await r.json();
  ok('userinfo returns claims', r.status === 200 && ui.email === userEmail && !!ui.sub);
  r = await req('GET', '/api/oidc/userinfo', { headers: { authorization: 'Bearer garbage.token.here' } });
  ok('userinfo rejects bad token', r.status === 401);

  const basic = 'Basic ' + Buffer.from(`${conf.client_id}:${conf.client_secret}`).toString('base64');
  r = await req('POST', '/api/oidc/introspect', { body: { token: tokens.access_token }, headers: { authorization: basic } });
  const intro = await r.json();
  ok('introspect: access token active', intro.active === true && intro.token_type === 'access_token');

  console.log('== 10. Refresh rotation + reuse detection ==');
  r = await req('POST', '/api/oidc/token', { body: { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: pub.client_id } });
  const rot1 = await r.json();
  ok('refresh rotates', r.status === 200 && !!rot1.refresh_token && rot1.refresh_token !== tokens.refresh_token);
  r = await req('POST', '/api/oidc/token', { body: { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: pub.client_id } });
  ok('old refresh token reuse detected', r.status === 400);
  r = await req('POST', '/api/oidc/token', { body: { grant_type: 'refresh_token', refresh_token: rot1.refresh_token, client_id: pub.client_id } });
  ok('reuse revokes whole family (new token dead too)', r.status === 400);

  console.log('== 11. Revocation ==');
  // get a fresh family on the confidential client via code flow
  r = await req('GET', '/api/oidc/authorize?' + form({
    client_id: conf.client_id, redirect_uri: 'http://localhost:4000/callback', response_type: 'code', scope: 'openid offline_access',
  }), { cookies: mfaJar });
  const code3 = new URL(r.headers.get('location')).searchParams.get('code');
  r = await req('POST', '/api/oidc/token', { body: { grant_type: 'authorization_code', code: code3, redirect_uri: 'http://localhost:4000/callback' }, headers: { authorization: basic } });
  const t3 = await r.json();
  ok('confidential client token exchange (Basic auth)', r.status === 200 && !!t3.refresh_token);
  r = await req('POST', '/api/oidc/revoke', { body: { token: t3.refresh_token }, headers: { authorization: basic } });
  ok('revoke returns 200', r.status === 200);
  r = await req('POST', '/api/oidc/token', { body: { grant_type: 'refresh_token', refresh_token: t3.refresh_token }, headers: { authorization: basic } });
  ok('revoked refresh token unusable', r.status === 400);

  console.log('== 12. client_credentials ==');
  r = await req('POST', '/api/oidc/token', { body: { grant_type: 'client_credentials', scope: '' }, headers: { authorization: basic } });
  const cc = await r.json();
  ok('client_credentials issues access token', r.status === 200 && !!cc.access_token && !cc.refresh_token);
  r = await req('POST', '/api/oidc/token', { body: { grant_type: 'client_credentials', client_id: conf.client_id, client_secret: 'nope' } });
  ok('bad client secret rejected', r.status === 401);

  if (process.env.E2E_DEVICES_PORT) {
    console.log('== 12b. Device compliance at sign-in ==');
    // Plays Devices: `fleet` is what /api/svc/access answers for the test user; null = Devices is down.
    let fleet = [];
    const fake = createServer((rq, rs) => {
      const u = new URL(rq.url, 'http://x');
      if (rq.headers.authorization !== `Bearer ${process.env.E2E_DEVICES_TOKEN}` || u.pathname !== '/api/svc/access') { rs.writeHead(401).end(); return; }
      if (fleet === null) { rs.writeHead(500).end(); return; }
      rs.writeHead(200, { 'content-type': 'application/json' });
      rs.end(JSON.stringify({ email: u.searchParams.get('email'), devices: u.searchParams.get('email') === userEmail ? fleet : [] }));
    });
    await new Promise((res) => fake.listen(Number(process.env.E2E_DEVICES_PORT), res));
    const mac = { id: 'd1', name: 'E2E-MacBook', platform: 'darwin', compliance: 'noncompliant', failing: [{ label: 'Disk encryption', detail: 'The system disk is not encrypted' }], last_seen: new Date().toISOString() };
    const setMode = (mode, extra = {}) => req('POST', '/api/admin/settings', {
      body: JSON.stringify({ action: 'set_device_compliance', mode, no_device: 'allow', exempt: '', ...extra }),
      cookies: adminJar, headers: { 'content-type': 'application/json' },
    });
    const authz = '/api/oidc/authorize?' + form({ client_id: conf.client_id, redirect_uri: 'http://localhost:4000/callback', response_type: 'code', scope: 'openid offline_access' });
    const signIn = async () => (await req('GET', authz, { cookies: mfaJar })).headers.get('location') ?? '';

    r = await req('GET', authz, { cookies: mfaJar });
    const rc = new URL(r.headers.get('location')).searchParams.get('code');
    const fam = await (await req('POST', '/api/oidc/token', { body: { grant_type: 'authorization_code', code: rc, redirect_uri: 'http://localhost:4000/callback' }, headers: { authorization: basic } })).json();

    fleet = [mac];
    r = await setMode('enforce');
    ok('admin turns on blocking', r.status === 200);
    loc = await signIn();
    ok('non-compliant device blocks sign-in', loc.startsWith('/login/device-blocked?return_to='), loc);
    r = await req('GET', loc, { cookies: mfaJar });
    const page = await r.text();
    ok('blocked page names the device and the failing setting', r.status === 200 && page.includes('E2E-MacBook') && page.includes('The system disk is not encrypted'));
    r = await req('POST', '/api/oidc/token', { body: { grant_type: 'refresh_token', refresh_token: fam.refresh_token }, headers: { authorization: basic } });
    ok('session renewal is refused too', r.status === 400);
    r = await req('GET', '/api/admin/audit', { cookies: adminJar });
    ok('block is audited', JSON.stringify(await r.json()).includes('device_access.blocked'));

    await setMode('report');
    ok('report mode lets them in', (await signIn()).startsWith('http://localhost:4000/callback?'));
    await setMode('enforce', { exempt: userEmail.toUpperCase() });
    ok('exempt people are let in', (await signIn()).startsWith('http://localhost:4000/callback?'));
    await setMode('enforce');
    fleet = [{ ...mac, compliance: 'unknown', failing: [] }];
    ok('a device that has not reported yet does not block', (await signIn()).startsWith('http://localhost:4000/callback?'));
    fleet = null;
    ok('Devices down lets them in', (await signIn()).startsWith('http://localhost:4000/callback?'));
    fleet = [];
    ok('no device is allowed by default', (await signIn()).startsWith('http://localhost:4000/callback?'));
    await setMode('enforce', { no_device: 'block' });
    ok('no device blocks when required', (await signIn()).startsWith('/login/device-blocked'));
    fleet = [{ ...mac, compliance: 'compliant', failing: [] }];
    ok('fixed device lets them in', (await signIn()).startsWith('http://localhost:4000/callback?'));
    await setMode('off');
    fake.close();
  }

  console.log('== 13. SSO logout ==');
  r = await req('GET', '/api/oidc/logout', { cookies: mfaJar });
  ok('logout redirects to login', (r.headers.get('location') ?? '').startsWith('/login'));
  r = await req('GET', '/api/oidc/authorize?' + form({
    client_id: conf.client_id, redirect_uri: 'http://localhost:4000/callback', response_type: 'code', scope: 'openid',
  }), { cookies: mfaJar });
  ok('session dead after logout (authorize -> login)', (r.headers.get('location') ?? '').startsWith('/login'));

  console.log('== 14. Password reset via email ==');
  r = await req('POST', '/api/auth/forgot', { body: { email: userEmail } });
  ok('forgot always redirects to sent page', (r.headers.get('location') ?? '').includes('sent=1'));
  r = await req('POST', '/api/auth/forgot', { body: { email: `nobody-${suffix}@nowhere.test` } });
  ok('unknown email gets identical response (no enumeration)', (r.headers.get('location') ?? '').includes('sent=1'));

  const mailDir = path.join(process.cwd(), 'dev-mail');
  const newest = readdirSync(mailDir).sort().reverse()[0];
  const mail = readFileSync(path.join(mailDir, newest), 'utf8');
  const resetToken = mail.match(/\/reset\?token=([A-Za-z0-9_-]+)/)?.[1];
  ok('reset email written with token link', !!resetToken, newest);

  const newPw = 'FreshHorse2026x';
  r = await req('POST', '/api/auth/reset', { body: { token: resetToken, password: 'short' } });
  ok('weak password rejected by policy', (r.headers.get('location') ?? '').includes('error=policy'));
  r = await req('POST', '/api/auth/reset', { body: { token: resetToken, password: newPw } });
  ok('reset accepted', (r.headers.get('location') ?? '').includes('reset=1'));
  r = await req('POST', '/api/auth/reset', { body: { token: resetToken, password: newPw } });
  ok('reset token single-use', (r.headers.get('location') ?? '').includes('error=expired'));

  const postResetJar = jar();
  r = await req('POST', '/api/auth/login', { body: { email: userEmail, password: newPw, return_to: '/account' }, cookies: postResetJar });
  ok('login with new password (MFA still enforced)', (r.headers.get('location') ?? '').startsWith('/login/mfa'));
  r = await req('POST', '/api/auth/mfa', { body: { code: totp(enroll.secret), return_to: '/account' }, cookies: postResetJar });
  ok('TOTP still valid after reset', r.headers.get('location') === '/account');

  console.log('== 15. Signing-key rotation ==');
  r = await req('POST', '/api/oidc/token', { body: { grant_type: 'client_credentials', scope: '' }, headers: { authorization: basic } });
  const preRotate = (await r.json()).access_token;
  const oldKid = JSON.parse(Buffer.from(preRotate.split('.')[0], 'base64url').toString()).kid;
  r = await req('POST', '/api/admin/settings', {
    body: JSON.stringify({ action: 'rotate_key' }), cookies: adminJar, headers: { 'content-type': 'application/json' },
  });
  const rotated = await r.json();
  ok('admin rotates signing key', r.status === 200 && !!rotated.kid && rotated.kid !== oldKid);
  const jwks2 = await (await req('GET', '/api/oidc/jwks')).json();
  ok('JWKS now publishes old + new keys', jwks2.keys.length >= 2 && jwks2.keys.some((k) => k.kid === oldKid) && jwks2.keys.some((k) => k.kid === rotated.kid));
  r = await req('POST', '/api/oidc/token', { body: { grant_type: 'client_credentials', scope: '' }, headers: { authorization: basic } });
  const postRotate = (await r.json()).access_token;
  const newKid = JSON.parse(Buffer.from(postRotate.split('.')[0], 'base64url').toString()).kid;
  ok('new tokens signed with new kid', newKid === rotated.kid);
  r = await req('POST', '/api/oidc/introspect', { body: { token: preRotate }, headers: { authorization: basic } });
  ok('pre-rotation token still verifies (old key kept)', (await r.json()).active === true);

  console.log('== 16. WebAuthn passkeys ==');
  const authnr = makeAuthenticator('localhost');
  const origin = BASE;
  // enroll on the user's authenticated session (postResetJar)
  r = await req('POST', '/api/account/passkeys', {
    body: JSON.stringify({ action: 'register_options' }), cookies: postResetJar, headers: { 'content-type': 'application/json' },
  });
  const regOpt = (await r.json()).options;
  ok('registration options issued', r.status === 200 && !!regOpt?.challenge && regOpt.rp.id === 'localhost');
  const attResp = authnr.register(regOpt.challenge, origin);
  r = await req('POST', '/api/account/passkeys', {
    body: JSON.stringify({ action: 'register_verify', response: JSON.stringify(attResp), name: 'e2e soft-authenticator' }),
    cookies: postResetJar, headers: { 'content-type': 'application/json' },
  });
  ok('attestation verified + passkey stored', r.status === 200, JSON.stringify(await r.clone().json?.() ?? {}));
  r = await req('GET', '/api/account/passkeys', { cookies: postResetJar });
  ok('passkey listed', ((await r.json()).passkeys ?? []).some((k) => k.name === 'e2e soft-authenticator'));

  // usernameless login on a fresh jar
  const pkJar = jar();
  r = await req('POST', '/api/auth/passkey', { body: JSON.stringify({ action: 'options' }), headers: { 'content-type': 'application/json' } });
  const { options: authOpt, handle } = await r.json();
  ok('authentication options issued', !!authOpt?.challenge && !!handle);
  const assertion = authnr.assert(authOpt.challenge, origin);
  r = await req('POST', '/api/auth/passkey', {
    body: JSON.stringify({ action: 'verify', handle, response: JSON.stringify(assertion) }),
    cookies: pkJar, headers: { 'content-type': 'application/json' },
  });
  ok('passkey assertion verified, session created', r.status === 200);
  r = await req('GET', '/api/account/sessions', { cookies: pkJar });
  ok('passkey session is fully authenticated (MFA-grade)', r.status === 200);
  // replayed assertion must fail (challenge consumed)
  r = await req('POST', '/api/auth/passkey', {
    body: JSON.stringify({ action: 'verify', handle, response: JSON.stringify(assertion) }),
    headers: { 'content-type': 'application/json' },
  });
  ok('assertion replay rejected', r.status === 400);

  console.log('== 17. SCIM 2.0 provisioning ==');
  r = await req('POST', '/api/admin/settings', {
    body: JSON.stringify({ action: 'create_api_token', name: 'e2e' }), cookies: adminJar, headers: { 'content-type': 'application/json' },
  });
  const scimToken = (await r.json()).token;
  ok('SCIM token created (shown once)', !!scimToken?.startsWith('sascim_'));
  const scimH = { authorization: `Bearer ${scimToken}`, 'content-type': 'application/scim+json' };

  r = await req('GET', '/api/scim/v2/Users', {});
  ok('SCIM rejects missing token', r.status === 401);
  const scimEmail = `scim-${suffix}@example.com`;
  r = await req('POST', '/api/scim/v2/Users', {
    body: JSON.stringify({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: scimEmail, name: { formatted: 'SCIM User' }, active: true }),
    headers: scimH,
  });
  const created = await r.json();
  ok('SCIM create returns 201 + id', r.status === 201 && !!created.id && created.userName === scimEmail);
  r = await req('GET', `/api/scim/v2/Users?filter=${encodeURIComponent(`userName eq "${scimEmail}"`)}`, { headers: scimH });
  const listed = await r.json();
  ok('SCIM filter finds user', listed.totalResults === 1 && listed.Resources[0].id === created.id);
  r = await req('PATCH', `/api/scim/v2/Users/${created.id}`, {
    body: JSON.stringify({ schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', value: { active: false } }] }),
    headers: scimH,
  });
  ok('SCIM patch deactivates', r.status === 200 && (await r.json()).active === false);
  r = await req('PUT', `/api/scim/v2/Users/${created.id}`, {
    body: JSON.stringify({ userName: scimEmail, name: { formatted: 'Renamed User' }, active: true }),
    headers: scimH,
  });
  const put = await r.json();
  ok('SCIM PUT renames + reactivates', r.status === 200 && put.name.formatted === 'Renamed User' && put.active === true);
  r = await req('DELETE', `/api/scim/v2/Users/${created.id}`, { headers: scimH });
  ok('SCIM delete returns 204', r.status === 204);
  r = await req('GET', `/api/scim/v2/Users/${created.id}`, { headers: scimH });
  ok('deleted user is deactivated, not destroyed', r.status === 200 && (await r.json()).active === false);

  console.log('== 18. SAML 2.0 IdP ==');
  const samlify = (await import('samlify')).default ?? (await import('samlify'));
  samlify.setSchemaValidator({ validate: () => Promise.resolve('skipped') });
  const idpMetaXml = await (await req('GET', '/api/saml/metadata')).text();
  ok('IdP metadata served', idpMetaXml.includes('IDPSSODescriptor') && idpMetaXml.includes('X509Certificate'));

  const spEntity = `http://localhost:4000/saml/metadata-${suffix}`;
  const spAcs = 'http://localhost:4000/saml/acs';
  const spSlo = 'http://localhost:4000/saml/slo';
  r = await req('POST', '/api/admin/settings', {
    body: JSON.stringify({ action: 'add_saml_sp', name: 'e2e SP', entity_id: spEntity, acs_url: spAcs, slo_url: spSlo }),
    cookies: adminJar, headers: { 'content-type': 'application/json' },
  });
  ok('SAML SP registered', r.status === 200);

  const testIdp = samlify.IdentityProvider({ metadata: idpMetaXml });
  const testSp = samlify.ServiceProvider({
    entityID: spEntity,
    assertionConsumerService: [{ Binding: samlify.Constants.namespace.binding.post, Location: spAcs }],
    singleLogoutService: [{ Binding: samlify.Constants.namespace.binding.redirect, Location: spSlo }],
    wantAssertionsSigned: true,
    authnRequestsSigned: false,
  });
  ok('IdP metadata advertises SingleLogoutService', idpMetaXml.includes('SingleLogoutService') && idpMetaXml.includes('/api/saml/slo'));
  const { context: loginUrl } = testSp.createLoginRequest(testIdp, 'redirect');
  const qs = new URL(loginUrl).search;
  r = await req('GET', '/api/saml/sso' + qs, {});
  ok('unauthenticated SAML SSO redirects to hosted login', r.status === 303 && (r.headers.get('location') ?? '').startsWith('/login'));
  r = await req('GET', '/api/saml/sso' + qs, { cookies: adminJar });
  const ssoHtml = await r.text();
  const samlResponse = ssoHtml.match(/name="SAMLResponse" value="([^"]+)"/)?.[1];
  ok('authenticated SSO returns auto-post form to ACS', r.status === 200 && !!samlResponse && ssoHtml.includes(spAcs));
  let samlExtract = null;
  try {
    const parsed = await testSp.parseLoginResponse(testIdp, 'post', { body: { SAMLResponse: samlResponse } });
    samlExtract = parsed.extract;
  } catch (e) {
    ok('SAML response signature validates at the SP', false, String(e));
  }
  if (samlExtract) {
    ok('SAML response signature validates at the SP', true);
    ok('SAML NameID is the user email', samlExtract.nameID === adminEmail, `got ${samlExtract.nameID}`);
    ok('SAML audience is the SP entityID', samlExtract.audience === spEntity, `got ${samlExtract.audience}`);
  }

  console.log('== 19. SAML Single Logout ==');
  // fresh authenticated SSO session to log out of
  const sloJar = jar();
  await req('POST', '/api/auth/login', { body: { email: adminEmail, password: adminPw, return_to: '/account' }, cookies: sloJar });
  r = await req('GET', '/api/account/sessions', { cookies: sloJar });
  ok('SLO precondition: session authenticated', r.status === 200);
  const { context: logoutUrl } = testSp.createLogoutRequest(testIdp, 'redirect', { nameID: adminEmail, sessionIndex: '' });
  const sloQs = new URL(logoutUrl).search;
  r = await req('GET', '/api/saml/slo' + sloQs, { cookies: sloJar });
  ok('SLO redirects (to SP LogoutResponse or logout page)', r.status === 303 && !!r.headers.get('location'));
  r = await req('GET', '/api/account/sessions', { cookies: sloJar });
  ok('SLO ended the SSO session', r.status === 401);

  console.log('== 20. Hardening: headers + secrets at rest ==');
  r = await req('GET', '/login', {});
  const csp = r.headers.get('content-security-policy') ?? '';
  ok('CSP frame-ancestors none on hosted pages', csp.includes("frame-ancestors 'none'"));
  ok('X-Frame-Options DENY', (r.headers.get('x-frame-options') ?? '') === 'DENY');
  ok('X-Content-Type-Options nosniff', (r.headers.get('x-content-type-options') ?? '') === 'nosniff');

  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5499/synergydb', max: 1 });
  const mfaRow = (await pool.query(`SELECT mfa_secret FROM sa_users WHERE email = $1::text`, [userEmail])).rows[0];
  ok('TOTP secret encrypted at rest (enc:v1:)', (mfaRow?.mfa_secret ?? '').startsWith('enc:v1:'), `got ${(mfaRow?.mfa_secret ?? '').slice(0, 12)}`);
  const keyRow = (await pool.query(`SELECT private_pem FROM sa_keys WHERE active + 0 = 1::bigint`)).rows[0];
  ok('signing private key encrypted at rest', (keyRow?.private_pem ?? '').startsWith('enc:v1:'), `got ${(keyRow?.private_pem ?? '').slice(0, 12)}`);
  const certRow = (await pool.query(`SELECT key_pem FROM sa_saml_cert WHERE id + 0 = 1::bigint`)).rows[0];
  ok('SAML private key encrypted at rest', (certRow?.key_pem ?? '').startsWith('enc:v1:'), `got ${(certRow?.key_pem ?? '').slice(0, 12)}`);
  await pool.end();
  // The fact that sections 6 & 8 (TOTP login, signed tokens) passed proves the
  // encrypted values still decrypt correctly for use.

  console.log('== 21. App passwords (phone sync) ==');
  const apEmail = `ap-${suffix}@example.com`;
  await req('POST', '/api/admin/users', {
    body: JSON.stringify({ action: 'create', email: apEmail, password: userPw, name: 'Phone User' }),
    cookies: adminJar, headers: { 'content-type': 'application/json' },
  });
  const apJar = jar();
  await req('POST', '/api/auth/login', { body: { email: apEmail, password: userPw, return_to: '/account' }, cookies: apJar });
  const apOrigin = new URL(BASE).origin;
  const makePw = (name, o = apOrigin) => req('POST', '/api/account/app-passwords', {
    body: JSON.stringify({ name }), cookies: apJar, headers: { 'content-type': 'application/json', origin: o },
  });
  r = await makePw('iPhone');
  const iphone = await r.json();
  ok('app password made, shown once', r.status === 200 && /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/.test(iphone.password ?? ''), JSON.stringify(iphone));
  r = await makePw('Evil', 'https://elsewhere.example');
  ok('app password refused from another origin', r.status === 403);
  r = await req('GET', '/api/account/app-passwords', { cookies: apJar });
  const apListed = (await r.json()).appPasswords ?? [];
  ok('app passwords listed without the password', apListed.length === 1 && apListed[0].name === 'iPhone' && !('password' in apListed[0]) && !('token_hash' in apListed[0]));
  const secret = process.env.PROXY_SHARED_SECRET;
  if (!secret) {
    console.log('  SKIP  verify checks (set PROXY_SHARED_SECRET for the server and this test)');
  } else {
    const check = (email, password, s = secret) => req('POST', '/api/internal/app-passwords/verify', {
      body: JSON.stringify({ email, password, app: 'e2e', ip: '192.0.2.1' }),
      headers: { 'content-type': 'application/json', 'x-proxy-auth-secret': s },
    });
    r = await check(apEmail, iphone.password);
    ok('app password verifies for the internal network', r.status === 200 && (await r.json()).email === apEmail);
    r = await check(apEmail.toUpperCase(), iphone.password.toUpperCase().replace(/-/g, ' '));
    ok('case, spaces and dashes don\'t matter', r.status === 200);
    r = await check(apEmail, iphone.password, 'wrong-secret');
    ok('verify refuses without the proxy secret', r.status === 403);
    r = await check(apEmail, userPw);
    ok('the account password is not an app password', r.status === 401);
    r = await req('GET', '/api/account/app-passwords', { cookies: apJar });
    ok('last used is recorded', ((await r.json()).appPasswords[0].last_used_app) === 'e2e');
    const laptop = await (await makePw('Laptop')).json();
    ok('second app password works', (await check(apEmail, laptop.password)).status === 200);
    r = await req('DELETE', `/api/account/app-passwords/${laptop.id}`, { cookies: apJar, headers: { origin: apOrigin } });
    ok('revoked', r.status === 200);
    ok('revoked app password refused', (await check(apEmail, laptop.password)).status === 401);
    ok('the other one still works', (await check(apEmail, iphone.password)).status === 200);
    for (let i = 0; i < 10; i++) r = await check(apEmail, `wrong-guess-${i}-aaaaaaaa`);
    ok('10 wrong guesses lock app passwords', r.status === 429);
    ok('right password refused while locked', (await check(apEmail, iphone.password)).status === 429);
    r = await req('POST', '/api/auth/login', { body: { email: apEmail, password: userPw, return_to: '/account' }, cookies: jar() });
    ok('web sign-in is not locked by app password guesses', r.status === 303 && !(r.headers.get('location') ?? '').includes('error'));
  }
  r = await req('POST', '/api/admin/users', {
    body: JSON.stringify({ action: 'reset_password', user_id: (await (await req('GET', '/api/admin/users', { cookies: adminJar })).json()).users.find((u) => u.email === apEmail).id, password: userPw }),
    cookies: adminJar, headers: { 'content-type': 'application/json' },
  });
  const pg2 = (await import('pg')).default;
  const pool2 = new pg2.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5499/synergydb', max: 1 });
  const live = (await pool2.query(`SELECT count(*)::int AS n FROM sa_app_passwords p JOIN sa_users u ON u.id = p.user_id WHERE u.email = $1::text AND p.revoked = 0`, [apEmail])).rows[0].n;
  const stored = (await pool2.query(`SELECT token_hash FROM sa_app_passwords p JOIN sa_users u ON u.id = p.user_id WHERE u.email = $1::text`, [apEmail])).rows;
  await pool2.end();
  ok('stored hashed, never as typed', stored.length === 2 && stored.every((x) => /^[0-9a-f]{64}$/.test(x.token_hash) && x.token_hash !== iphone.password));
  ok('an admin password reset revokes app passwords', live === 0);

  console.log('== AI model setting ==');
  // Plays an OpenAI-compatible server for the Test button: the right key gets an answer.
  const aiSeen = [];
  const fakeAi = createServer((rq, rs) => {
    let b = '';
    rq.on('data', (c) => (b += c));
    rq.on('end', () => {
      aiSeen.push({ path: rq.url, auth: rq.headers.authorization, body: JSON.parse(b || '{}') });
      const good = rq.headers.authorization === 'Bearer sk-e2e-ai-key-ABCD';
      rs.writeHead(good ? 200 : 401, { 'content-type': 'application/json' });
      rs.end(JSON.stringify(good ? { choices: [{ message: { content: 'OK' } }] } : { error: { message: 'Incorrect API key provided' } }));
    });
  });
  await new Promise((res) => fakeAi.listen(0, '127.0.0.1', res));
  const aiBase = `http://127.0.0.1:${fakeAi.address().port}/v1`;
  const aiKey = 'sk-e2e-ai-key-ABCD';
  const aiPost = (o, cookies = adminJar) => req('POST', '/api/admin/settings', {
    body: JSON.stringify(o), cookies, headers: { 'content-type': 'application/json' },
  });
  const internalAi = (s) => req('GET', '/api/internal/ai-settings', { headers: s === undefined ? {} : { 'x-proxy-auth-secret': s } });
  await aiPost({ action: 'clear_ai_model' });
  r = await req('GET', '/api/admin/settings', { cookies: adminJar });
  ok('no AI model saved to begin with', (await r.json()).ai_model === null);
  r = await aiPost({ action: 'set_ai_model', provider: 'anthropic', model: 'm' });
  ok('a hosted provider needs a key', r.status === 400);
  r = await aiPost({ action: 'set_ai_model', provider: 'compatible', model: 'm', api_key: aiKey });
  ok('a compatible server needs a base URL', r.status === 400);
  r = await aiPost({ action: 'set_ai_model', provider: 'compatible', model: 'e2e-model', base_url: aiBase + '/', api_key: aiKey, embedding_model: 'e2e-embed' });
  const savedText = await r.text();
  ok('admin saves the AI model', r.status === 200, savedText);
  ok('the save answer has no key', !savedText.includes(aiKey) && JSON.parse(savedText).ai_model?.key_last4 === 'ABCD');
  r = await req('GET', '/api/admin/settings', { cookies: adminJar });
  const settingsText = await r.text();
  const aiView = JSON.parse(settingsText).ai_model;
  ok('settings show only that a key is set and its last 4', aiView?.key_set === true && aiView.key_last4 === 'ABCD' && !settingsText.includes(aiKey) && !('api_key' in aiView));
  ok('settings show the model and base URL', aiView?.model === 'e2e-model' && aiView.base_url === aiBase && aiView.embedding_model === 'e2e-embed');
  r = await req('GET', '/api/admin/settings', { cookies: apJar });
  ok('a non-admin can\'t read the settings', r.status === 403);
  r = await aiPost({ action: 'set_ai_model', provider: 'openai', model: 'x', api_key: 'sk-evil' }, apJar);
  ok('a non-admin can\'t change the AI model', r.status === 403);
  r = await req('GET', '/api/admin/settings');
  ok('signed out can\'t read the settings', r.status === 403);
  const pg3 = (await import('pg')).default;
  const pool3 = new pg3.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5499/synergydb', max: 1 });
  const storedAi = JSON.stringify((await pool3.query(`SELECT value FROM sa_settings WHERE key = 'ai_model'`)).rows[0]?.value ?? null);
  await pool3.end();
  ok('the key is stored encrypted', storedAi.includes('enc:v1:') && !storedAi.includes(aiKey));
  ok('internal settings refused without the secret', (await internalAi()).status === 403);
  ok('internal settings refused with a wrong secret', (await internalAi('wrong-secret')).status === 403);
  if (secret) {
    r = await internalAi(secret);
    const inner = (await r.json()).settings;
    ok('apps on the internal network get the decrypted key', r.status === 200 && inner?.api_key === aiKey && inner.provider === 'openai' && inner.model === 'e2e-model' && inner.base_url === aiBase);
  } else {
    console.log('  SKIP  internal settings with the secret (set PROXY_SHARED_SECRET for the server and this test)');
  }
  r = await aiPost({ action: 'test_ai_model', provider: 'compatible', model: 'e2e-model', base_url: aiBase });
  let t = await r.json();
  ok('Test makes one real call with the saved key', t.ok === true && t.reply === 'OK' && aiSeen.at(-1)?.auth === `Bearer ${aiKey}` && aiSeen.at(-1)?.path === '/v1/chat/completions');
  r = await aiPost({ action: 'test_ai_model', provider: 'compatible', model: 'e2e-model', base_url: aiBase, api_key: 'sk-wrong-key-0000' });
  t = await r.json();
  ok('Test reports the provider\'s error', t.ok === false && t.error.includes('401') && t.error.includes('Incorrect API key provided') && !t.error.includes('sk-wrong-key-0000'));
  r = await aiPost({ action: 'set_ai_model', provider: 'compatible', model: 'e2e-model-2', base_url: aiBase });
  if (secret) ok('saving without a new key keeps the saved one', (await (await internalAi(secret)).json()).settings?.api_key === aiKey);
  r = await req('GET', '/api/admin/audit', { cookies: adminJar });
  const auditText = await r.text();
  ok('AI model changes are audited without the key', auditText.includes('admin.ai_model_set') && auditText.includes('admin.ai_model_tested') && !auditText.includes(aiKey) && !auditText.includes('sk-wrong-key-0000'));
  r = await aiPost({ action: 'clear_ai_model' });
  ok('admin clears the AI model', r.status === 200);
  r = await req('GET', '/api/admin/settings', { cookies: adminJar });
  ok('cleared', (await r.json()).ai_model === null);
  if (secret) ok('apps are told nothing is saved', (await (await internalAi(secret)).json()).settings === null);
  fakeAi.close();

  console.log('== Suite header launcher ==');
  // The password reset above ended that person's sessions.
  await req('POST', '/api/auth/login', { body: { email: apEmail, password: userPw, return_to: '/account' }, cookies: apJar });
  const launcher = (cookies, origin) => req('GET', '/api/launcher', { cookies, headers: origin ? { origin } : {} });
  const appsPost = (o) => req('POST', '/api/admin/apps', { body: JSON.stringify(o), cookies: adminJar, headers: { 'content-type': 'application/json' } });
  const cat = `E2E ${suffix}`;
  const made = {};
  for (const [slug, extra] of [['open', {}], ['later', {}], ['restricted', { open_to_all: '0' }], ['hidden', {}]]) {
    r = await appsPost({ action: 'create', slug: `e2e-${slug}-${suffix}`, name: `E2E ${slug}`, url: `https://${slug}.e2e.test/`, category: cat, ...extra });
    made[slug] = (await r.json()).id;
  }
  await appsPost({ action: 'update', id: made.open, sort: '900' });
  await appsPost({ action: 'update', id: made.later, sort: '901' });
  await appsPost({ action: 'update', id: made.hidden, disabled: '1' });
  const launcherList = async (cookies) => {
    const body = await (await launcher(cookies)).json();
    return { groups: body.groups ?? [], mine: (body.groups ?? []).find((g) => g.category === cat)?.apps.map((a) => a.name) ?? [] };
  };
  r = await launcher();
  ok('signed out gets no list', r.status === 401 && !(await r.json()).groups);
  let seen = await launcherList(apJar);
  ok('the launcher groups apps by category', seen.groups.every((g) => typeof g.category === 'string' && g.apps.length) && new Set(seen.groups.map((g) => g.category)).size === seen.groups.length);
  ok('suite apps are marked as suite apps', seen.groups.some((g) => g.apps.some((a) => a.slug === 'mail' && a.suite === true)));
  ok('open apps in the admin\'s order; restricted and hidden ones left out', JSON.stringify(seen.mine) === JSON.stringify(['E2E open', 'E2E later']), JSON.stringify(seen.mine));
  ok('an admin isn\'t shown a restricted app they weren\'t granted', !(await launcherList(adminJar)).mine.includes('E2E restricted'));
  await appsPost({ action: 'grant', id: made.restricted, email: apEmail });
  seen = await launcherList(apJar);
  ok('a granted restricted app shows for that person', seen.mine.includes('E2E restricted') && !seen.mine.includes('E2E hidden'));
  ok('linked apps keep their address', seen.groups.flatMap((g) => g.apps).find((a) => a.name === 'E2E open')?.url === 'https://open.e2e.test/');
  r = await launcher(apJar, 'https://evil.example.net');
  ok('no CORS for another site', r.status === 200 && !r.headers.get('access-control-allow-origin'));
  r = await launcher(apJar, 'http://localhost:3080');
  ok('CORS with credentials for a local app in development', r.headers.get('access-control-allow-origin') === 'http://localhost:3080' && r.headers.get('access-control-allow-credentials') === 'true');
  const domain = process.env.SUITE_DOMAIN;
  if (domain) {
    r = await launcher(apJar, `https://chat.${domain}`);
    ok('CORS with credentials for a suite app', r.headers.get('access-control-allow-origin') === `https://chat.${domain}` && r.headers.get('access-control-allow-credentials') === 'true');
    r = await launcher(undefined, `https://chat.${domain}`);
    ok('a suite app can read that you are signed out', r.status === 401 && r.headers.get('access-control-allow-origin') === `https://chat.${domain}`);
    ok('no CORS for plain http under the suite domain', !(await launcher(apJar, `http://chat.${domain}`)).headers.get('access-control-allow-origin'));
    ok('no CORS for a look-alike domain', !(await launcher(apJar, `https://chat.${domain}.evil.test`)).headers.get('access-control-allow-origin'));
    r = await req('OPTIONS', '/api/launcher', { headers: { origin: `https://mail.${domain}`, 'access-control-request-method': 'GET' } });
    ok('preflight answered for a suite app', r.status === 204 && r.headers.get('access-control-allow-origin') === `https://mail.${domain}`);
  } else {
    console.log('  SKIP  CORS for suite origins (set SUITE_DOMAIN for the server and this test)');
  }
  for (const id of Object.values(made)) await appsPost({ action: 'delete', id });

  if (process.env.E2E_PAGER_PORT) {
    console.log('== Approve on your phone ==');
    // Plays the Pager. The server is started with SA_PAGER_URL=http://localhost:<port>,
    // SA_PAGER_TOKEN=$E2E_PAGER_TOKEN and E2E_PUSH_EMAIL (default e2e-push@example.com) in SA_PUSH_MFA_USERS.
    const bearer = process.env.E2E_PAGER_TOKEN ?? '';
    const pushEmail = (process.env.E2E_PUSH_EMAIL ?? 'e2e-push@example.com').toLowerCase();
    const approvals = new Map();
    let pagerDown = false;
    const fakePager = createServer((rq, rs) => {
      let b = '';
      rq.on('data', (c) => (b += c));
      rq.on('end', () => {
        const send = (code, o) => { rs.writeHead(code, { 'content-type': 'application/json' }); rs.end(JSON.stringify(o)); };
        if (rq.headers.authorization !== `Bearer ${bearer}`) return send(401, { error: 'unauthorized' });
        if (pagerDown) return send(503, { error: 'down' });
        if (rq.method === 'POST' && rq.url === '/v1/approvals') {
          const id = approvals.size + 1;
          approvals.set(id, { status: 'pending', body: JSON.parse(b || '{}') });
          return send(200, { id, status: 'pending', new: true });
        }
        const m = (rq.url ?? '').match(/^\/v1\/approvals\/(\d+)\/status/);
        const a = m && approvals.get(Number(m[1]));
        if (!a) return send(404, { error: 'not_found' });
        send(200, { id: Number(m[1]), status: a.status, decided_at: null });
      });
    });
    await new Promise((res) => fakePager.listen(Number(process.env.E2E_PAGER_PORT), res));
    const answers = [];
    const pushPost = async (cookies, o) => {
      const res = await req('POST', '/api/auth/mfa/push', { body: JSON.stringify(o), cookies, headers: { 'content-type': 'application/json' } });
      const text = await res.text();
      answers.push(text + JSON.stringify([...res.headers.entries()]));
      return { status: res.status, body: JSON.parse(text || '{}') };
    };
    const signedIn = async (cookies) => (await req('GET', '/api/account/sessions', { cookies })).status === 200;

    r = await req('POST', '/api/admin/users', {
      body: JSON.stringify({ action: 'create', email: pushEmail, password: userPw, name: 'Push User' }),
      cookies: adminJar, headers: { 'content-type': 'application/json' },
    });
    const pushUser = (await (await req('GET', '/api/admin/users', { cookies: adminJar })).json()).users.find((u) => u.email === pushEmail);
    await req('POST', '/api/admin/users', {
      body: JSON.stringify({ action: 'reset_password', user_id: pushUser.id, password: userPw }),
      cookies: adminJar, headers: { 'content-type': 'application/json' },
    });

    // This person is reused across runs: clear earlier runs' requests so the per-person limit starts afresh.
    const pg4 = (await import('pg')).default;
    const pool4 = new pg4.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5499/synergydb', max: 1 });
    await pool4.query(`DELETE FROM sa_push_approvals WHERE user_id = ${Number(pushUser.id)}`);
    await pool4.end();

    const pJar = jar();
    r = await req('POST', '/api/auth/login', { body: { email: pushEmail, password: userPw, return_to: '/account' }, cookies: pJar });
    ok('a listed user is sent to the MFA step', (r.headers.get('location') ?? '').startsWith('/login/mfa'));
    const before = pJar.header();
    r = await req('GET', '/login/mfa?return_to=%2Faccount', { cookies: pJar });
    ok('the MFA page offers approval on the phone', r.status === 200 && (await r.text()).includes('Approve on your phone'));
    let p = await pushPost(pJar, { action: 'start' });
    ok('the push is sent with a 2-digit number', p.status === 200 && p.body.number >= 10 && p.body.number <= 99);
    ok('the Pager got that number, the title and a 120 s life', approvals.get(1)?.body.match === p.body.number && approvals.get(1)?.body.title === 'Sign-in to Synergy' && approvals.get(1)?.body.ttl_seconds === 120);
    p = await pushPost(pJar, { action: 'check', wait: 0 });
    ok('pending until the phone answers', p.body.status === 'pending' && !(await signedIn(pJar)));
    approvals.get(1).status = 'approved';
    p = await pushPost(pJar, { action: 'check', wait: 0, return_to: '/account' });
    ok('approval signs in', p.body.status === 'approved' && p.body.redirect === '/account' && await signedIn(pJar));
    ok('with a new session cookie', pJar.header() !== before && pJar.header().includes('sa_sess='));

    const dJar = jar();
    await req('POST', '/api/auth/login', { body: { email: pushEmail, password: userPw, return_to: '/account' }, cookies: dJar });
    await pushPost(dJar, { action: 'start' });
    approvals.get(2).status = 'denied';
    p = await pushPost(dJar, { action: 'check', wait: 0 });
    ok('a denial does not sign in', p.body.status === 'denied' && !(await signedIn(dJar)));
    approvals.get(1).status = 'approved';
    p = await pushPost(dJar, { action: 'check', wait: 0, approval_id: 1, status: 'approved' });
    ok('naming another approval does not sign in', p.body.status !== 'approved' && !(await signedIn(dJar)));
    pagerDown = true;
    p = await pushPost(dJar, { action: 'start' });
    ok('Pager down: told to use a code, not signed in', p.status === 503 && p.body.error === 'unavailable' && !(await signedIn(dJar)));

    const totpJar = jar();
    await req('POST', '/api/auth/login', { body: { email: userEmail, password: newPw, return_to: '/account' }, cookies: totpJar });
    r = await req('GET', '/login/mfa?return_to=%2Faccount', { cookies: totpJar });
    ok('people not listed are not offered the push', r.status === 200 && !(await r.text()).includes('Approve on your phone'));
    ok('the Pager token is in no answer', bearer.length > 0 && answers.every((a) => !a.includes(bearer)));
    r = await req('GET', '/api/admin/audit', { cookies: adminJar });
    const pushAudit = await r.text();
    ok('push sign-ins are audited, without the token', pushAudit.includes('mfa.push_sent') && pushAudit.includes('mfa.push_denied') && pushAudit.includes('mfa.push_unavailable') && !pushAudit.includes(bearer));
    fakePager.close();
  } else {
    console.log('  SKIP  approve on your phone (set E2E_PAGER_PORT/E2E_PAGER_TOKEN for the server and this test)');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
