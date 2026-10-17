// Designer and drafting: built-in layout ideas, AI ideas checked and clamped,
// outlines into slides, and the AI tools through @synergy/ai against a stand-in
// OpenAI-compatible server.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ImageEl, ShapeEl, Slide } from "../lib/slides/model";
import { bulletsOf, cleanDraft, designIdeas, draftSlides, fromAiIdea, parseDeckOutline } from "../lib/slides/designer";

let n = 0;
const id = (p: string) => `${p}${n++}`;
const W = 1280, H = 720;
const slide = (extra: Partial<Slide> = {}): Slide => ({ id: "s", title: "Title", body: "", notes: "", layout: "content", bg: "", bgImg: "", elements: [], ...extra });
const inside = (b: { x: number; y: number; w: number; h: number }) => b.x >= 0 && b.y >= 0 && b.x + b.w <= W + 0.5 && b.y + b.h <= H + 0.5;

test("bullets of a body", () => {
  assert.deepEqual(bulletsOf("<ul><li><p>One</p></li><li><p>Two <b>bold</b></p><ul><li><p>sub</p></li></ul></li></ul>"), ["One", "Two bold"]);
  assert.deepEqual(bulletsOf("a\nb"), ["a", "b"]);
  assert.deepEqual(bulletsOf("<p>Just text</p>"), ["Just text"]);
});

test("built-in ideas fit the content", () => {
  const pic: ImageEl = { id: "p", z: 1, type: "image", src: "data:image/png;base64,x", x: 100, y: 100, w: 400, h: 300 };
  const withPic = designIdeas(slide({ body: "<ul><li><p>A</p></li></ul>", elements: [pic] }), W, H, "4F46E5", id);
  assert.deepEqual(withPic.map((i) => i.id), ["pic-right", "pic-left", "pic-full", "band"]);
  const right = withPic[0].slide;
  const p = right.elements.find((e) => e.id === "p") as ImageEl;
  assert.deepEqual([p.x, p.y, p.w, p.h], [640, 0, 640, 720]);
  assert.ok(p.crop && p.crop.l > 0 && p.crop.t === 0, "cropped to fill its half");
  assert.ok(right.tbox!.x + right.tbox!.w <= 640 && right.bbox!.x + right.bbox!.w <= 640);
  const cards = designIdeas(slide({ body: "<ul><li><p>A</p></li><li><p>B</p></li><li><p>C</p></li><li><p>D</p></li></ul>" }), W, H, "4F46E5", id);
  assert.deepEqual(cards.map((i) => i.id), ["cards", "steps", "columns", "band"]);
  const c = cards[0].slide;
  assert.equal(c.body, "");
  assert.equal(c.elements.length, 4);
  assert.ok(c.elements.every((e) => e.type === "shape" && inside(e) && /A|B|C|D/.test((e as ShapeEl).html || "")));
  assert.deepEqual(designIdeas(slide({ title: "", body: "" }), W, H, "000000", id), []);
  assert.deepEqual(designIdeas(slide({ layout: "titleOnly" }), W, H, "000000", id).map((i) => i.id), ["band", "statement"]);
});

test("AI ideas are checked: boxes clamped, unknown objects dropped, pictures keep their shape", () => {
  const pic: ImageEl = { id: "p", z: 1, type: "image", src: "x", x: 0, y: 0, w: 400, h: 200 };
  const s = slide({ body: "<p>b</p>", elements: [pic] });
  const a = fromAiIdea(s, { name: "Wide", title: { x: -50, y: 700, w: 5000, h: 40 }, items: [{ id: "p", x: 100, y: 100, w: 400, h: 400 }, { id: "ghost", x: 0, y: 0, w: 1, h: 1 }], shapes: [{ shape: "triangle", x: 0, y: 0, w: 100, h: 100, color: "zz" }] }, W, H, "4F46E5", id, 0)!;
  assert.deepEqual(a.slide.tbox, { x: 0, y: 680, w: 1280, h: 40 });
  const p = a.slide.elements.find((e) => e.id === "p")!;
  assert.deepEqual([p.x, p.y, p.w, p.h], [100, 200, 400, 200]);
  const shape = a.slide.elements.find((e) => e.type === "shape") as ShapeEl;
  assert.deepEqual([shape.shape, shape.fill, shape.z < 0], ["rect", "4F46E5", true]);
  assert.equal(a.name, "Wide");
  assert.equal(fromAiIdea(s, { name: "nothing" }, W, H, "000000", id, 1), null);
  assert.equal(fromAiIdea(s, "junk", W, H, "000000", id, 2), null);
  assert.equal(fromAiIdea(s, { title: { x: "1" } }, W, H, "000000", id, 3), null);
});

