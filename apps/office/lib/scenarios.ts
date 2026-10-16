// Scenario Manager (Data > What-If Analysis > Scenario Manager in Excel): named
// sets of values for some input cells, which can be shown on the sheet or
// compared side by side in a summary. Scenarios live in a workbook resource and
// change through one mutation; in .xlsx they are the worksheet's <scenarios>.

export const SCENARIO_RESOURCE = "SHEET_SYNERGY_SCENARIO_PLUGIN";
export const SET_SCENARIOS_MUTATION = "sheet.mutation.set-scenarios";

export type ScenarioValue = string | number | boolean | null;
export type ScenarioCell = { row: number; column: number; value: ScenarioValue };
export type Scenario = { id: string; sheetId: string; name: string; cells: ScenarioCell[]; comment?: string; user?: string; locked?: boolean; hidden?: boolean };
export type ScenarioResource = { scenarios: Scenario[] };

/** Excel allows 32 changing cells per scenario. */
export const MAX_SCENARIO_CELLS = 32;

const col = (c: number) => {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const colIndex = (s: string) => s.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const cellRef = (c: { row: number; column: number }) => `${col(c.column)}${c.row + 1}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Cells of "B1,B2:B3 D4" (commas or spaces), at most `max`. */
export function parseCellList(text: string, max = MAX_SCENARIO_CELLS): { row: number; column: number }[] | null {
  const out: { row: number; column: number }[] = [];
  for (const part of text.split(/[\s,;]+/).filter(Boolean)) {
    const m = /^\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(part);
    if (!m) return null;
    const r1 = Number(m[2]) - 1;
    const c1 = colIndex(m[1]);
    const r2 = m[4] ? Number(m[4]) - 1 : r1;
    const c2 = m[3] ? colIndex(m[3]) : c1;
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++)
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
        if (!out.some((x) => x.row === r && x.column === c)) out.push({ row: r, column: c });
        if (out.length > max) return null;
      }
  }
  return out.length ? out : null;
}

/** A typed value: numbers stay numbers, TRUE/FALSE become booleans. */
export function typedValue(text: string): ScenarioValue {
  const t = text.trim();
  if (t === "") return null;
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  const n = Number(t);
  return Number.isFinite(n) && /^[-+]?(\d|\.\d)/.test(t) ? n : text;
}

// ---- Summary report ---------------------------------------------------------

/**
 * The summary table Excel builds: changing cells and result cells down the
 * side, current values then one column per scenario.
 */
export function scenarioSummary(
  scenarios: Scenario[],
  changing: { row: number; column: number }[],
  current: { changing: ScenarioValue[]; results: ScenarioValue[] },
  results: { cell: { row: number; column: number }; perScenario: ScenarioValue[] }[],
): ScenarioValue[][] {
  const head: ScenarioValue[] = ["Scenario Summary", null, "Current Values:", ...scenarios.map((s) => s.name)];
  const rows: ScenarioValue[][] = [head, ["Changing Cells:", null, null, ...scenarios.map(() => null)]];
  changing.forEach((c, i) =>
    rows.push([null, cellRef(c), current.changing[i] ?? null, ...scenarios.map((s) => s.cells.find((x) => x.row === c.row && x.column === c.column)?.value ?? current.changing[i] ?? null)]),
  );
  if (results.length) {
    rows.push(["Result Cells:", null, null, ...scenarios.map(() => null)]);
    results.forEach((r, i) => rows.push([null, cellRef(r.cell), current.results[i] ?? null, ...r.perScenario]));
  }
  rows.push(["Notes: Current Values column represents values of changing cells at time Scenario Summary Report was created."]);
  return rows;
}

// ---- .xlsx ------------------------------------------------------------------

/** The worksheet's <scenarios> element (empty string when there are none). */
export function scenariosXml(list: Scenario[]): string {
  const valid = list.filter((s) => s.cells.length);
  if (!valid.length) return "";
  const all = new Map<string, { row: number; column: number }>();
  for (const s of valid) for (const c of s.cells) all.set(cellRef(c), c);
  const body = valid
    .map((s) => {
      const attrs = [`name="${esc(s.name.slice(0, 255))}"`, ...(s.locked !== false ? ['locked="1"'] : []), ...(s.hidden ? ['hidden="1"'] : []), `count="${s.cells.length}"`, ...(s.user ? [`user="${esc(s.user)}"`] : []), ...(s.comment ? [`comment="${esc(s.comment)}"`] : [])];
      const cells = s.cells.map((c) => `<inputCells r="${cellRef(c)}" val="${esc(c.value == null ? "" : typeof c.value === "boolean" ? (c.value ? "1" : "0") : String(c.value))}"/>`).join("");
      return `<scenario ${attrs.join(" ")}>${cells}</scenario>`;
    })
    .join("");
  return `<scenarios current="0" show="0" sqref="${[...all.keys()].join(" ")}">${body}</scenarios>`;
}

// Elements that come after <scenarios> in a worksheet.
const AFTER = /<(?:autoFilter|sortState|dataConsolidate|customSheetViews|mergeCells|phoneticPr|conditionalFormatting|dataValidations|hyperlinks|printOptions|pageMargins|pageSetup|headerFooter|rowBreaks|colBreaks|customProperties|cellWatches|ignoredErrors|smartTags|drawing|legacyDrawing|legacyDrawingHF|drawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/;

/** Puts (or replaces) the scenarios element in a worksheet part. */
export function patchScenarios(sheetXml: string, xml: string): string {
  const s = sheetXml.replace(/<scenarios\b[\s\S]*?<\/scenarios>|<scenarios\b[^>]*\/>/, "");
  if (!xml) return s;
  const at = AFTER.exec(s);
  return at ? s.slice(0, at.index) + xml + s.slice(at.index) : s.replace("</worksheet>", `${xml}</worksheet>`);
}

export function readScenarios(sheetXml: string, sheetId: string): Scenario[] {
  const block = /<(?:\w+:)?scenarios\b[\s\S]*?<\/(?:\w+:)?scenarios>/.exec(sheetXml)?.[0];
  if (!block) return [];
  const out: Scenario[] = [];
  for (const [i, m] of [...block.matchAll(/<(?:\w+:)?scenario\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?scenario>/g)].entries()) {
    const attr = (name: string) => {
      const v = new RegExp(`\\b${name}="([^"]*)"`).exec(m[1])?.[1];
      return v == null ? undefined : unesc(v);
    };
    const cells: ScenarioCell[] = [];
    for (const c of m[2].matchAll(/<(?:\w+:)?inputCells\b([^>]*)\/?>/g)) {
      const r = /\br="\$?([A-Za-z]{1,3})\$?(\d+)"/.exec(c[1]);
      const val = /\bval="([^"]*)"/.exec(c[1])?.[1];
      if (!r || val == null) continue;
      cells.push({ row: Number(r[2]) - 1, column: colIndex(r[1]), value: typedValue(unesc(val)) });
    }
    if (!cells.length) continue;
    const name = attr("name") || `Scenario ${i + 1}`;
    out.push({
      id: `xlsx-${sheetId}-${i + 1}`,
      sheetId,
      name,
      cells,
      ...(attr("comment") ? { comment: attr("comment") } : {}),
      ...(attr("user") ? { user: attr("user") } : {}),
      ...(attr("locked") === "0" || attr("locked") == null ? { locked: false } : {}),
      ...(attr("hidden") === "1" ? { hidden: true } : {}),
    });
  }
  return out;
}
