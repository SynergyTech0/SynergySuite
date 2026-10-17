# @synergy/ai

Bring your own AI model. Every AI feature in the suite calls this package, so administrators choose the provider and model once, normally in the sign-in app's admin console (Settings > AI model), with the `AI_*` settings below as the fallback.

```ts
import { chat, structured, embed, isAiAvailable, AiUnavailableError } from "@synergy/ai";

if (!(await isAiAvailable())) return "AI is off";
const summary = await chat({ system: "Be brief.", prompt: text });
const fields = await structured<Fields>({ prompt, images, toolName: "record_fields", toolDescription: "...", schema });
const vectors = await embed(["first chunk", "second chunk"]);
```

| Setting | Meaning |
|---|---|
| `AI_PROVIDER` | `openai` (default; OpenAI or any OpenAI-compatible server), `anthropic`, or `ollama` |
| `AI_BASE_URL` | Server address. Defaults to the provider's public API, or `http://localhost:11434/v1` for `ollama` |
| `AI_API_KEY` | API key, if the server needs one |
| `AI_MODEL` | Model for `chat` and `structured`. AI is off until this is set |
| `AI_EMBEDDING_MODEL` | Model for `embed` (OpenAI-compatible servers only) |
| `AI_SPEECH_MODEL` | Model for `transcribe`, speech to text through `/audio/transcriptions` (OpenAI, Groq, faster-whisper-server, vLLM and other Whisper servers) |
| `AI_TIMEOUT_MS` | Per-request timeout, default 120000 |

Pass `{ prefix: "SIGN_" }` (or any prefix) to let one app override any of these with `SIGN_AI_MODEL` and so on.

## Settings from the admin console

An administrator can save the provider, model, base URL, API key and embedding and speech models in auth's admin console instead of the server's environment. `loadAiConfig({ prefix })`, `isAiAvailable({ prefix })`, `loadSpeechConfig({ prefix })` and `resolveAiEnv()` fetch them from auth (`GET <AUTH_INTERNAL_URL>/api/internal/ai-settings`, proven with `PROXY_SHARED_SECRET`), keep them for `AI_SETTINGS_CACHE_MS` (default 60000), and apply them in place of the unprefixed `AI_*` variables; prefixed ones still win for their app. `chat`, `structured`, `embed`, `transcribe` and `relay` use them when no `config` is passed. Decide whether AI is on with these async functions, so a key saved in the console turns AI on without a restart.

| Setting | Meaning |
|---|---|
| `AUTH_INTERNAL_URL` | Where auth is on the internal network. Defaults to `http://auth:3500` in production; elsewhere, unset means the environment alone |
| `PROXY_SHARED_SECRET` | The suite's shared secret; without it auth isn't asked |
| `AI_SETTINGS_CACHE_MS` | How long fetched settings are kept, default 60000 |

When nothing is saved, or auth can't be reached before the first successful fetch, the environment is used; after that, an app keeps the last settings it fetched while auth is unreachable. The sync `aiConfig()` and `isAiConfigured()` are kept: without an explicit `env` they see the settings fetched so far and start a refresh when those are stale, but never wait for auth.

Nothing here invents an answer: without a model, calls throw `AiUnavailableError` and the feature should say AI is off. `structured` forces a tool call to get JSON, retries without forcing for servers that refuse it, and accepts a JSON reply as a last resort.

An embedded tool that runs its own agent loop in the browser (CAD's 3D modeling assistant) can't call the functions above, so it uses `relay` instead. The tool talks to an app route in its provider's own format (Anthropic Messages or OpenAI chat completions; `protocolOf(config)` says which one the configured provider speaks). The route passes the body to `relay`, which swaps in the configured model and the server's key, then streams the provider's answer back. The browser never holds a key or picks a model.
