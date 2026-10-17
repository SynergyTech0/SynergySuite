// Analyze Data's local suggestions, and the AI helpers against a stand-in
// OpenAI-compatible server (any model the suite is set up with).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { analyzeTable, correlation, describeTable, outliers, profileColumns, totalsBy, trend } from "../lib/analyze-data.ts";
import { cleanFormula, configFor, formulaPrompt, suggestFormula, suggestInsights } from "../lib/sheet-ai.ts";

const SALES = [
  ["Region", "Product", "Sales", "Units"],
  ["North", "Tea", 1200, 40],
  ["South", "Tea", 300, 10],
  ["North", "Coffee", 2500, 80],
  ["East", "Coffee", 400, 14],
  ["North", "Cocoa", 900, 31],
  ["South", "Cocoa", 200, 7],
  ["East", "Tea", 350, 12],
];

test("columns are profiled as numbers, text and dates; years and IDs are not measures", () => {
  const cols = profileColumns(["Year", "ID", "City", "Amount"], [[2021, 1, "Oslo", 10], [2022, 2, "Rome", 20], [2023, 3, "Oslo", 30]]);
  assert.deepEqual(cols.map((c) => c.kind), ["date", "number", "text", "number"]);
  assert.equal(cols[1].identifier, true);
  assert.equal(cols[3].identifier, false);
  assert.equal(cols[3].sum, 60);
  assert.equal(cols[2].distinct, 2);
});

test("statistics helpers", () => {
  assert.ok(trend([1, 2, 3, 4]).r2 > 0.99);
  assert.ok(trend([1, 2, 3, 4]).slope === 1);
  assert.ok(Math.abs(correlation([1, 2, 3, 4], [8, 6, 4, 2]) + 1) < 1e-9);
  assert.deepEqual(outliers([10, 11, 9, 10, 12, 10, 95, 11]), [6]);
  assert.deepEqual(outliers([1, 2, 3]), []);
  assert.deepEqual(totalsBy(SALES.slice(1), 0, 2), [{ key: "North", total: 4600 }, { key: "East", total: 750 }, { key: "South", total: 500 }]);
});

test("a table with repeated groups suggests pivot tables (with charts) and a top-share insight", () => {
  const a = analyzeTable(SALES);
  const pivots = a.suggestions.filter((s) => s.kind === "pivot");
  assert.ok(pivots.length >= 2);
  const first = pivots[0];
  assert.equal(first.kind, "pivot");
  if (first.kind === "pivot") {
    assert.deepEqual(first.rows, ["Region"]);
    assert.deepEqual(first.values, [{ field: "Sales", agg: "sum" }]);
    assert.equal(first.title, "Total Sales by Region");
    assert.equal(first.chart, "pie");
  }
  const top = a.suggestions.find((s) => s.kind === "insight" && s.title === "North leads Sales");
  assert.ok(top && top.kind === "insight" && /North has the most Sales \(4,600\), 79% of the total across 3 Region values/.test(top.text), JSON.stringify(a.suggestions));
  assert.ok(a.suggestions.some((s) => s.kind === "insight" && /Sales and Units move together/.test(s.title)));
  // A cross tab of the two groups.
  assert.ok(pivots.some((p) => p.kind === "pivot" && p.rows.length === 2));
});

test("a labelled series over time suggests a line chart and states its trend", () => {
  const t = [["Month", "Revenue", "Costs"], ["Jan", 100, 80], ["Feb", 120, 82], ["Mar", 150, 79], ["Apr", 170, 81], ["May", 205, 80], ["Jun", 230, 83]];
  const a = analyzeTable(t);
  const line = a.suggestions.find((s) => s.kind === "chart" && s.chartType === "line");
  assert.ok(line && line.kind === "chart");
  if (line?.kind === "chart") {
    assert.equal(line.category, 0);
    assert.deepEqual(line.values, [1, 2]);
  }
  const rising = a.suggestions.find((s) => s.kind === "insight" && s.title === "Revenue is rising");
  assert.ok(rising && rising.kind === "insight" && /from 100 to 230 \(\+130%\)/.test(rising.text));
  assert.ok(!a.suggestions.some((s) => s.title === "Costs is rising"));
});

