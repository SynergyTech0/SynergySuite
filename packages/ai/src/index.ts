/**
 * Bring your own AI model. Every suite feature that uses AI goes through this package, so an
 * administrator picks the provider and model once and the whole suite follows.
 *
 * The normal place to pick it is the sign-in app's admin console (Settings > AI model). Apps fetch
 * those settings from auth over the internal network (see "Settings from the admin console" below)
 * and use them ahead of the AI_* environment variables, which remain the fallback:
 *
 *   AI_PROVIDER   openai (default; any OpenAI-compatible server), anthropic, or ollama
 *   AI_BASE_URL   server address. Defaults: https://api.openai.com/v1, https://api.anthropic.com,
 *                 http://localhost:11434/v1 for ollama. Point it at vLLM, LM Studio, OpenRouter,
 *                 Azure OpenAI, Groq or anything else that speaks the OpenAI chat API.
 *   AI_API_KEY    key for the server (local servers usually need none)
 *   AI_MODEL      model ID, e.g. gpt-4.1-mini, llama3.1, or a model name from your provider
 *   AI_EMBEDDING_MODEL  model for search embeddings (OpenAI-compatible servers only), e.g.
 *                 text-embedding-3-small or nomic-embed-text
 *   AI_SPEECH_MODEL  model for speech to text (OpenAI-compatible /audio/transcriptions), e.g.
 *                 whisper-1 or Systran/faster-whisper-small
 *
 * A feature can use a different model from the rest of the suite with prefixed settings, e.g.
 * SIGN_AI_MODEL (pass { prefix: "SIGN_" }). Unset prefixed values fall back to the AI_* ones.
 *
 * Nothing here invents an answer: if no model is configured, calls throw AiUnavailableError and
 * the feature should say AI is off.
 *
 * Call loadAiConfig() / isAiAvailable() (async) to decide whether AI is on: they include the
 * admin console's settings, so a key saved there turns AI on everywhere without a restart. The
 * sync aiConfig() reads the environment plus whatever admin settings were last fetched.
 */

export type Provider = "openai" | "anthropic" | "ollama";

export interface AiConfig {
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Per-request timeout in milliseconds (AI_TIMEOUT_MS, default 120000). */
  timeoutMs: number;
}

export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export class AiRequestError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "AiRequestError";
  }
}

type Env = Record<string, string | undefined>;

const DEFAULT_BASE: Record<Provider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  ollama: "http://localhost:11434/v1",
};

/**
 * Reads the AI settings. Returns null when no model is configured. The older ANTHROPIC_API_KEY /
 * ANTHROPIC_MODEL names are still read so existing sign deployments keep working.
 *
 * Without `env`, this is the environment plus the admin console's settings as last fetched (it
 * never waits for auth, but starts a refresh when they are stale); prefer loadAiConfig().
 */
export function aiConfig(opts: { prefix?: string; env?: Env } = {}): AiConfig | null {
  const env = opts.env ?? withAdminSettings(process.env, peekAdminSettings(process.env));
  const p = opts.prefix ?? "";
  const get = (k: string) => (p && env[`${p}${k}`]) || env[k] || "";

  const legacyAnthropic = !get("AI_PROVIDER") && !get("AI_API_KEY") && !!env.ANTHROPIC_API_KEY;
  const provider = (get("AI_PROVIDER") || (legacyAnthropic ? "anthropic" : "openai")).toLowerCase() as Provider;
  if (!(provider in DEFAULT_BASE)) {
    throw new AiUnavailableError(`AI_PROVIDER must be openai, anthropic or ollama (got "${provider}")`);
  }
  const model = get("AI_MODEL") || (legacyAnthropic ? env.ANTHROPIC_MODEL || "" : "");
  if (!model) return null;
  const apiKey = get("AI_API_KEY") || (provider === "anthropic" ? env.ANTHROPIC_API_KEY || "" : "");
  const baseUrl = (get("AI_BASE_URL") || DEFAULT_BASE[provider]).replace(/\/+$/, "");
  // Hosted APIs need a key; a custom or local server may not.
  if (!apiKey && !get("AI_BASE_URL") && provider !== "ollama") return null;
  return { provider, baseUrl, apiKey, model, timeoutMs: Number(get("AI_TIMEOUT_MS")) || 120_000 };
}

