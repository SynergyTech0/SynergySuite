// Video export: when each slide starts and how long it stays, and the sound
// track built from the narrations.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Slide } from "../lib/slides/model";
import { mixTrack, stepTimes, videoPlan } from "../lib/slides/video";
import { buildSteps, type Anim } from "../lib/slides/model";

const slide = (id: string, extra: Partial<Slide> = {}): Slide => ({ id, title: id, body: "", notes: "", layout: "titleOnly", bg: "", bgImg: "", elements: [], ...extra });

test("video plan: timings, narration length, default seconds, transitions, hidden slides", () => {
  const slides = [
    slide("a"),
    slide("b", { trans: { type: "fade", dur: 800, advAfter: 3000 } }),
    slide("c", { hidden: true }),
    slide("d", { trans: { type: "push", dur: 500 } }),
    slide("e"),
  ];
  const { items, total } = videoPlan(slides, { secs: 5, narration: { d: 2000 } });
  assert.deepEqual(items.map((i) => [i.index, i.start, i.transMs, i.hold]), [
    [0, 0, 0, 5000],
    [1, 5000, 800, 3000],
    [3, 8800, 500, 2500],
    [4, 11800, 0, 5000],
  ]);
  assert.equal(total, 16800);
  // without timings or transitions
  const flat = videoPlan(slides, { secs: 2, useTimings: false, transitions: false });
  assert.deepEqual(flat.items.map((i) => [i.start, i.transMs, i.hold]), [[0, 0, 2000], [2000, 0, 2000], [4000, 0, 2000], [6000, 0, 2000]]);
  // the first slide never has a transition in
  assert.equal(videoPlan([slide("x", { trans: { type: "fade", dur: 500 } })], { secs: 1 }).items[0].transMs, 0);
});

test("sound track: each narration at its slide's start, cut at the slide's end", () => {
  const slides = [slide("a"), slide("b", { trans: { type: "fade", dur: 1000 } })];
  const { items, total } = videoPlan(slides, { secs: 2 });
  const clip = (v: number, seconds: number, rate = 100) => {
    const data = new Float32Array(seconds * rate).fill(v);
    return { sampleRate: rate, length: data.length, numberOfChannels: 1, duration: seconds, getChannelData: () => data } as unknown as AudioBuffer;
  };
  const ch = mixTrack(items, slides, new Map([["a", clip(0.5, 5)], ["b", clip(0.25, 1)]]), total, 100);
  assert.equal(ch.length, 2);
  assert.equal(ch[0].length, 500);
  // a: 0..2 s (cut at its end), silence during b's transition, b: 3..4 s
  assert.equal(ch[0][0], 0.5);
  assert.equal(ch[1][199], 0.5);
  assert.equal(ch[0][200], 0);
  assert.equal(ch[0][299], 0);
  assert.equal(ch[0][300], 0.25);
  assert.equal(ch[0][399], 0.25);
  assert.equal(ch[0][400], 0);
});

test("animations: click steps spread over the slide's time, a first step that starts by itself at once", () => {
  const a = (order: number, start: Anim["start"], extra: Partial<Anim> = {}): Anim => ({ effect: "fade", start, dur: 500, delay: 0, order, ...extra });
  const box = (id: string, anim: Anim) => ({ id, type: "shape" as const, shape: "rect", x: 0, y: 0, w: 10, h: 10, z: 1, anim });
  const s = slide("a", { layout: "blank", elements: [box("p", a(0, "with")), box("q", a(1, "click", { effect: "fly", dur: 1000 })), box("r", a(2, "after", { delay: 200 })), box("t", a(3, "click", { effect: "appear" }))] });
  const st = buildSteps(s);
  assert.equal(st.length, 3);
  const { times, hold } = stepTimes(st, 6000);
  // gap = 6000 / 3 = 2000: auto at 0 (0.5 s), click 1 at 2.5 s (1 s + after 0.2 s + 0.5 s), click 2 at 2 s later
  assert.deepEqual(times, [{ at: 0, dur: 500 }, { at: 2500, dur: 1700 }, { at: 6200, dur: 1 }]);
  assert.equal(hold, 8201);
  const { items, total } = videoPlan([s, slide("b")], { secs: 6 });
  assert.deepEqual(items[0].steps, times);
  assert.equal(items[0].hold, 8201);
  assert.equal(total, 8201 + 6000);
  assert.equal(videoPlan([s], { secs: 6, animations: false }).items[0].steps, undefined);
  // a lone step that starts by itself: the slide stays a beat after it
  assert.deepEqual(stepTimes(buildSteps(slide("x", { layout: "blank", elements: [box("p", a(0, "after", { dur: 3000 }))] })), 1000), { times: [{ at: 0, dur: 3000 }], hold: 3500 });
});
