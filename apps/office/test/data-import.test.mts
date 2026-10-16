// Get data: parsing CSV, JSON and HTML tables, the shaping steps, the
// refresh plan, the guard on web addresses, and queries in .xlsx.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { columnNames, detectDelimiter, detectFormat, gridFor, parseCsv, parseHtmlTables, parseJson, refreshCells, shape, typed, QUERY_RESOURCE, type QueryDef } from "../lib/data-import.ts";
import { checkUrl, isPrivateAddress, safeFetch } from "../lib/safe-fetch.ts";

test("CSV: quotes, separators and line breaks", () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\n1,"two\nlines"\n'), [["a", "b"], ["x, y", 'say "hi"'], ["1", "two\nlines"]]);
  assert.equal(detectDelimiter("a;b;c\n1;2;3\n"), ";");
  assert.equal(detectDelimiter("a\tb\n1\t2"), "\t");
  assert.deepEqual(parseCsv("﻿a|b\n1|2", "|"), [["a", "b"], ["1", "2"]]);
});

test("JSON: lists of records, nested fields, and where the list is", () => {
  assert.deepEqual(parseJson('[{"a":1,"b":{"c":"x"}},{"a":2,"d":true}]'), [["a", "b.c", "d"], [1, "x", null], [2, null, true]]);
  assert.deepEqual(parseJson('{"data":{"items":[[1,2],[3,4]]}}', "data.items"), [[1, 2], [3, 4]]);
  assert.deepEqual(parseJson('{"count":2,"results":[{"n":"a"},{"n":"b"}]}'), [["n"], ["a"], ["b"]], "the one list in an object is found");
  assert.deepEqual(parseJson("[1,2]"), [["Value"], [1], [2]]);
  assert.throws(() => parseJson('{"a":1}', "a.b"), /nothing at/);
});

test("HTML: each table, with spans, entities and nested tables apart", () => {
  const html = `<html><body><p>x</p>
  <table><caption>Prices</caption><thead><tr><th>Item</th><th colspan="2">Cost &amp; tax</th></tr></thead>
  <tbody><tr><td rowspan="2">Tea</td><td>1.50</td><td>0.10</td></tr><tr><td>2</td><td><b>0.2</b></td></tr></tbody></table>
  <table><tr><td>outer<table><tr><td>inner</td></tr></table></td></tr></table></body></html>`;
  const t = parseHtmlTables(html);
  assert.equal(t.length, 3);
  assert.equal(t[0].caption, "Prices");
  assert.deepEqual(t[0].grid, [["Item", "Cost & tax", "Cost & tax"], ["Tea", "1.50", "0.10"], ["Tea", "2", "0.2"]]);
  assert.deepEqual(t[1].grid, [["outer"]]);
  assert.deepEqual(t[2].grid, [["inner"]]);
  assert.equal(detectFormat("text/html; charset=utf-8", "", ""), "html");
  assert.equal(detectFormat("", "https://x/data.json?x=1", ""), "json");
  assert.equal(detectFormat("text/plain", "x", "a,b\n1,2"), "csv");
});

test("shaping: skip rows, headers, columns, empty rows and numbers", () => {
  assert.deepEqual([typed("1,234.5"), typed("007"), typed(" 3 "), typed("2024-01-02"), typed(""), typed("-.5")], [1234.5, "007", 3, "2024-01-02", null, -0.5]);
  const raw = [["report"], ["Name", "Qty", "Name"], ["a", "1", "x"], ["", "", ""], ["b", "2", "y"]];
  const steps = { skipRows: 1, headers: true, removeEmptyRows: true };
  assert.deepEqual(columnNames(raw, steps), ["Name", "Qty", "Name2"]);
  assert.deepEqual(shape(raw, steps), [["Name", "Qty", "Name2"], ["a", 1, "x"], ["b", 2, "y"]]);
  assert.deepEqual(shape(raw, { ...steps, columns: ["qty", "Name"] }), [["Qty", "Name"], [1, "a"], [2, "b"]]);
  assert.throws(() => shape(raw, { ...steps, columns: ["gone"] }), /None of the chosen columns/);
  assert.deepEqual(gridFor("x,y\n1,2", "csv", { headers: false }), [["x", "y"], [1, 2]]);
});

test("a refresh writes the new data and clears what is left of the old", () => {
  const { cells, size } = refreshCells({ row: 2, column: 1 }, [["a"], [1]], { rows: 3, columns: 2 });
  assert.deepEqual(size, { rows: 2, columns: 1 });
  assert.equal(cells.length, 6);
  assert.deepEqual(cells.filter((c) => c.value != null).map((c) => [c.row, c.column, c.value]), [[2, 1, "a"], [3, 1, 1]]);
  assert.deepEqual(cells.find((c) => c.row === 4 && c.column === 2)?.value, null);
});

