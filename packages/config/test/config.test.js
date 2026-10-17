const test = require('node:test');
const assert = require('node:assert');
const { apps, getApp, portFor, appUrl, env } = require('..');

test('every app has a unique id and port', () => {
  assert.strictEqual(new Set(apps.map((a) => a.id)).size, apps.length);
  assert.strictEqual(new Set(apps.map((a) => a.port)).size, apps.length);
});

test('portFor prefers $PORT and falls back to the registry', () => {
  assert.strictEqual(portFor('chat', {}), 3080);
  assert.strictEqual(portFor('chat', { PORT: '9999' }), 9999);
  assert.strictEqual(portFor('chat', { PORT: 'nope' }), 3080);
});

test('appUrl uses SUITE_DOMAIN when set', () => {
  assert.strictEqual(appUrl('calendar', {}), 'http://localhost:3130');
  assert.strictEqual(appUrl('calendar', { SUITE_DOMAIN: 'example.org' }), 'https://calendar.example.org');
  assert.throws(() => getApp('nope'));
});

test('env only enforces required variables in production', () => {
  assert.strictEqual(env('X', { default: 'd' }, {}), 'd');
  assert.strictEqual(env('X', { required: true }, {}), '');
  assert.throws(() => env('X', { required: true }, { NODE_ENV: 'production' }));
  assert.strictEqual(env('X', { required: true }, { NODE_ENV: 'production', X: 'v' }), 'v');
});

test("Account's Hub list matches the registry", () => {
  // apps/auth builds on its own, so it keeps a copy (lib/suite-apps.json) for its Hub tiles.
  const hub = require('../../../apps/auth/lib/suite-apps.json');
  const want = apps.filter((a) => a.id !== 'auth').map((a) => `${a.id}:${a.port}:${a.name}`);
  assert.deepStrictEqual(hub.map((a) => `${a.id}:${a.port}:${a.name}`), want);
});
