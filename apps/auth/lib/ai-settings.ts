import { q, now } from './db';
import { encryptSecret, decryptSecret } from './crypto';

/*
 * The suite's AI model, picked in the admin console (Settings > AI model) instead of the
 * server's AI_* environment. Every app reads it through @synergy/ai, which asks
 * GET /api/internal/ai-settings over the internal network and falls back to AI_* when nothing
 * is saved here.
 *
 * The API key is encrypted at rest (lib/crypto, SA_ENCRYPTION_KEY) and never goes back to the
 * browser: the console only learns that a key is set and its last 4 characters.
 */

export type AiProvider = 'anthropic' | 'openai' | 'compatible' | 'ollama';
export const AI_PROVIDERS: AiProvider[] = ['anthropic', 'openai', 'compatible', 'ollama'];

type Stored = {
  provider: AiProvider;
  model: string;
  base_url: string;
  api_key_enc: string;
  key_last4: string;
  embedding_model: string;
  speech_model: string;
  updated_by: string;
  updated_ms: number;
};

/** What the console sees. */
export type AiSettingsView = {
  provider: AiProvider;
  model: string;
  base_url: string;
  key_set: boolean;
  key_last4: string;
  embedding_model: string;
  speech_model: string;
  updated_by: string;
  updated_ms: number;
};

/** What the apps get over the internal network; provider in @synergy/ai's terms. */
export type AiSettingsInternal = {
  provider: 'anthropic' | 'openai' | 'ollama';
  model: string;
  base_url: string;
  api_key: string;
  embedding_model: string;
  speech_model: string;
};

const KEY = 'ai_model';

/** The server each provider reaches when no base URL is given (as in @synergy/ai). */
export const DEFAULT_BASE: Record<AiProvider, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  compatible: '',
  ollama: 'http://localhost:11434/v1',
};

async function read(): Promise<Stored | null> {
  const [row] = await q<{ value: unknown }>(`SELECT value FROM sa_settings WHERE key = $1::text`, [KEY]);
  const v = typeof row?.value === 'string' ? JSON.parse(row.value) : row?.value;
  if (!v || typeof v !== 'object' || !(v as Stored).model) return null;
  return v as Stored;
}

async function write(s: Stored | null): Promise<void> {
  await q(`DELETE FROM sa_settings WHERE key = $1::text`, [KEY]);
  if (s) {
    await q(`INSERT INTO sa_settings (key, value, updated_ms) VALUES ($1::text, $2::jsonb, $3::bigint)`, [KEY, JSON.stringify(s), now()]);
  }
}

export async function getAiSettingsView(): Promise<AiSettingsView | null> {
  const s = await read();
  if (!s) return null;
  return {
    provider: s.provider,
    model: s.model,
    base_url: s.base_url,
    key_set: !!s.api_key_enc,
    key_last4: s.key_last4,
    embedding_model: s.embedding_model,
    speech_model: s.speech_model,
    updated_by: s.updated_by,
    updated_ms: Number(s.updated_ms),
  };
}

export async function getAiSettingsInternal(): Promise<AiSettingsInternal | null> {
  const s = await read();
  if (!s) return null;
  return {
    provider: s.provider === 'compatible' ? 'openai' : s.provider,
    model: s.model,
    base_url: s.base_url,
    api_key: s.api_key_enc ? decryptSecret(s.api_key_enc) ?? '' : '',
    embedding_model: s.embedding_model,
    speech_model: s.speech_model,
  };
}

/** The console's form, checked. `api_key` empty keeps the saved key unless `remove_key` is set. */
export type AiSettingsInput = {
  provider: string;
  model: string;
  base_url: string;
  api_key: string;
  remove_key: boolean;
  embedding_model: string;
  speech_model: string;
};

export function readAiInput(body: URLSearchParams): AiSettingsInput {
  const t = (k: string, max = 300) => (body.get(k) ?? '').trim().slice(0, max);
  return {
    provider: t('provider'),
    model: t('model', 200),
    base_url: t('base_url', 500).replace(/\/+$/, ''),
    api_key: t('api_key', 1000),
    remove_key: body.get('remove_key') === '1' || body.get('remove_key') === 'true',
    embedding_model: t('embedding_model', 200),
    speech_model: t('speech_model', 200),
  };
}

