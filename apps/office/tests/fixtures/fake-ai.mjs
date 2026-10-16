// A stand-in for an OpenAI-compatible model server, for tests: answers the
// Slides AI tools (propose_layouts, write_deck) with fixed tool calls.
//   node tests/fixtures/fake-ai.mjs 3879   (then AI_BASE_URL=http://127.0.0.1:3879/v1 AI_MODEL=fake)
import { createServer } from "node:http";

export function answer(body) {
  const tool = body.tools?.[0]?.function?.name;
  let args;
  if (tool === "propose_layouts") {
    const slide = JSON.parse(body.messages.at(-1).content);
    const W = slide.size.w, H = slide.size.h;
    args = {
      ideas: [
        {
          name: "Side panel",
          title: { x: W * 0.55, y: H * 0.1, w: W * 0.4, h: H * 0.2 },
          body: { x: W * 0.55, y: H * 0.35, w: W * 0.4, h: H * 0.55 },
          items: slide.items.map((it, i) => ({ id: it.id, x: W * 0.05, y: H * 0.1 + i * 40, w: W * 0.4, h: H * 0.3 })),
          shapes: [{ shape: "rect", x: 0, y: 0, w: W * 0.5, h: H, color: "accent", behind: true }],
        },
        // out of range and unknown ids: clamped or dropped
        { name: "Wild", title: { x: -500, y: 9999, w: 50000, h: 40 }, items: [{ id: "nope", x: 1, y: 1, w: 1, h: 1 }] },
        { name: "Empty" },
      ],
    };
  } else if (tool === "write_deck") {
    args = {
      title: "Expense policy",
      subtitle: "For new staff",
      slides: [
        { title: "What you can claim", bullets: ["Travel", "Meals with clients", "Training"], notes: "Keep receipts." },
        { title: "How to submit", bullets: ["Use the app", "Attach receipts"] },
        { title: "Deadlines", bullets: ["Within 30 days"] },
      ],
    };
  } else return { choices: [{ message: { role: "assistant", content: "hello" } }] };
  return { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: tool, arguments: JSON.stringify(args) } }] } }] };
}

export function startFakeAi(port = 0) {
  const seen = [];
  const server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(data || "{}");
      seen.push(body);
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(answer(body)));
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port, seen })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port } = await startFakeAi(Number(process.argv[2]) || 3879);
  console.log(`fake AI on http://127.0.0.1:${port}/v1`);
}
