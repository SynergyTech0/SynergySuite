# @synergy/ai

Bring your own AI model. Every AI feature in the suite calls this package, so administrators choose the provider and model once.

```ts
import { chat, structured, embed, isAiConfigured, AiUnavailableError } from "@synergy/ai";

if (!isAiConfigured()) return "AI is off";
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

Nothing here invents an answer: without a model, calls throw `AiUnavailableError` and the feature should say AI is off. `structured` forces a tool call to get JSON, retries without forcing for servers that refuse it, and accepts a JSON reply as a last resort.

An embedded tool that runs its own agent loop in the browser (CAD's 3D modeling assistant) can't call the functions above, so it uses `relay` instead. The tool talks to an app route in its provider's own format (Anthropic Messages or OpenAI chat completions; `protocolOf(config)` says which one the configured provider speaks). The route passes the body to `relay`, which swaps in the configured model and the server's key, then streams the provider's answer back. The browser never holds a key or picks a model.