/**
 * The settings to save or test: the form with the saved key filled in when no new one was typed.
 * Returns an error message for the admin instead when the form can't work.
 */
export async function resolveAiInput(i: AiSettingsInput): Promise<{ error: string } | { provider: AiProvider; apiKey: string; input: AiSettingsInput; keyChanged: boolean }> {
  if (!AI_PROVIDERS.includes(i.provider as AiProvider)) return { error: 'Pick a provider' };
  const provider = i.provider as AiProvider;
  if (!i.model) return { error: 'Enter a model' };
  if (i.base_url) {
    let u: URL;
    try { u = new URL(i.base_url); } catch { return { error: 'The base URL is not a valid URL' }; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'The base URL must start with https:// or http://' };
    if (u.username || u.password) return { error: 'Put the key in the API key field, not in the base URL' };
  }
  if (provider === 'compatible' && !i.base_url) return { error: 'An OpenAI-compatible server needs its base URL' };
  const saved = await read();
  const apiKey = i.api_key || (i.remove_key ? '' : saved?.api_key_enc ? decryptSecret(saved.api_key_enc) ?? '' : '');
  // Hosted APIs need a key; a custom or local server may not (as in @synergy/ai).
  if (!apiKey && !i.base_url && (provider === 'anthropic' || provider === 'openai')) return { error: 'Enter the API key' };
  if (provider === 'anthropic' && (i.embedding_model || i.speech_model)) {
    return { error: 'Embedding and speech models need an OpenAI-compatible server; leave them empty for Anthropic' };
  }
  return { provider, apiKey, input: i, keyChanged: !!i.api_key || (i.remove_key && !!saved?.api_key_enc) };
}

export async function saveAiSettings(provider: AiProvider, apiKey: string, i: AiSettingsInput, by: string): Promise<void> {
  await write({
    provider,
    model: i.model,
    base_url: i.base_url,
    api_key_enc: apiKey ? encryptSecret(apiKey) : '',
    key_last4: apiKey ? apiKey.slice(-4) : '',
    embedding_model: i.embedding_model,
    speech_model: i.speech_model,
    updated_by: by,
    updated_ms: now(),
  });
}

export const clearAiSettings = () => write(null);

/**
 * One small real request to the model, so the admin knows the key and model work before the
 * whole suite relies on them. Returns the model's few words, or the provider's error.
 */
export async function testAiModel(provider: AiProvider, apiKey: string, i: AiSettingsInput): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  const base = (i.base_url || DEFAULT_BASE[provider]).replace(/\/+$/, '');
  const prompt = 'Reply with the single word OK.';
  const scrub = (m: string) => (apiKey && apiKey.length >= 8 ? m.split(apiKey).join('[key]') : m).slice(0, 500);
  const call = async (url: string, headers: Record<string, string>, body: unknown) => {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000), cache: 'no-store' });
    const text = await res.text();
    let j: any = null;
    try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, ok: res.ok, j, text };
  };
  const failure = (r: { status: number; j: any; text: string }) =>
    `The server answered ${r.status}: ${scrub(String(r.j?.error?.message ?? r.j?.message ?? r.j?.error ?? r.text) || 'no detail')}`;
  try {
    if (provider === 'anthropic') {
      const r = await call(`${base}/v1/messages`,
        { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        { model: i.model, max_tokens: 16, messages: [{ role: 'user', content: prompt }] });
      if (!r.ok) return { ok: false, error: failure(r) };
      const reply = (r.j?.content ?? []).filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('');
      return { ok: true, reply: scrub(String(reply).trim()) };
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const body = { model: i.model, max_tokens: 16, messages: [{ role: 'user', content: prompt }] };
    let r = await call(`${base}/chat/completions`, headers, body);
    // Newer OpenAI models take max_completion_tokens instead of max_tokens.
    if (r.status === 400 && /max_tokens/.test(r.text)) {
      const { max_tokens, ...rest } = body;
      r = await call(`${base}/chat/completions`, headers, { ...rest, max_completion_tokens: max_tokens });
    }
    if (!r.ok) return { ok: false, error: failure(r) };
    return { ok: true, reply: scrub(String(r.j?.choices?.[0]?.message?.content ?? '').trim()) };
  } catch (e) {
    return { ok: false, error: `Couldn't reach ${new URL(base).origin}: ${scrub((e as Error).message)}` };
  }
}
