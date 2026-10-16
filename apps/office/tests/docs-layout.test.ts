// Print layout: blocks flow onto pages and columns by height, with page and
// section breaks, page sizes, page numbering and header/footer choice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { paginate, sectionsOf, NOTE_SEPARATOR, type BlockBox, type Line } from "../lib/docs/paginate";
import { defaultSection, ptToPx, type PMNode, type Section } from "../lib/docs/model";

const letter = defaultSection(); // 612 x 792pt, 1in margins -> 864px of text per page
const body = (n: number): BlockBox[] => Array.from({ length: n }, () => ({ h: 100, kind: "block" as const }));

test("blocks fill a page and move to the next when they do not fit", () => {
  const l = paginate(body(20), new Array(20).fill(0), [letter]);
  // 864px of text height -> 8 blocks of 100px per page
  assert.equal(l.pages.length, 3);
  assert.deepEqual(l.place.map((p) => p.page), [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2]);
  // the first block sits at the top margin, the 9th at the next page's top margin
  assert.equal(l.place[0].marginTop, 96);
  assert.equal(Math.round(l.pages[1].top), Math.round(ptToPx(792) + 24));
  assert.equal(Math.round(l.place[8].marginTop), Math.round(l.pages[1].top + 96 - (96 + 800)));
  assert.equal(l.place[0].left, 96);
  assert.equal(l.place[0].width, 624);
  assert.equal(l.pages.map((p) => p.label).join(","), "1,2,3");
  // the flow ends at the bottom of the last page
  assert.equal(Math.round(l.padBottom), Math.round(l.pages[2].top + l.pages[2].height - (l.pages[2].top + 96 + 400)));
});

test("page breaks, keep with next and blocks taller than a page", () => {
  const blocks: BlockBox[] = [{ h: 100, kind: "block" }, { h: 18, kind: "pageBreak" }, { h: 100, kind: "block" }, { h: 700, kind: "block" }, { h: 40, kind: "block", keepNext: true }, { h: 200, kind: "block" }, { h: 2000, kind: "block" }];
  const l = paginate(blocks, new Array(blocks.length).fill(0), [letter]);
  assert.deepEqual(l.place.map((p) => p.page), [0, 0, 1, 1, 2, 2, 3]);
  // the heading kept with the next block moved to page 3 even though it fit on page 2
  assert.ok(l.pages[3].height > ptToPx(792), "a page grows to hold a block taller than the page");
});

test("sections: page size, continuous starts, odd/even pages, numbering and headers", () => {
  const land: Section = { ...letter, orientation: "landscape", pageWidth: 792, pageHeight: 612, type: "nextPage", titlePage: true, pageNumberStart: 1, pageNumberFormat: "lowerRoman" };
  const cont: Section = { ...land, type: "continuous", titlePage: false, pageNumberStart: undefined, columns: { count: 2, space: 36, separator: true } };
  const odd: Section = { ...letter, type: "oddPage" };
  const blocks: BlockBox[] = [
    { h: 100, kind: "block" },
    { h: 18, kind: "sectionBreak" }, // ends section 0 (letter)
    { h: 100, kind: "block" },
    { h: 18, kind: "sectionBreak" }, // ends section 1 (landscape)
    ...body(10), // section 2: continuous, two columns
    { h: 18, kind: "sectionBreak" },
    { h: 50, kind: "block" }, // section 3 starts on an odd page
  ];
  const sec = [0, 0, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3];
  const l = paginate(blocks, sec, [letter, land, cont, odd], { evenAndOddHeaders: true });
  const flow = Math.ceil(ptToPx(792));
  assert.equal(l.flowWidth, flow);
  // page 2 is landscape, centred in the flow
  assert.equal(Math.round(l.pages[1].width), 1056);
  assert.equal(Math.round(l.pages[0].left), Math.round((flow - 816) / 2));
  assert.equal(l.pages[1].hf, "first");
  assert.equal(l.pages[1].label, "i");
  // the continuous section shares page 2 and lays out in two columns
  const p = l.place.slice(4, 14);
  assert.equal(p[0].page, 1);
  const colW = (ptToPx(792 - 144) - 48) / 2;
  assert.ok(Math.abs(p[0].width - colW) < 0.01);
  assert.ok(new Set(p.map((x) => Math.round(x.left))).size === 2, "both columns used");
  assert.ok(l.pages[1].regions.some((r) => r.cols === 2 && r.separator));
  // section 3 (odd page): page numbers run i, ii, iii..., a blank page is added when needed
  const last = l.pages[l.pages.length - 1];
  assert.equal(last.section, 3);
  assert.equal(last.number % 2, 1);
  // even pages use the even header when odd/even headers are on
  assert.ok(l.pages.filter((x) => x.number % 2 === 0 && !(x.firstOfSection && x.section === 1)).every((x) => x.hf === "even"));
});

