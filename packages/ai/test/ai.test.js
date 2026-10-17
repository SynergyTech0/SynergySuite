const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { aiConfig, isAiConfigured, chat, structured, embed, parseJsonAnswer, AiUnavailableError } = require('..');

// A fake AI server that records requests and answers like OpenAI or Anthropic would.
function fakeServer(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const r = { path: req.url, headers: req.headers, body: JSON.parse(body || '{}') };
      seen.push(r);
      const { status = 200, json } = handler(r, seen.length);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ seen, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() });
  }));
}

test('config: nothing configured means AI is off', () => {
  assert.strictEqual(aiConfig({ env: {} }), null);
  assert.strictEqual(isAiConfigured({ env: {} }), false);
  // A hosted provider without a key is not usable.
  assert.strictEqual(aiConfig({ env: { AI_MODEL: 'gpt-4.1-mini' } }), null);
});

test('config: OpenAI-compatible server, Ollama, prefixes and legacy names', () => {
  assert.deepStrictEqual(aiConfig({ env: { AI_MODEL: 'm', AI_BASE_URL: 'http://vllm:8000/v1/' } }),
    { provider: 'openai', baseUrl: 'http://vllm:8000/v1', apiKey: '', model: 'm', timeoutMs: 120000 });
  assert.strictEqual(aiConfig({ env: { AI_PROVIDER: 'ollama', AI_MODEL: 'llama3.1' } }).baseUrl, 'http://localhost:11434/v1');
  const env = { AI_MODEL: 'cheap', AI_API_KEY: 'k', SIGN_AI_MODEL: 'vision' };
  assert.strictEqual(aiConfig({ env }).model, 'cheap');
  assert.strictEqual(aiConfig({ env, prefix: 'SIGN_' }).model, 'vision');
  assert.strictEqual(aiConfig({ env, prefix: 'SIGN_' }).apiKey, 'k');
  const legacy = aiConfig({ env: { ANTHROPIC_API_KEY: 'a', ANTHROPIC_MODEL: 'old' } });
  assert.strictEqual(legacy.provider, 'anthropic');
  assert.strictEqual(legacy.model, 'old');
  assert.throws(() => aiConfig({ env: { AI_PROVIDER: 'nope', AI_MODEL: 'm' } }), AiUnavailableError);
});

test('chat refuses to run without a model', async () => {
  await assert.rejects(chat({ prompt: 'hi', config: null }), AiUnavailableError);
});

test('OpenAI-compatible: chat sends system, prompt, images and key', async () => {
  const s = await fakeServer(() => ({ json: { choices: [{ message: { content: 'hello' } }] } }));
  try {
    const config = aiConfig({ env: { AI_MODEL: 'm', AI_BASE_URL: s.url, AI_API_KEY: 'k' } });
    const out = await chat({ config, system: 'be brief', prompt: 'hi', images: [{ caption: 'p1', base64: 'AAA' }] });
    assert.strictEqual(out, 'hello');
    const r = s.seen[0];
    assert.strictEqual(r.path, '/chat/completions');
    assert.strictEqual(r.headers.authorization, 'Bearer k');
    assert.deepStrictEqual(r.body.messages[0], { role: 'system', content: 'be brief' });
    assert.deepStrictEqual(r.body.messages[1].content[2], { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } });
  } finally { s.close(); }
});

test('OpenAI-compatible: structured forces the tool, falls back when forcing is refused, and accepts JSON text', async () => {
  const s = await fakeServer((r, n) => {
    if (n === 1) return { status: 400, json: { error: { message: 'tool_choice is not supported' } } };
    if (n === 2) return { json: { choices: [{ message: { tool_calls: [{ function: { name: 'record', arguments: '{"a":1}' } }] } }] } };
    return { json: { choices: [{ message: { content: 'Sure:\n```json\n{"a":2}\n```' } }] } };
  });
  try {
    const config = aiConfig({ env: { AI_MODEL: 'local', AI_BASE_URL: s.url } });
    const args = { config, prompt: 'x', toolName: 'record', toolDescription: 'd', schema: { type: 'object' } };
    assert.deepStrictEqual(await structured(args), { a: 1 });
    assert.deepStrictEqual(s.seen[0].body.tool_choice, { type: 'function', function: { name: 'record' } });
    assert.strictEqual(s.seen[1].body.tool_choice, 'auto');
    assert.strictEqual(s.seen[1].headers.authorization, undefined); // local server, no key
    // Remembered: the next call goes straight to the unforced form, and prose JSON is accepted.
    assert.deepStrictEqual(await structured(args), { a: 2 });
    assert.strictEqual(s.seen[2].body.tool_choice, 'auto');
  } finally { s.close(); }
});

