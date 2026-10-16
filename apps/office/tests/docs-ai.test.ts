// Docs AI tools: prompts, the Markdown answer as document content, and the
// server call against a stand-in OpenAI-compatible endpoint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { aiPrompt, blocksText, cleanAnswer, mdInline, mdToNodes } from "../lib/docs/ai";
import { aiDocsTask, docsAiConfig, docsAiFailure } from "../lib/docs/ai-server";

test("prompts carry the task, tone and context", () => {
  assert.match(aiPrompt("rewrite", { text: "hi", tone: "formal" }).system, /more formal/);
  assert.match(aiPrompt("rewrite", { text: "hi" }).system, /clearer/);
  assert.equal(aiPrompt("grammar", { text: "hi" }).temperature, 0);
  const d = aiPrompt("draft", { prompt: "a memo", context: "Earlier text" });
  assert.match(d.prompt, /Earlier text[\s\S]*Write: a memo$/);
  assert.match(aiPrompt("summarize", { text: "x" }).system, /bullet/);
});

test("answers lose fences and lead-ins", () => {
  assert.equal(cleanAnswer("```markdown\nHello\n```"), "Hello");
  assert.equal(cleanAnswer("Sure! Here is the rewritten text:\n\nHello there."), "Hello there.");
  assert.equal(cleanAnswer("Plain."), "Plain.");
});

test("inline Markdown becomes bold and italic marks", () => {
  assert.deepEqual(mdInline("a **b** *c* _d_ snake_case"), [
    { type: "text", text: "a " },
    { type: "text", text: "b", marks: [{ type: "bold" }] },
    { type: "text", text: " " },
    { type: "text", text: "c", marks: [{ type: "italic" }] },
    { type: "text", text: " " },
    { type: "text", text: "d", marks: [{ type: "italic" }] },
    { type: "text", text: " snake_case" },
  ]);
});

test("Markdown blocks become headings, paragraphs and lists", () => {
  const nodes = mdToNodes("## Plan\nFirst line\ncontinues.\n\n- one\n- **two**\n1. step\n2. next\n\nEnd.");
  assert.deepEqual(nodes.map((n) => n.type), ["heading", "paragraph", "bulletList", "orderedList", "paragraph"]);
  assert.equal(nodes[0].attrs!.level, 1);
  assert.equal(nodes[1].content![0].text, "First line continues.");
  assert.equal(nodes[2].content!.length, 2);
  assert.deepEqual(nodes[2].content![1].content![0].content![0].marks, [{ type: "bold" }]);
  assert.equal(nodes[3].content!.length, 2);
  assert.equal(mdToNodes("### Sub")[0].attrs!.level, 2);
});

test("document blocks become plain text for the model", () => {
  const text = blocksText([
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
    { type: "paragraph", content: [{ type: "text", text: "Body" }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] }] },
    { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] }] },
  ]);
  assert.equal(text, "## Title\n\nBody\n\n- a\n\n1. b");
  // and back again
  assert.deepEqual(mdToNodes(text).map((n) => n.type), ["heading", "paragraph", "bulletList", "orderedList"]);
});

test("configuration reads DOCS_AI_* before AI_*", () => {
  assert.equal(docsAiConfig({}), null);
  assert.equal(docsAiConfig({ AI_MODEL: "m", AI_BASE_URL: "http://x" })!.model, "m");
  assert.equal(docsAiConfig({ AI_MODEL: "m", AI_BASE_URL: "http://x", DOCS_AI_MODEL: "d" })!.model, "d");
  assert.equal(docsAiConfig({ AI_PROVIDER: "nope", AI_MODEL: "m" }), null);
});

test("a task goes to the model and its answer comes back clean", async () => {
  let seen: { messages: { role: string; content: string }[]; temperature: number } | null = null;
  let fail = false;
  const server = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      seen = JSON.parse(b);
      if (fail) {
        res.writeHead(500, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "boom" } }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Here is the corrected text:\n\nThe cat sat." } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const port = (server.address() as AddressInfo).port;
    const cfg = docsAiConfig({ DOCS_AI_MODEL: "stub", DOCS_AI_BASE_URL: `http://127.0.0.1:${port}/v1` })!;
    assert.equal(await aiDocsTask("grammar", { text: "teh cat sat" }, cfg), "The cat sat.");
    assert.ok(seen!.messages.some((m) => m.role === "user" && m.content === "teh cat sat"));
    assert.ok(seen!.messages.some((m) => m.role === "system" && /proofreader/.test(m.content)));
    fail = true;
    const err = await aiDocsTask("summarize", { text: "x" }, cfg).catch((e) => e);
    const f = docsAiFailure(err);
    assert.ok(f.status >= 500 && f.status < 600, String(f.status));
    assert.match(f.error, /could not answer|boom/i);
  } finally {
    server.close();
  }
});

test("inline content alone reads as one paragraph", () => {
  assert.equal(blocksText([{ type: "text", text: "Hello " }, { type: "text", text: "world", marks: [{ type: "bold" }] }]), "Hello world");
});