export function isAiConfigured(opts: { prefix?: string; env?: Env } = {}): boolean {
  try {
    return aiConfig(opts) !== null;
  } catch {
    return false;
  }
}

// ---- settings from the admin console -----------------------------------------------------------

/**
 * The model an administrator saved in the sign-in app's admin console. Apps fetch it from
 * GET <AUTH_INTERNAL_URL>/api/internal/ai-settings with PROXY_SHARED_SECRET (the gateway never
 * passes /api/internal/ through), and keep it for AI_SETTINGS_CACHE_MS (default 60 s). Auth is
 * http://auth:3500 in production when AUTH_INTERNAL_URL isn't set; without the secret, or outside
 * production without AUTH_INTERNAL_URL, only the environment is used.
 *
 * Saved settings replace the unprefixed AI_* variables as a whole (a saved Anthropic model never
 * picks up an OpenAI base URL from the environment). Prefixed ones (SIGN_AI_MODEL and so on) still
 * win for their app. When auth can't be reached, the last settings fetched stay in use; before
 * the first successful fetch that means the environment.
 */
export interface AdminAiSettings {
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  model: string;
  embeddingModel: string;
  speechModel: string;
}

type CachedSettings = { settings: AdminAiSettings | null; until: number };

const DEFAULT_SETTINGS_TTL = 60_000;
/** After a failed fetch, try again sooner than the full TTL so a restarted auth is noticed. */
const RETRY_AFTER_FAILURE = 10_000;
const settingsCache = new Map<string, CachedSettings>();
const settingsInflight = new Map<string, Promise<AdminAiSettings | null>>();

/** Where this app reads the admin settings from, or null when it doesn't. */
function settingsSource(env: Env): { url: string; secret: string } | null {
  const secret = env.PROXY_SHARED_SECRET || "";
  const base = env.AUTH_INTERNAL_URL || (env.NODE_ENV === "production" ? "http://auth:3500" : "");
  if (!secret || !base) return null;
  return { url: `${base.replace(/\/+$/, "")}/api/internal/ai-settings`, secret };
}

function parseAdminSettings(v: unknown): AdminAiSettings | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  const provider = str("provider").toLowerCase();
  if (!(provider in DEFAULT_BASE) || !str("model")) return null;
  return {
    provider: provider as Provider,
    baseUrl: str("base_url"),
    apiKey: str("api_key"),
    model: str("model"),
    embeddingModel: str("embedding_model"),
    speechModel: str("speech_model"),
  };
}