test('OpenAI: retries with max_completion_tokens when max_tokens is rejected', async () => {
  const s = await fakeServer((r, n) => n === 1
    ? { status: 400, json: { error: { message: "Unsupported parameter: 'max_tokens'" } } }
    : { json: { choices: [{ message: { content: 'ok' } }] } });
  try {
    const config = aiConfig({ env: { AI_MODEL: 'm', AI_BASE_URL: s.url } });
    assert.strictEqual(await chat({ config, prompt: 'hi', maxTokens: 10 }), 'ok');
    assert.strictEqual(s.seen[1].body.max_completion_tokens, 10);
    assert.strictEqual('max_tokens' in s.seen[1].body, false);
  } finally { s.close(); }
});

test('Anthropic: structured returns the tool input', async () => {
  const s = await fakeServer(() => ({ json: { content: [{ type: 'tool_use', name: 'record', input: { b: 3 } }] } }));
  try {
    const config = aiConfig({ env: { AI_PROVIDER: 'anthropic', AI_MODEL: 'm', AI_API_KEY: 'k', AI_BASE_URL: s.url } });
    const out = await structured({ config, system: 'sys', prompt: 'x', images: [{ base64: 'BBB' }], toolName: 'record', toolDescription: 'd', schema: {} });
    assert.deepStrictEqual(out, { b: 3 });
    const r = s.seen[0];
    assert.strictEqual(r.path, '/v1/messages');
    assert.strictEqual(r.headers['x-api-key'], 'k');
    assert.strictEqual(r.body.system, 'sys');
    assert.deepStrictEqual(r.body.tool_choice, { type: 'tool', name: 'record' });
    assert.strictEqual(r.body.messages[0].content[1].source.data, 'BBB');
  } finally { s.close(); }
});

test('server errors surface with their status', async () => {
  const s = await fakeServer(() => ({ status: 401, json: { error: { message: 'bad key' } } }));
  try {
    const config = aiConfig({ env: { AI_MODEL: 'm', AI_BASE_URL: s.url } });
    await assert.rejects(chat({ config, prompt: 'hi' }), (e) => e.status === 401 && /bad key/.test(e.message));
  } finally { s.close(); }
});

test('parseJsonAnswer rejects prose', () => {
  assert.throws(() => parseJsonAnswer('no json here'));
  assert.deepStrictEqual(parseJsonAnswer('{"x":[1]}'), { x: [1] });
});

test('embed uses AI_EMBEDDING_MODEL on the same server, in input order', async () => {
  const s = await fakeServer(() => ({ json: { data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }] } }));
  try {
    const env = { AI_MODEL: 'chat', AI_EMBEDDING_MODEL: 'emb', AI_BASE_URL: s.url };
    assert.deepStrictEqual(await embed(['a', 'b'], { env }), [[1], [2]]);
    assert.strictEqual(s.seen[0].path, '/embeddings');
    assert.strictEqual(s.seen[0].body.model, 'emb');
    await assert.rejects(embed(['a'], { env: { AI_MODEL: 'chat', AI_BASE_URL: s.url } }), AiUnavailableError);
  } finally { s.close(); }
});