test("web addresses on private networks are refused", async () => {
  for (const a of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1", "::ffff:a00:1", "64:ff9b::7f00:1", "224.0.0.1"]) assert.ok(isPrivateAddress(a), a);
  for (const a of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) assert.ok(!isPrivateAddress(a), a);
  await assert.rejects(checkUrl("file:///etc/passwd"), /Only http and https/);
  await assert.rejects(checkUrl("http://user:pw@example.com/"), /user name/);
  await assert.rejects(checkUrl("http://127.0.0.1/"), /private or local/);
  await assert.rejects(checkUrl("http://[::ffff:7f00:1]/"), /private or local/);
  await assert.rejects(checkUrl("http://169.254.169.254/latest/meta-data"), /private or local/);
  await assert.rejects(checkUrl("http://8.8.8.8:22/"), /standard web ports/);
  await assert.rejects(checkUrl("http://localhost/"), /private or local|could not be found/);
  assert.equal((await checkUrl("https://1.1.1.1/x")).address, "1.1.1.1");
});

test("an allowed internal host can be fetched, but not redirected away from", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/data.csv") return void res.writeHead(200, { "content-type": "text/csv" }).end("a,b\n1,2\n");
    if (req.url === "/away") return void res.writeHead(302, { location: "http://10.0.0.1/" }).end();
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const before = process.env.IMPORT_ALLOW_HOSTS;
  try {
    await assert.rejects(safeFetch(`http://127.0.0.1:${port}/data.csv`), /standard web ports|private/);
    process.env.IMPORT_ALLOW_HOSTS = "127.0.0.1";
    const got = await safeFetch(`http://127.0.0.1:${port}/data.csv`);
    assert.equal(got.text, "a,b\n1,2\n");
    assert.match(got.contentType, /csv/);
    await assert.rejects(safeFetch(`http://127.0.0.1:${port}/away`), /private or local/);
    await assert.rejects(safeFetch(`http://127.0.0.1:${port}/missing`), /answered 404/);
  } finally {
    if (before == null) delete process.env.IMPORT_ALLOW_HOSTS;
    else process.env.IMPORT_ALLOW_HOSTS = before;
    server.close();
  }
});

