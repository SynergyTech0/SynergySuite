// Presenting live: deck settings, the presenter state followers read, and captions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { captionText, defaultCaptionLang, lookOf, parseCaptionSettings, parseLive, pickPresenter, readDeckMeta, readResults } from "../lib/slides/live";

test("deck settings are read from the shared map with defaults", () => {
  const m = readDeckMeta((k) => ({ w: "1024", theme: "plain", hf: JSON.stringify({ num: true }), showSet: "{bad" } as Record<string, string>)[k]);
  assert.equal(m.w, 1024);
  assert.equal(m.h, 720);
  assert.equal(m.theme, "plain");
  assert.deepEqual(m.hf, { num: true });
  const look = lookOf({ ...m, font: "Inter" });
  assert.equal(look.W, 1024);
  assert.match(look.font, /^'Inter', /);
});

test("presenter states from other clients are checked, and the newest presenter wins", () => {
  assert.equal(parseLive(null), null);
  assert.equal(parseLive({ v: 1, sid: "", step: 0, since: 1, seq: 1 }), null);
  assert.equal(parseLive({ v: 2, sid: "a", step: 0, since: 1, seq: 1 }), null);
  const ok = parseLive({ v: 1, sid: "s1", step: 2, since: 10, seq: 3, name: "Ana", blank: "white", zoom: { box: { x: 1, y: 2, w: 3, h: 4 }, out: true }, ink: [{ tool: "pen", color: "FF0000", pts: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }, { tool: "pen", color: "red", pts: [] }], cap: "x".repeat(900), extra: 1 });
  assert.ok(ok);
  assert.equal(ok.blank, "white");
  assert.deepEqual(ok.zoom, { box: { x: 1, y: 2, w: 3, h: 4 }, out: true });
  assert.equal(ok.ink?.length, 1);
  assert.equal(ok.cap?.length, 400);
  assert.equal((ok as Record<string, unknown>).extra, undefined);
  const states: [number, Record<string, unknown>][] = [
    [1, { user: {} }],
    [2, { live: { v: 1, sid: "a", step: 0, since: 5, seq: 0 } }],
    [3, { live: { v: 1, sid: "b", step: 1, since: 9, seq: 0 } }],
    [4, { live: { v: 1, sid: "c", step: 1, since: 99, seq: 0 } }],
  ];
  assert.equal(pickPresenter(states, 4)?.live.sid, "b");
  assert.equal(pickPresenter(states)?.client, 4);
  assert.equal(pickPresenter([[1, {}]]), null);
});

test("captions keep the end of what was said, cut at a word", () => {
  assert.equal(captionText(["Hello  there."], " how are"), "Hello there. how are");
  const long = captionText(["one two three four five six seven eight nine ten"], "eleven", 20);
  assert.ok(long.length <= 20);
  assert.equal(long, "nine ten eleven");
  const r = readResults([{ isFinal: true, 0: { transcript: "a" } }, { isFinal: true, 0: { transcript: "b" } }, { isFinal: false, 0: { transcript: "c" } }], 1);
  assert.deepEqual(r, { finals: ["b"], interim: "c" });
  assert.equal(defaultCaptionLang("fr-CA"), "fr-FR");
  assert.equal(defaultCaptionLang("en-GB"), "en-GB");
  assert.equal(defaultCaptionLang("xx"), "en-US");
  assert.deepEqual(parseCaptionSettings({ lang: "de-DE", pos: "top", size: "l" }), { lang: "de-DE", pos: "top", size: "l" });
  assert.deepEqual(parseCaptionSettings({ lang: "<script>", pos: 3 }), { lang: "en-US", pos: "bottom", size: "m" });
});