test('relay: forwards a browser-built request with the configured model and key', async () => {
  const { relay, AiUnavailableError: Unavailable } = require('..');
  const srv = await fakeServer(() => ({ json: { id: 'msg', content: [] } }));
  try {
    const config = { provider: 'anthropic', baseUrl: srv.url, apiKey: 'server-key', model: 'configured', timeoutMs: 5000 };
    const res = await relay({ model: 'whatever-the-browser-said', messages: [] }, {
      config, protocol: 'anthropic', headers: { 'anthropic-beta': 'b1', 'anthropic-version': '2023-06-01' },
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { id: 'msg', content: [] });
    const r = srv.seen[0];
    assert.strictEqual(r.path, '/v1/messages');
    assert.strictEqual(r.body.model, 'configured');
    assert.strictEqual(r.headers['x-api-key'], 'server-key');
    assert.strictEqual(r.headers['anthropic-beta'], 'b1');

    const openaiCfg = { provider: 'ollama', baseUrl: srv.url, apiKey: '', model: 'llama', timeoutMs: 5000 };
    await relay({ messages: [], stream: true }, { config: openaiCfg, protocol: 'openai' });
    assert.strictEqual(srv.seen[1].path, '/chat/completions');
    assert.strictEqual(srv.seen[1].body.model, 'llama');
    assert.strictEqual(srv.seen[1].headers.authorization, undefined);

    await assert.rejects(relay({}, { config, protocol: 'openai' }), Unavailable);
    await assert.rejects(relay({}, { config: null, protocol: 'openai' }), Unavailable);
  } finally {
    srv.close();
  }
});

test('transcribe: speech goes to /audio/transcriptions as a form with the speech model', async () => {
  const { transcribe, speechConfig } = require('..');
  assert.strictEqual(speechConfig({ env: { AI_MODEL: 'gpt-4.1-mini', AI_API_KEY: 'k' } }), null);
  assert.strictEqual(speechConfig({ env: { AI_PROVIDER: 'anthropic', AI_SPEECH_MODEL: 'w', AI_API_KEY: 'k' } }), null);
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('latin1') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: ' hello world ' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const env = { AI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, AI_SPEECH_MODEL: 'whisper-1', AI_API_KEY: 'sk-test' };
    assert.ok(speechConfig({ env }));
    const text = await transcribe(new Uint8Array([1, 2, 3]), { mime: 'audio/webm', language: 'de-DE', env });
    assert.strictEqual(text, 'hello world');
    assert.strictEqual(seen[0].path, '/v1/audio/transcriptions');
    assert.strictEqual(seen[0].headers.authorization, 'Bearer sk-test');
    assert.match(seen[0].headers['content-type'], /^multipart\/form-data; boundary=/);
    assert.match(seen[0].body, /name="model"\r\n\r\nwhisper-1/);
    assert.match(seen[0].body, /name="language"\r\n\r\nde\r\n/);
    assert.match(seen[0].body, /name="file"; filename="speech.webm"/);
  } finally {
    server.close();
  }
  await assert.rejects(transcribe(new Uint8Array([1]), { env: {} }), AiUnavailableError);
});

// ---- settings from the admin console ----