test("an unusual value is called out with its label", () => {
  const t = [["Store", "Returns"], ...["A", "B", "C", "D", "E", "F", "G", "H"].map((s, i) => [s, i === 5 ? 400 : 20 + (i % 3)])];
  const a = analyzeTable(t);
  const odd = a.suggestions.find((s) => s.kind === "insight" && s.title === "Unusual Returns");
  assert.ok(odd && odd.kind === "insight" && odd.text.startsWith("F (400) stands out"), JSON.stringify(a.suggestions));
  // One label per row: a chart of the values against it.
  assert.ok(a.suggestions.some((s) => s.kind === "chart" && s.title === "Returns by Store"));
});

test("too little data gives no suggestions; text-only tables get a count pivot", () => {
  assert.equal(analyzeTable([["A"], [1]]).suggestions.length, 0);
  const a = analyzeTable([["Team"], ["Red"], ["Blue"], ["Red"], ["Red"]]);
  assert.ok(a.suggestions.some((s) => s.kind === "pivot" && s.values[0].agg === "count"));
});

test("the table description for a model lists columns and sample rows", () => {
  const d = describeTable(SALES, 2);
  assert.match(d, /Columns \(7 rows\):/);
  assert.match(d, /- Sales: number, 7 values, sum 5,850/);
  assert.match(d, /- Region: text, 7 values, 3 distinct/);
  assert.match(d, /North \| Tea \| 1200 \| 40\nSouth \| Tea \| 300 \| 10$/);
});

test("formulas from a model are cleaned up to one line starting with =", () => {
  assert.equal(cleanFormula("SUM(A1:A3)"), "=SUM(A1:A3)");
  assert.equal(cleanFormula("```excel\n=SUMIF(A2:A9,\"North\",\n C2:C9)\n```"), '=SUMIF(A2:A9,"North", C2:C9)');
  assert.equal(cleanFormula("`=A1+1`"), "=A1+1");
  assert.throws(() => cleanFormula("  "), /did not give a formula/);
  const p = formulaPrompt("total sales for North", { cell: "F2", range: "A1:D8", columns: [{ column: "A", name: "Region" }, { column: "C", name: "Sales" }] });
  assert.match(p, /Request: total sales for North\nThe formula goes in cell F2\.\nThe data table is A1:D8/);
  assert.match(p, /Columns: A = Region, C = Sales/);
});

test("no model set up: AI is off", async () => {
  assert.equal(await configFor({}), null);
  await assert.rejects(suggestFormula("sum", {}, null), (e: Error) => e.name === "AiUnavailableError");
  // OFFICE_ settings win over the suite's.
  assert.equal((await configFor({ AI_MODEL: "a", AI_BASE_URL: "http://x", OFFICE_AI_MODEL: "b" }))?.model, "b");
});

test("the formula and insight helpers ask the configured model through a forced tool call", async () => {
  const seen: any[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = JSON.parse(body);
      seen.push({ url: req.url, body: j });
      const tool = j.tools[0].function.name;
      const args = tool === "record_formula" ? { formula: 'SUMIF(A2:A8,"North",C2:C8)', explanation: "Adds Sales where Region is North." } : { insights: [{ title: "North leads", text: "North has 79% of sales." }, { title: "", text: "  " }] };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: tool, arguments: JSON.stringify(args) } }] } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as any).port;
  try {
    const config = await configFor({ OFFICE_AI_BASE_URL: `http://127.0.0.1:${port}/v1`, OFFICE_AI_MODEL: "local-model" });
    const f = await suggestFormula("total sales for North", { cell: "F2" }, config);
    assert.deepEqual(f, { formula: '=SUMIF(A2:A8,"North",C2:C8)', explanation: "Adds Sales where Region is North." });
    assert.equal(seen[0].url, "/v1/chat/completions");
    assert.equal(seen[0].body.model, "local-model");
    assert.deepEqual(seen[0].body.tool_choice, { type: "function", function: { name: "record_formula" } });
    const ins = await suggestInsights(describeTable(SALES), config);
    assert.deepEqual(ins, { insights: [{ title: "North leads", text: "North has 79% of sales." }] });
    assert.match(seen[1].body.messages.at(-1).content, /Columns \(7 rows\)/);
  } finally {
    server.close();
  }
});
