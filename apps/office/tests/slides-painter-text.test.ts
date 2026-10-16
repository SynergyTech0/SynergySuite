// Format painter between text selections: copy a selection's character format
// and give it to another selection (a TipTap editor under jsdom).
import { before, test } from "node:test";
import assert from "node:assert/strict";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
  const g = globalThis as Record<string, unknown>;
  for (const k of ["window", "document", "navigator", "Node", "HTMLElement", "Element", "DOMParser", "getComputedStyle", "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame"]) {
    try {
      g[k] = k === "window" ? dom.window : (dom.window as unknown as Record<string, unknown>)[k];
    } catch {
      // some globals are read-only in this Node
    }
  }
});

test("a selection's format goes onto another selection, replacing what it had", async () => {
  const { Editor } = await import("@tiptap/core");
  const { default: StarterKit } = await import("@tiptap/starter-kit");
  const { default: Underline } = await import("@tiptap/extension-underline");
  const { TextStyle } = await import("@tiptap/extension-text-style");
  const { default: Color } = await import("@tiptap/extension-color");
  const { default: Highlight } = await import("@tiptap/extension-highlight");
  const { FontSize } = await import("../components/tiptap-ext");
  const { paintSelection, selectionFmt } = await import("../lib/slides/painter");
  const ed = new Editor({
    extensions: [StarterKit, Underline, TextStyle, Color, FontSize, Highlight.configure({ multicolor: true })],
    content: '<p><strong><span style="color: #ff0000; font-size: 28pt">alpha</span></strong> <em>beta</em> gamma</p>',
  });
  // "alpha" is 1..6, "beta" 7..11
  ed.commands.setTextSelection({ from: 2, to: 5 });
  const f = selectionFmt(ed);
  assert.deepEqual({ ...f, color: f.color?.replace("rgb(255, 0, 0)", "#ff0000") }, { b: true, color: "#ff0000", size: "28pt" });
  ed.commands.setTextSelection({ from: 7, to: 11 });
  assert.equal(paintSelection(ed, f), true);
  const html = ed.getHTML();
  assert.match(html, /<span style="color: rgb\(255, 0, 0\); font-size: 28pt;"><strong>beta<\/strong><\/span> gamma<\/p>/);
  assert.doesNotMatch(html, /<em>/);
  ed.commands.setTextSelection({ from: 12, to: 12 });
  assert.equal(paintSelection(ed, f), false);
  ed.destroy();
});