// Plays auth's internal endpoint: answers only callers with the shared secret.
async function fakeAuth(settings, secret = 'svc-secret') {
  const state = { settings, hits: 0, refused: 0 };
  const server = http.createServer((req, res) => {
    if (req.url !== '/api/internal/ai-settings' || req.headers['x-proxy-auth-secret'] !== secret) {
      state.refused++;
      res.writeHead(403, { 'content-type': 'application/json' });
      return res.end('{"error":"forbidden"}');
    }
    state.hits++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ settings: state.settings }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { state, url, env: { AUTH_INTERNAL_URL: url, PROXY_SHARED_SECRET: secret }, close: () => new Promise((r) => server.close(r)) };
}

const ADMIN = { provider: 'anthropic', model: 'admin-model', api_key: 'sk-admin', base_url: '', embedding_model: '', speech_model: '' };

test('admin settings: saved in the console, they win over the AI_* environment', async () => {
  const { loadAiConfig, isAiAvailable, clearAiSettingsCache } = require('..');
  clearAiSettingsCache();
  const auth = await fakeAuth(ADMIN);
  try {
    const env = { ...auth.env, AI_PROVIDER: 'openai', AI_MODEL: 'env-model', AI_API_KEY: 'sk-env', AI_BASE_URL: 'http://vllm:8000/v1' };
    const cfg = await loadAiConfig({ env });
    // The whole unprefixed set is replaced: no OpenAI base URL leaks into the Anthropic settings.
    assert.deepStrictEqual(cfg, { provider: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'sk-admin', model: 'admin-model', timeoutMs: 120000 });
    // With no AI_* environment at all, the saved settings alone turn AI on.
    assert.strictEqual(await isAiAvailable({ env: auth.env }), true);
  } finally {
    await auth.close();
  }
});

test('admin settings: an app\'s prefixed environment overrides still win for that app', async () => {
  const { loadAiConfig, clearAiSettingsCache } = require('..');
  clearAiSettingsCache();
  const auth = await fakeAuth(ADMIN);
  try {
    const env = { ...auth.env, SIGN_AI_MODEL: 'sign-model' };
    assert.strictEqual((await loadAiConfig({ env, prefix: 'SIGN_' })).model, 'sign-model');
    assert.strictEqual((await loadAiConfig({ env, prefix: 'SIGN_' })).apiKey, 'sk-admin');
    assert.strictEqual((await loadAiConfig({ env, prefix: 'CRM_' })).model, 'admin-model');
  } finally {
    await auth.close();
  }
});

test('admin settings: nothing saved means the environment', async () => {
  const { loadAiConfig, clearAiSettingsCache } = require('..');
  clearAiSettingsCache();
  const auth = await fakeAuth(null);
  try {
    const cfg = await loadAiConfig({ env: { ...auth.env, AI_MODEL: 'env-model', AI_API_KEY: 'sk-env' } });
    assert.strictEqual(cfg.model, 'env-model');
    assert.strictEqual(cfg.apiKey, 'sk-env');
    assert.strictEqual(await loadAiConfig({ env: auth.env }), null);
  } finally {
    await auth.close();
  }
});

test('admin settings: cached for AI_SETTINGS_CACHE_MS, then asked again', async () => {
  const { loadAiConfig, clearAiSettingsCache } = require('..');
  clearAiSettingsCache();
  const auth = await fakeAuth(ADMIN);
  try {
    const env = { ...auth.env, AI_SETTINGS_CACHE_MS: '150' };
    await Promise.all([loadAiConfig({ env }), loadAiConfig({ env }), loadAiConfig({ env })]);
    assert.strictEqual(auth.state.hits, 1, 'concurrent callers share one request');
    auth.state.settings = { ...ADMIN, model: 'newer-model' };
    assert.strictEqual((await loadAiConfig({ env })).model, 'admin-model', 'still cached');
    assert.strictEqual(auth.state.hits, 1);
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual((await loadAiConfig({ env })).model, 'newer-model', 'a change shows up once the cache expires');
    assert.strictEqual(auth.state.hits, 2);
  } finally {
    await auth.close();
  }
});

test('admin settings: auth down falls back to the environment, or keeps the last settings it had', async () => {
  const { loadAiConfig, clearAiSettingsCache } = require('..');
  clearAiSettingsCache();
  const envOnly = { AI_MODEL: 'env-model', AI_API_KEY: 'sk-env' };
  // Nothing listens on port 9: never fetched, so the environment is used.
  const down = { ...envOnly, AUTH_INTERNAL_URL: 'http://127.0.0.1:9', PROXY_SHARED_SECRET: 's' };
  assert.strictEqual((await loadAiConfig({ env: down })).model, 'env-model');

  const auth = await fakeAuth(ADMIN);
  const env = { ...auth.env, ...envOnly, AI_SETTINGS_CACHE_MS: '0' };
  assert.strictEqual((await loadAiConfig({ env })).model, 'admin-model');
  await auth.close();
  assert.strictEqual((await loadAiConfig({ env })).model, 'admin-model', 'a blip at auth does not switch models');
});

test('admin settings: a wrong secret is refused and the environment is used', async () => {
  const { loadAiConfig, clearAiSettingsCache } = require('..');
  clearAiSettingsCache();
  const auth = await fakeAuth(ADMIN, 'right');
  try {
    const cfg = await loadAiConfig({ env: { ...auth.env, PROXY_SHARED_SECRET: 'wrong', AI_MODEL: 'env-model', AI_API_KEY: 'k' } });
    assert.strictEqual(cfg.model, 'env-model');
    assert.strictEqual(auth.state.refused, 1);
    // No secret: auth isn't asked at all.
    await loadAiConfig({ env: { AUTH_INTERNAL_URL: auth.url, AI_MODEL: 'env-model', AI_API_KEY: 'k' } });
    assert.strictEqual(auth.state.refused + auth.state.hits, 1);
  } finally {
    await auth.close();
  }
});

test('admin settings: chat, embed and speech use them when no config is passed', async () => {
  const { loadSpeechConfig, embed, clearAiSettingsCache } = require('..');
  clearAiSettingsCache();
  const ai = await fakeServer((r) => (r.path === '/embeddings'
    ? { json: { data: [{ index: 0, embedding: [1, 2] }] } }
    : { json: { choices: [{ message: { content: 'from admin' } }] } }));
  const auth = await fakeAuth({ provider: 'openai', model: 'm', api_key: 'sk-admin', base_url: ai.url, embedding_model: 'e', speech_model: 'w' });
  const saved = { ...process.env };
  try {
    Object.assign(process.env, auth.env);
    delete process.env.AI_MODEL;
    assert.strictEqual(await chat({ prompt: 'hi' }), 'from admin');
    assert.strictEqual(ai.seen[0].headers.authorization, 'Bearer sk-admin');
    assert.strictEqual(ai.seen[0].body.model, 'm');
    assert.deepStrictEqual(await embed(['x']), [[1, 2]]);
    assert.strictEqual(ai.seen[1].body.model, 'e');
    assert.strictEqual((await loadSpeechConfig()).model, 'w');
    // The sync aiConfig sees what was fetched.
    assert.strictEqual(aiConfig().model, 'm');
  } finally {
    process.env = saved;
    ai.close();
    await auth.close();
    clearAiSettingsCache();
  }
});