test("sectionsOf maps blocks to sections", () => {
  const doc: PMNode = { type: "doc", content: [{ type: "paragraph" }, { type: "sectionBreak", attrs: { section: JSON.stringify({ ...letter, pageWidth: 500 }) } }, { type: "paragraph" }] };
  const { sections, blockSection } = sectionsOf(doc, { ...letter, pageWidth: 700 });
  assert.deepEqual(blockSection, [0, 0, 1]);
  assert.deepEqual(sections.map((s) => s.pageWidth), [500, 700]);
});

const linesOf = (n: number, h = 20, pad = 0): Line[] => Array.from({ length: n }, (_, k) => ({ top: pad + k * h, bottom: pad + (k + 1) * h }));
const para = (n: number, extra: Partial<BlockBox> = {}): BlockBox => ({ h: n * 20, kind: "block", lines: linesOf(n), ...extra });

test("a paragraph that does not fit is split between lines", () => {
  const l = paginate([...body(7), para(20)], new Array(8).fill(0), [letter]);
  // 164px are left on page 1: eight 20px lines fit, twelve go on
  assert.equal(l.splits.length, 1);
  const s = l.splits[0];
  assert.deepEqual([s.block, s.line, s.page], [7, 8, 1]);
  const page2Top = l.pages[1].top + 96;
  assert.equal(Math.round(s.gap), Math.round(page2Top - (96 + 700 + 160)));
  assert.equal(l.place[7].page, 0);
  // the flow ends 12 lines into page 2
  assert.equal(Math.round(l.padBottom), Math.round(l.pages[1].top + l.pages[1].height - (page2Top + 240)));
});

test("widow and orphan control, keep lines together, repeated table headers", () => {
  // nine lines when eight fit: one line would be alone on the next page, so two go
  let l = paginate([...body(7), para(9)], new Array(8).fill(0), [letter]);
  assert.equal(l.splits[0].line, 7);
  // only one line would fit: the whole paragraph moves
  l = paginate([...body(8), { h: 50, kind: "block" }, para(10)], new Array(10).fill(0), [letter]);
  assert.equal(l.splits.length, 0);
  assert.equal(l.place[9].page, 1);
  // keep lines together: no split
  l = paginate([...body(7), para(20, { keepLines: true })], new Array(8).fill(0), [letter]);
  assert.equal(l.splits.length, 0);
  assert.equal(l.place[7].page, 1);
  // a table of 30 rows of 50px with a 30px header row: the header repeats on page 2
  const rows: Line[] = [{ top: 0, bottom: 30 }, ...Array.from({ length: 30 }, (_, k) => ({ top: 30 + k * 50, bottom: 80 + k * 50 }))];
  l = paginate([{ h: 1530, kind: "block", lines: rows, header: 30 }], [0], [letter]);
  // page 1 holds the header and 16 rows (30 + 800 = 830 <= 864)
  assert.deepEqual(l.splits.map((x) => [x.line, x.header, x.page]), [[17, 30, 1]]);
  const p2 = l.pages[1].top + 96;
  assert.equal(Math.round(l.splits[0].gap), Math.round(p2 - (96 + 830)));
  // rows 17..30 (14 rows) below the repeated header
  assert.equal(Math.round(l.padBottom), Math.round(l.pages[1].top + l.pages[1].height - (p2 + 30 + 700)));
});

test("footnotes take room at the foot of their page", () => {
  const note = { id: 0, h: 100, y: 65 };
  // the reference is on line 3 of a 6-line paragraph that would otherwise just fit
  const blocks: BlockBox[] = [...body(7), para(6, { notes: [note] }), { h: 20, kind: "block", notes: [{ id: 1, h: 20, y: 0 }] }];
  const l = paginate(blocks, new Array(9).fill(0), [letter]);
  // 164px left: lines 0-3 and the 116px note area do not fit, so lines 0-2 stay and the rest (with the note) goes
  assert.deepEqual(l.pages[0].notes, []);
  assert.deepEqual(l.pages[1].notes, [0, 1]);
  assert.equal(l.pages[1].notesHeight, 100 + 20 + NOTE_SEPARATOR);
  assert.equal(l.splits.length, 1);
  assert.equal(l.splits[0].line, 3);
  // a float takes no room in the flow
  const f = paginate([{ h: 300, kind: "float" }, { h: 100, kind: "block" }], [0, 0], [letter]);
  assert.equal(f.place[0].marginTop, 96);
  assert.equal(f.place[1].marginTop, 96);
  assert.equal(f.place[1].y, 96);
});
