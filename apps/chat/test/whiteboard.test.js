const test = require('node:test');
const assert = require('node:assert');
const { channelBoard, whiteboardUrl, boardTitle } = require('../server/whiteboard');

test('asks Whiteboard for the channel board as the suite server', async () => {
  let call;
  const fakeFetch = async (url, init) => {
    call = { url, init };
    return new Response(JSON.stringify({ id: 'b1', url: 'https://whiteboard.example.com/b/b1', created: true }));
  };
  const out = await channelBoard({ id: 7, kind: 'public', name: 'design' }, 'a@x.com', ['a@x.com', 'b@x.com'],
    { env: { NODE_ENV: 'production', PROXY_SHARED_SECRET: 's' }, fetch: fakeFetch });
  assert.deepStrictEqual(out, { id: 'b1', url: 'https://whiteboard.example.com/b/b1', created: true });
  assert.strictEqual(call.url, 'http://whiteboard:3750/api/svc/boards');
  assert.strictEqual(call.init.headers['x-proxy-auth-secret'], 's');
  assert.deepStrictEqual(JSON.parse(call.init.body), { source: 'chat:7', title: '#design whiteboard', owner: 'a@x.com', people: ['a@x.com', 'b@x.com'] });
});

test('says why when Whiteboard refuses or is down', async () => {
  await assert.rejects(channelBoard({ id: 1, kind: 'dm' }, 'a@x.com', [], { env: {}, fetch: async () => new Response('{"error":"Bad source"}', { status: 400 }) }), /Bad source/);
  await assert.rejects(channelBoard({ id: 1, kind: 'dm' }, 'a@x.com', [], { env: {}, fetch: async () => { throw new TypeError('fetch failed'); } }), /Could not reach/);
  assert.strictEqual(boardTitle({ kind: 'dm' }), 'Chat whiteboard');
  assert.strictEqual(whiteboardUrl({ WHITEBOARD_INTERNAL_URL: 'http://wb:9/' }), 'http://wb:9');
});