test("an outline becomes a title slide and content slides", () => {
  const d = parseDeckOutline("Product launch\nSpring 2026\n\nWhy now\n  - Customers asked\n  - Market ready\n  Notes: mention the waitlist\n# Plan\n- Beta in April\n\tGA in June\nThanks");
  assert.equal(d.title, "Product launch");
  assert.equal(d.subtitle, "Spring 2026");
  assert.deepEqual(d.slides, [
    { title: "Why now", bullets: ["Customers asked", "Market ready"], notes: "mention the waitlist" },
    { title: "Plan", bullets: ["Beta in April", "GA in June"] },
    { title: "Thanks", bullets: [] },
  ]);
  const s = draftSlides(d, id);
  assert.deepEqual(s.map((x) => [x.layout, x.title]), [["title", "Product launch"], ["content", "Why now"], ["content", "Plan"], ["titleOnly", "Thanks"]]);
  assert.equal(s[0].body, "<p>Spring 2026</p>");
  assert.equal(s[1].body, "<ul><li><p>Customers asked</p></li><li><p>Market ready</p></li></ul>");
  assert.equal(s[1].notes, "mention the waitlist");
  // markup in an outline is text
  assert.match(draftSlides(parseDeckOutline("T\nS\n  - <b>x</b>"), id)[1].body, /&lt;b&gt;x&lt;\/b&gt;/);
});

test("a model's draft is cleaned", () => {
  assert.equal(cleanDraft(null), null);
  assert.equal(cleanDraft({}), null);
  const d = cleanDraft({ title: "  T  ", slides: [{ title: "A", bullets: ["x", 3, "", "y"] }, { title: "", bullets: [] }, ...Array.from({ length: 40 }, (_, i) => ({ title: `S${i}`, bullets: Array(12).fill("b") }))] }, 30)!;
  assert.equal(d.title, "T");
  assert.equal(d.slides.length, 29); // the empty one dropped, then 30 kept minus it
  assert.deepEqual(d.slides[0].bullets, ["x", "y"]);
  assert.equal(d.slides[1].bullets.length, 8);
});

test("the AI tools through @synergy/ai and an OpenAI-compatible server", async () => {
  const { startFakeAi } = await import("./fixtures/fake-ai.mjs");
  const { server, port, seen } = await startFakeAi();
  try {
    const { aiDesignIdeas, aiDraftDeck, slidesAiConfig, aiFailure } = await import("../lib/slides/ai-server");
    assert.equal(await slidesAiConfig({}), null);
    const cfg = (await slidesAiConfig({ AI_BASE_URL: `http://127.0.0.1:${port}/v1`, SLIDES_AI_MODEL: "fake" }))!;
    assert.equal(cfg.model, "fake");
    const pic: ImageEl = { id: "p", z: 1, type: "image", src: "", x: 0, y: 0, w: 400, h: 200, alt: "Chart" };
    const s = slide({ body: "<ul><li><p>Point</p></li></ul>", elements: [pic] });
    const raw = await aiDesignIdeas(s, W, H, cfg);
    assert.equal(raw.length, 3);
    const req = seen[0];
    assert.equal(req.model, "fake");
    assert.equal(req.tools[0].function.name, "propose_layouts");
    const sent = JSON.parse(req.messages.at(-1).content);
    assert.deepEqual(sent.body.bullets, ["Point"]);
    assert.deepEqual(sent.items[0], { id: "p", kind: "image", box: { x: 0, y: 0, w: 400, h: 200 }, aspect: 2, alt: "Chart" });
    const ideas = raw.map((x, k) => fromAiIdea(s, x, W, H, "4F46E5", id, k));
    assert.equal(ideas[0]!.name, "Side panel");
    assert.ok(inside(ideas[1]!.slide.tbox!));
    assert.equal(ideas[2], null);

    const d = await aiDraftDeck("Expense policy for new staff", 3, cfg);
    assert.equal(d.title, "Expense policy");
    assert.deepEqual(d.slides.map((x) => x.title), ["What you can claim", "How to submit", "Deadlines"]);
    assert.match(seen[1].messages[0].content, /about 3 content slides/);

    // a server that is down reads as a failed request (502), not a crash
    const down = (await slidesAiConfig({ AI_BASE_URL: "http://127.0.0.1:9/v1", AI_MODEL: "x", AI_TIMEOUT_MS: "2000" }))!;
    const e = await aiDraftDeck("x", 3, down).catch((x) => x);
    assert.equal(aiFailure(e).status, 502);
  } finally {
    server.close();
  }
});