test("queries round-trip through .xlsx as connections and query tables", async () => {
  const { univerToXlsx, xlsxToUniver } = await import("../lib/xlsx.ts");
  const JSZip = (await import("jszip")).default;
  const web: QueryDef = { id: "q1", name: "Prices", sheetId: "sheet-1", anchor: { row: 1, column: 1 }, size: { rows: 3, columns: 2 }, source: { kind: "web", url: "https://example.com/p.html", format: "html" }, steps: { headers: true, table: 2 } };
  const file: QueryDef = { id: "q2", name: "Local", sheetId: "sheet-1", anchor: { row: 0, column: 5 }, size: { rows: 2, columns: 1 }, source: { kind: "file", fileName: "x.csv", format: "csv" }, steps: { headers: false, delimiter: ";" } };
  const book = {
    id: "u",
    name: "W",
    appVersion: "",
    locale: "enUS",
    styles: {},
    sheetOrder: ["sheet-1"],
    sheets: { "sheet-1": { id: "sheet-1", name: "Data", cellData: { 1: { 1: { v: "Item" }, 2: { v: "Cost" } }, 2: { 1: { v: "Tea" }, 2: { v: 1.5 } }, 0: { 5: { v: 1 } } } } },
    resources: [{ name: QUERY_RESOURCE, data: JSON.stringify({ queries: [web, file] }) }],
  };
  const bytes = await univerToXlsx(book as any);
  const zip = await JSZip.loadAsync(bytes);
  const conns = await zip.file("xl/connections.xml")!.async("string");
  assert.match(conns, /<connection id="1" name="Prices" description="https:\/\/example.com\/p.html" type="4"[^>]*><webPr htmlTables="1" url="https:\/\/example.com\/p.html"><tables count="1"><x v="2"\/><\/tables><\/webPr>/);
  assert.match(conns, /<connection id="2" name="Local"[^>]* type="6"[^>]*><textPr codePage="65001" sourceFile="x.csv" delimited="1" tab="0" semicolon="1" firstRow="1"\/>/);
  assert.match(await zip.file("xl/queryTables/queryTable1.xml")!.async("string"), /<queryTable [^>]*name="ExternalData_1" connectionId="1"/);
  assert.match(await zip.file("xl/worksheets/_rels/sheet1.xml.rels")!.async("string"), /relationships\/queryTable" Target="..\/queryTables\/queryTable2.xml"/);
  assert.match(await zip.file("[Content_Types].xml")!.async("string"), /PartName="\/xl\/connections.xml" ContentType="application\/vnd.openxmlformats-officedocument.spreadsheetml.connections\+xml"/);
  assert.match(await zip.file("xl/workbook.xml")!.async("string"), /<definedName name="ExternalData_1" localSheetId="0" hidden="1">Data!\$B\$2:\$C\$4<\/definedName>/);
  assert.match(await zip.file("xl/_rels/workbook.xml.rels")!.async("string"), /relationships\/connections" Target="connections.xml"/);
  const back = await xlsxToUniver(bytes);
  const qs = JSON.parse(back.resources!.find((r) => r.name === QUERY_RESOURCE)!.data).queries as QueryDef[];
  assert.deepEqual(qs.map((q) => [q.name, q.source, q.steps, q.anchor, q.size]), [
    [web.name, web.source, web.steps, web.anchor, web.size],
    [file.name, file.source, file.steps, file.anchor, file.size],
  ]);
  assert.equal(back.resources!.some((r) => r.name === "SHEET_DEFINED_NAME_PLUGIN" && r.data.includes("ExternalData")), false);
});

test("a web query made by Excel comes in as a query; other connections are kept as they are", async () => {
  const { univerToXlsx, xlsxToUniver } = await import("../lib/xlsx.ts");
  const JSZip = (await import("jszip")).default;
  const base = await univerToXlsx({ id: "u", name: "W", appVersion: "", locale: "enUS", styles: {}, sheetOrder: ["s"], sheets: { s: { id: "s", name: "Sheet1", cellData: { 0: { 0: { v: 1 } } } } }, resources: [] } as any);
  const zip = await JSZip.loadAsync(base);
  zip.file(
    "xl/connections.xml",
    `<?xml version="1.0" encoding="UTF-8"?><connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><connection id="1" name="Rates" type="4" refreshedVersion="6" background="1" saveData="1"><webPr htmlTables="1" url="https://example.com/rates"><tables count="1"><x v="3"/></tables></webPr></connection><connection id="2" keepAlive="1" name="Query - Sales" description="Connection to the 'Sales' query" type="5" refreshedVersion="8" background="1"><dbPr connection="Provider=Microsoft.Mashup.OleDb.1;Location=Sales" command="SELECT * FROM [Sales]"/></connection><connection id="3" name="ThisWorkbookDataModel" type="5" model="1"/></connections>`,
  );
  zip.file("xl/_rels/workbook.xml.rels", (await zip.file("xl/_rels/workbook.xml.rels")!.async("string")).replace("</Relationships>", '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections" Target="connections.xml"/></Relationships>'));
  zip.file("xl/queryTables/queryTable1.xml", `<queryTable xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="ExternalData_1" connectionId="1" autoFormatId="16"/>`);
  zip.file("xl/worksheets/_rels/sheet1.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/queryTable" Target="../queryTables/queryTable1.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", (await zip.file("xl/workbook.xml")!.async("string")).replace(/<\/workbook>/, '<definedNames><definedName name="ExternalData_1" localSheetId="0" hidden="1">Sheet1!$C$3:$D$9</definedName></definedNames></workbook>').replace(/<definedNames>([\s\S]*?)<\/definedNames>([\s\S]*?)<definedNames>/, "<definedNames>$1$2"));
  const back = await xlsxToUniver(await zip.generateAsync({ type: "uint8array" }));
  const qs = JSON.parse(back.resources!.find((r) => r.name === QUERY_RESOURCE)!.data).queries as QueryDef[];
  assert.deepEqual(qs.map((q) => [q.name, q.source.kind, q.anchor, q.size, !!q.foreign]), [
    ["Rates", "web", { row: 2, column: 2 }, { rows: 7, columns: 2 }, false],
    ["Query - Sales", "file", { row: 0, column: 0 }, undefined, true],
  ]);
  assert.equal(qs[0].steps.table, 3);
  const again = await JSZip.loadAsync(await univerToXlsx(back));
  const conns = await again.file("xl/connections.xml")!.async("string");
  assert.match(conns, /<connection id="2" keepAlive="1" name="Query - Sales"[^>]*><dbPr connection="Provider=Microsoft.Mashup.OleDb.1;Location=Sales"/, "kept as it was");
  assert.doesNotMatch(conns, /ThisWorkbookDataModel/);
});
