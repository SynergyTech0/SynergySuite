const test = require("node:test");
const assert = require("node:assert/strict");
const { readSearchQuery, snippet, plainText, clipText, parseQuery, SearchInputError, MAX_RESULTS } = require("../dist");

test("reads a search body", () => {
  const q = readSearchQuery({ query: "  budget OR forecast ", limit: 500, kinds: ["file", 3], text: true });
  assert.equal(q.query, "budget OR forecast");
  assert.deepEqual(q.parsed.groups, [["budget", "forecast"]]);
  assert.equal(q.limit, MAX_RESULTS);
  assert.deepEqual(q.kinds, ["file"]);
  assert.equal(q.text, true);
  assert.equal(readSearchQuery({ query: "x" }).limit, 20);
  assert.equal(readSearchQuery({ query: "x" }).text, false);
});

test("refuses an empty or exclude-only search", () => {
  assert.throws(() => readSearchQuery({}), SearchInputError);
  assert.throws(() => readSearchQuery({ query: "   " }), SearchInputError);
  assert.throws(() => readSearchQuery({ query: "-spam" }), SearchInputError);
});

test("makes plain text and snippets around the match", () => {
  assert.equal(plainText("<p>Hi&nbsp;<b>there</b></p><script>x()</script>"), "Hi there");
  const long = "a ".repeat(300) + "the quarterly budget is here " + "b ".repeat(300);
  const s = snippet(long, parseQuery("budget"));
  assert.ok(s.includes("budget"));
  assert.ok(s.startsWith("…") && s.endsWith("…"));
  assert.ok(s.length <= 203);
  assert.equal(snippet("short text", parseQuery("x")), "short text");
  assert.equal(clipText("x".repeat(5000)).length, 4001);
});