async function fetchAdminSettings(src: { url: string; secret: string }, prev: CachedSettings | undefined, ttl: number) {
  try {
    const res = await fetch(src.url, { headers: { "x-proxy-auth-secret": src.secret }, signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`auth answered ${res.status}`);
    const body = (await res.json()) as { settings?: unknown };
    const settings = parseAdminSettings(body?.settings);
    settingsCache.set(src.url, { settings, until: Date.now() + ttl });
    return settings;
  } catch {
    const settings = prev?.settings ?? null;
    settingsCache.set(src.url, { settings, until: Date.now() + Math.min(ttl, RETRY_AFTER_FAILURE) });
    return settings;
  }
}

/** The admin console's AI settings, from the cache or auth; null when none are saved or auth can't say. */
export async function adminAiSettings(opts: { env?: Env } = {}): Promise<AdminAiSettings | null> {
  const env = opts.env ?? process.env;
  const src = settingsSource(env);
  if (!src) return null;
  const hit = settingsCache.get(src.url);
  if (hit && hit.until > Date.now()) return hit.settings;
  let pending = settingsInflight.get(src.url);
  if (!pending) {
    const set = Number(env.AI_SETTINGS_CACHE_MS);
    const ttl = env.AI_SETTINGS_CACHE_MS && set >= 0 ? set : DEFAULT_SETTINGS_TTL;
    pending = fetchAdminSettings(src, hit, ttl).finally(() => settingsInflight.delete(src.url));
    settingsInflight.set(src.url, pending);
  }
  return pending;
}

/** The last admin settings fetched, without waiting; refreshes them in the background when stale. */
function peekAdminSettings(env: Env): AdminAiSettings | null {
  const src = settingsSource(env);
  if (!src) return null;
  const hit = settingsCache.get(src.url);
  if (!hit || hit.until <= Date.now()) void adminAiSettings({ env }).catch(() => undefined);
  return hit?.settings ?? null;
}

/** Forgets fetched admin settings, so the next call asks auth again. */
export function clearAiSettingsCache(): void {
  settingsCache.clear();
}

/** The unprefixed variables saved admin settings replace. */
const ADMIN_REPLACES = ["AI_PROVIDER", "AI_BASE_URL", "AI_API_KEY", "AI_MODEL", "AI_EMBEDDING_MODEL", "AI_SPEECH_MODEL", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"];

/** `env` with the admin settings in place of its unprefixed AI_* variables. */
export function withAdminSettings(env: Env, s: AdminAiSettings | null): Env {
  if (!s) return env;
  const out: Env = { ...env };
  for (const k of ADMIN_REPLACES) delete out[k];
  out.AI_PROVIDER = s.provider;
  out.AI_MODEL = s.model;
  if (s.baseUrl) out.AI_BASE_URL = s.baseUrl;
  if (s.apiKey) out.AI_API_KEY = s.apiKey;
  if (s.embeddingModel) out.AI_EMBEDDING_MODEL = s.embeddingModel;
  if (s.speechModel) out.AI_SPEECH_MODEL = s.speechModel;
  return out;
}

/** The settings to use: `env` (default process.env) with the admin console's settings applied. */
export async function resolveAiEnv(opts: { env?: Env } = {}): Promise<Env> {
  const env = opts.env ?? process.env;
  return withAdminSettings(env, await adminAiSettings({ env }));
}

/** Like aiConfig, with the admin console's current settings. Null when no model is configured. */
export async function loadAiConfig(opts: { prefix?: string; env?: Env } = {}): Promise<AiConfig | null> {
  return aiConfig({ prefix: opts.prefix, env: await resolveAiEnv({ env: opts.env }) });
}

/** Whether AI is on for this app (admin console settings, else the environment). */
export async function isAiAvailable(opts: { prefix?: string; env?: Env } = {}): Promise<boolean> {
  try {
    return (await loadAiConfig(opts)) !== null;
  } catch {
    return false;
  }
}

/** Like speechConfig, with the admin console's current settings. */
export async function loadSpeechConfig(opts: { prefix?: string; env?: Env } = {}): Promise<AiConfig | null> {
  return speechConfig({ prefix: opts.prefix, env: await resolveAiEnv({ env: opts.env }) });
}

function requireConfig(cfg: AiConfig | null | undefined): AiConfig {
  if (!cfg) throw new AiUnavailableError("No AI model is configured. Set AI_MODEL (and AI_API_KEY or AI_BASE_URL).");
  return cfg;
}

export interface ImagePart {
  /** Text shown to the model just before the image. */
  caption?: string;
  /** Base64 data without the data: prefix. */
  base64: string;
  mediaType?: "image/png" | "image/jpeg" | "image/webp";
}

export interface ChatOptions {
  system?: string;
  prompt: string;
  images?: ImagePart[];
  maxTokens?: number;
  temperature?: number;
  config?: AiConfig | null;
}

/** Plain text answer. */
export async function chat(opts: ChatOptions): Promise<string> {
  const cfg = requireConfig(opts.config === undefined ? await loadAiConfig() : opts.config);
  if (cfg.provider === "anthropic") {
    const res = await anthropic(cfg, { ...base(cfg, opts), messages: [{ role: "user", content: anthropicContent(opts) }] });
    return res.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  }
  const res = await openai(cfg, { ...base(cfg, opts), messages: openaiMessages(opts) });
  return String(res.choices?.[0]?.message?.content ?? "");
}

export interface StructuredOptions extends ChatOptions {
  /** Name and description of the "record your answer" tool the model must call. */
  toolName: string;
  toolDescription: string;
  /** JSON Schema of the answer object. */
  schema: Record<string, unknown>;
}

/**
 * A JSON object matching `schema`, obtained through a forced tool call so the model can't answer
 * in prose. Servers that refuse a forced tool choice are asked again without forcing it; a model
 * that still doesn't call the tool may return the JSON as text, which is accepted if it parses.
 */
export async function structured<T>(opts: StructuredOptions): Promise<T> {
  const cfg = requireConfig(opts.config === undefined ? await loadAiConfig() : opts.config);
  const key = `${cfg.provider} ${cfg.baseUrl} ${cfg.model}`;
  const ask = `${opts.system ?? ""}\n\nRecord your answer by calling the ${opts.toolName} tool. Do not answer in prose.`.trim();

  if (cfg.provider === "anthropic") {
    const req = (forced: boolean) => anthropic(cfg, {
      ...base(cfg, { ...opts, system: forced ? opts.system : ask }),
      tools: [{ name: opts.toolName, description: opts.toolDescription, input_schema: opts.schema }],
      tool_choice: forced ? { type: "tool", name: opts.toolName } : { type: "auto" },
      messages: [{ role: "user", content: anthropicContent(opts) }],
    });
    const res = await withUnforcedFallback(key, req);
    const block = res.content.find((c: any) => c.type === "tool_use");
    if (block) return block.input as T;
    return parseJsonAnswer<T>(res.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(""));
  }

  const req = (forced: boolean) => openai(cfg, {
    ...base(cfg, opts),
    messages: openaiMessages({ ...opts, system: forced ? opts.system : ask }),
    tools: [{ type: "function", function: { name: opts.toolName, description: opts.toolDescription, parameters: opts.schema } }],
    tool_choice: forced ? { type: "function", function: { name: opts.toolName } } : "auto",
  });
  const res = await withUnforcedFallback(key, req);
  const msg = res.choices?.[0]?.message ?? {};
  const call = (msg.tool_calls ?? []).find((t: any) => t?.function?.name === opts.toolName) ?? msg.tool_calls?.[0];
  if (call) {
    const args = call.function?.arguments;
    return (typeof args === "string" ? parseJsonAnswer<T>(args) : args) as T;
  }
  return parseJsonAnswer<T>(String(msg.content ?? ""));
}

/**
 * Embedding vectors for search, one per input, from an OpenAI-compatible /embeddings endpoint.
 * Uses AI_EMBEDDING_MODEL (or <prefix>AI_EMBEDDING_MODEL) with the same server settings.
 */
export async function embed(input: string[], opts: { prefix?: string; env?: Env; config?: AiConfig | null } = {}): Promise<number[][]> {
  const env = await resolveAiEnv({ env: opts.env });
  const p = opts.prefix ?? "";
  const model = (p && env[`${p}AI_EMBEDDING_MODEL`]) || env.AI_EMBEDDING_MODEL || "";
  const cfg = opts.config === undefined ? aiConfig({ prefix: p, env: { ...env, AI_MODEL: model || undefined } }) : opts.config;
  if (!model || !cfg) throw new AiUnavailableError("No embedding model is configured. Set AI_EMBEDDING_MODEL.");
  if (cfg.provider === "anthropic") throw new AiUnavailableError("Embeddings need an OpenAI-compatible server (AI_PROVIDER openai or ollama).");
  if (!input.length) return [];
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  const res = await post(`${cfg.baseUrl}/embeddings`, headers, { model, input }, cfg.timeoutMs);
  return [...res.data].sort((a: any, b: any) => a.index - b.index).map((d: any) => d.embedding);
}

/**
 * The speech-to-text settings: AI_SPEECH_MODEL (or <prefix>AI_SPEECH_MODEL) on the configured
 * server, or null when no speech model is set. Needs an OpenAI-compatible server.
 */
export function speechConfig(opts: { prefix?: string; env?: Env } = {}): AiConfig | null {
  const env = opts.env ?? process.env;
  const p = opts.prefix ?? "";
  const model = (p && env[`${p}AI_SPEECH_MODEL`]) || env.AI_SPEECH_MODEL || "";
  if (!model) return null;
  let cfg: AiConfig | null;
  try {
    cfg = aiConfig({ prefix: p, env: { ...env, AI_MODEL: model, [`${p}AI_MODEL`]: model } });
  } catch {
    return null;
  }
  return cfg && cfg.provider !== "anthropic" ? cfg : null;
}

/**
 * Speech to text from an OpenAI-compatible /audio/transcriptions endpoint (OpenAI, Groq,
 * faster-whisper-server, vLLM, LocalAI and other Whisper servers), with AI_SPEECH_MODEL.
 * `language` is a BCP 47 tag or ISO 639-1 code (only the language part is sent).
 */
export async function transcribe(
  audio: Blob | Uint8Array,
  opts: { mime?: string; filename?: string; language?: string; prompt?: string; prefix?: string; env?: Env; config?: AiConfig | null } = {},
): Promise<string> {
  const cfg = opts.config === undefined ? await loadSpeechConfig({ prefix: opts.prefix, env: opts.env }) : opts.config;
  if (!cfg) throw new AiUnavailableError("No speech model is configured. Set AI_SPEECH_MODEL on an OpenAI-compatible server.");
  if (cfg.provider === "anthropic") throw new AiUnavailableError("Speech to text needs an OpenAI-compatible server (AI_PROVIDER openai or ollama).");
  const mime = opts.mime || (audio instanceof Blob ? audio.type : "") || "audio/webm";
  const blob = audio instanceof Blob ? audio : new Blob([audio as BlobPart], { type: mime });
  const form = new FormData();
  const ext = /mp4|m4a|aac/.test(mime) ? "m4a" : /ogg/.test(mime) ? "ogg" : /wav/.test(mime) ? "wav" : /mpeg|mp3/.test(mime) ? "mp3" : "webm";
  form.append("file", blob, opts.filename || `speech.${ext}`);
  form.append("model", cfg.model);
  form.append("response_format", "json");
  const lang = (opts.language || "").split(/[-_]/)[0].toLowerCase();
  if (/^[a-z]{2,3}$/.test(lang)) form.append("language", lang);
  if (opts.prompt) form.append("prompt", opts.prompt.slice(0, 800));
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  const url = `${cfg.baseUrl}/audio/transcriptions`;
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body: form, signal: AbortSignal.timeout(cfg.timeoutMs) });
  } catch (e) {
    throw new AiRequestError(`AI server unreachable at ${new URL(url).origin}: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) throw new AiRequestError(`AI server returned ${res.status}: ${text.slice(0, 500)}`, res.status);
  try {
    const j = JSON.parse(text);
    return String(j?.text ?? "").trim();
  } catch {
    return text.trim(); // response_format text
  }
}

/** The wire format a provider speaks: Anthropic Messages, or OpenAI chat completions (OpenAI, Ollama and compatible servers). */
export type Protocol = "anthropic" | "openai";

export function protocolOf(cfg: AiConfig): Protocol {
  return cfg.provider === "anthropic" ? "anthropic" : "openai";
}

/** The one request path each protocol relays. */
const RELAY_PATH: Record<Protocol, string> = { anthropic: "/v1/messages", openai: "/chat/completions" };

export interface RelayOptions {
  config?: AiConfig | null;
  /** The client's protocol; it must be the configured provider's. */
  protocol: Protocol;
  /** Anthropic only: the client's anthropic-version and anthropic-beta headers, passed through. */
  headers?: Record<string, string | null | undefined>;
  /** Aborts the upstream request (e.g. when the browser goes away). */
  signal?: AbortSignal;
}

/**
 * Relays a chat request that a browser-side assistant built in its provider's own format (an
 * embedded tool with its own agent loop, such as CAD's 3D modeling assistant) to the configured
 * server. The model is replaced with the configured one and the server's key is added here, so
 * the browser never holds a key or picks a model. The upstream response comes back as is,
 * streaming included; `AI_TIMEOUT_MS` bounds the wait for it to start.
 */
export async function relay(body: Record<string, unknown>, opts: RelayOptions): Promise<Response> {
  const cfg = requireConfig(opts.config === undefined ? await loadAiConfig() : opts.config);
  if (protocolOf(cfg) !== opts.protocol) {
    throw new AiUnavailableError(`The configured AI server speaks the ${protocolOf(cfg)} protocol, not ${opts.protocol}.`);
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.protocol === "anthropic") {
    headers["x-api-key"] = cfg.apiKey;
    headers["anthropic-version"] = opts.headers?.["anthropic-version"] || "2023-06-01";
    const beta = opts.headers?.["anthropic-beta"];
    if (beta) headers["anthropic-beta"] = beta;
  } else if (cfg.apiKey) {
    headers.authorization = `Bearer ${cfg.apiKey}`;
  }
  const url = `${cfg.baseUrl}${RELAY_PATH[opts.protocol]}`;
  const start = new AbortController();
  const timer = setTimeout(() => start.abort(new Error(`no answer within ${cfg.timeoutMs} ms`)), cfg.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, start.signal]) : start.signal;
  try {
    return await fetch(url, { method: "POST", headers, body: JSON.stringify({ ...body, model: cfg.model }), signal });
  } catch (e) {
    throw new AiRequestError(`AI server unreachable at ${new URL(url).origin}: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

// ---- internals -------------------------------------------------------------------------------

/** Models/servers that rejected a forced tool choice, remembered per process. */
const unforced = new Set<string>();

async function withUnforcedFallback(key: string, req: (forced: boolean) => Promise<any>) {
  if (unforced.has(key)) return req(false);
  try {
    return await req(true);
  } catch (e) {
    if (!(e instanceof AiRequestError && e.status === 400 && /tool_choice|tool choice|function/i.test(e.message))) throw e;
    unforced.add(key);
    return req(false);
  }
}

function base(cfg: AiConfig, opts: ChatOptions) {
  const out: Record<string, unknown> = { model: cfg.model, max_tokens: opts.maxTokens ?? 4096 };
  if (opts.temperature !== undefined) out.temperature = opts.temperature;
  if (cfg.provider === "anthropic" && opts.system) out.system = opts.system;
  return out;
}

function anthropicContent(opts: ChatOptions) {
  if (!opts.images?.length) return opts.prompt;
  return [
    { type: "text", text: opts.prompt },
    ...opts.images.flatMap((im) => [
      ...(im.caption ? [{ type: "text", text: im.caption }] : []),
      { type: "image", source: { type: "base64", media_type: im.mediaType ?? "image/png", data: im.base64 } },
    ]),
  ];
}

function openaiMessages(opts: ChatOptions) {
  const user = !opts.images?.length
    ? opts.prompt
    : [
        { type: "text", text: opts.prompt },
        ...opts.images.flatMap((im) => [
          ...(im.caption ? [{ type: "text", text: im.caption }] : []),
          { type: "image_url", image_url: { url: `data:${im.mediaType ?? "image/png"};base64,${im.base64}` } },
        ]),
      ];
  return [...(opts.system ? [{ role: "system", content: opts.system }] : []), { role: "user", content: user }];
}

async function openai(cfg: AiConfig, body: Record<string, unknown>) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  try {
    return await post(`${cfg.baseUrl}/chat/completions`, headers, body, cfg.timeoutMs);
  } catch (e) {
    // Newer OpenAI models take max_completion_tokens instead of max_tokens.
    if (e instanceof AiRequestError && e.status === 400 && /max_tokens/.test(e.message) && "max_tokens" in body) {
      const { max_tokens, ...rest } = body;
      return post(`${cfg.baseUrl}/chat/completions`, headers, { ...rest, max_completion_tokens: max_tokens }, cfg.timeoutMs);
    }
    throw e;
  }
}

function anthropic(cfg: AiConfig, body: Record<string, unknown>) {
  return post(`${cfg.baseUrl}/v1/messages`, {
    "content-type": "application/json",
    "x-api-key": cfg.apiKey,
    "anthropic-version": "2023-06-01",
  }, body, cfg.timeoutMs);
}

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new AiRequestError(`AI server unreachable at ${new URL(url).origin}: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j?.error?.message ?? j?.message ?? text;
    } catch { /* not JSON */ }
    throw new AiRequestError(`AI server returned ${res.status}: ${String(msg).slice(0, 500)}`, res.status);
  }
  return JSON.parse(text);
}

/** Accepts a JSON object as text, with or without a ```json fence. */
export function parseJsonAnswer<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new AiRequestError("The AI model did not return a structured result");
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T;
  } catch {
    throw new AiRequestError("The AI model returned malformed JSON");
  }
}
