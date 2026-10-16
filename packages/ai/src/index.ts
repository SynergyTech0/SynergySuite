/**
 * Bring your own AI model. Every suite feature that uses AI goes through this package, so an
 * administrator picks the provider and model once (AI_* settings) and the whole suite follows.
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
 */
export function aiConfig(opts: { prefix?: string; env?: Env } = {}): AiConfig | null {
  const env = opts.env ?? process.env;
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
  const cfg = requireConfig(opts.config === undefined ? aiConfig() : opts.config);
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
  const cfg = requireConfig(opts.config === undefined ? aiConfig() : opts.config);
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
  const env = opts.env ?? process.env;
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
  const cfg = opts.config === undefined ? speechConfig({ prefix: opts.prefix, env: opts.env }) : opts.config;
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
  const cfg = requireConfig(opts.config === undefined ? aiConfig() : opts.config);
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
