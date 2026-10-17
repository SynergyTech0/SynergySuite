const test = require('node:test');
const assert = require('node:assert');
const { identify, cameThroughGateway, signGuestToken, verifyGuestToken } = require('..');

const dev = { devUser: 'dev@example.com', production: false };

test('reads oauth2-proxy headers from a plain object or a Headers instance', () => {
  assert.deepStrictEqual(identify({ 'x-auth-request-email': 'Jane.Doe@Example.com' }, {}),
    { email: 'jane.doe@example.com', name: 'Jane Doe', subject: 'jane.doe@example.com' });
  const h = new Headers({ 'x-forwarded-email': 'a@b.co', 'x-forwarded-preferred-username': 'Al', 'x-forwarded-user': 'sub-123' });
  assert.deepStrictEqual(identify(h, {}), { email: 'a@b.co', name: 'Al', subject: 'sub-123' });
});

test('never shows the account id as the name', () => {
  assert.deepStrictEqual(identify({ 'x-auth-request-email': 'shane@example.com', 'x-auth-request-user': '3' }, {}),
    { email: 'shane@example.com', name: 'Shane', subject: '3' });
});

test('returns null with no identity and no dev user', () => {
  assert.strictEqual(identify({}, {}), null);
  assert.strictEqual(identify({ 'x-auth-request-email': 'not-an-email' }, {}), null);
});

test('dev fallback and per-request override work outside production only', () => {
  assert.strictEqual(identify({}, dev).email, 'dev@example.com');
  assert.strictEqual(identify({ 'x-dev-user': 'two@example.com' }, dev).email, 'two@example.com');
  assert.strictEqual(identify({}, { ...dev, devOverride: 'q@example.com' }).email, 'q@example.com');
  assert.strictEqual(identify({}, { ...dev, production: true }), null);
});

test('proxy secret blocks requests that bypassed the proxy', () => {
  const opts = { proxySecret: 's3cret' };
  assert.strictEqual(identify({ 'x-auth-request-email': 'a@b.co' }, opts), null);
  assert.strictEqual(identify({ 'x-auth-request-email': 'a@b.co', 'x-proxy-auth-secret': 'wrong!' }, opts), null);
  assert.strictEqual(identify({ 'x-auth-request-email': 'a@b.co', 'x-proxy-auth-secret': 's3cret' }, opts).email, 'a@b.co');
  assert.strictEqual(cameThroughGateway({}, ''), true);
  assert.strictEqual(cameThroughGateway({}, 's3cret'), false);
  assert.strictEqual(cameThroughGateway({ 'x-proxy-auth-secret': 's3cret' }, 's3cret'), true);
});

test('guest tokens round-trip and reject tampering and expiry', () => {
  const t = signGuestToken({ room: 'r1', name: 'Pat' }, 'k');
  assert.strictEqual(verifyGuestToken(t, 'k').room, 'r1');
  assert.strictEqual(verifyGuestToken(t, 'other'), null);
  const [body, mac] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ room: 'r2', exp: 9e9 })).toString('base64url');
  assert.strictEqual(verifyGuestToken(`${forged}.${mac}`, 'k'), null);
  assert.strictEqual(verifyGuestToken(signGuestToken({ room: 'r1' }, 'k', -1), 'k'), null);
  assert.strictEqual(verifyGuestToken('garbage', 'k'), null);
  assert.ok(body);
});
