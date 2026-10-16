# Office (Word, Excel and PowerPoint equivalent)

Documents, spreadsheets and slides with live co-editing. Documents use [Tiptap](https://tiptap.dev) with comments, sharing and Word import and export; spreadsheets use [Univer](https://univer.ai); everything syncs between editors through [Hocuspocus](https://tiptap.dev/docs/hocuspocus) (Yjs).

- **App:** Next.js 15 + React 19 (port 3070)
- **Collab server:** `server/collab.mjs` (port 3071). It checks each connection's role on the document and saves the shared state to Postgres, so documents are saved through it: run both.
- **Auth:** the suite gateway signs people in; `@synergy/identity` reads who they are.

## Run it locally

You need Node 22 and a Postgres database.

```
docker run -d --name office-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16-alpine
npm install && npm run build:packages            # from the repository root
cd apps/office

export DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/postgres
export DEV_USER_EMAIL=you@example.com
npm run collab                                   # collab server on :3071
NEXT_PUBLIC_COLLAB_URL=ws://localhost:3071 npm run dev   # in a second terminal: http://localhost:3070
```

The tables are created on first use. Without `NEXT_PUBLIC_COLLAB_URL` the editor looks for the collab server at `/collab` on its own host, which only exists behind the gateway.

`npm run typecheck` typechecks the app, as CI does.

## Spreadsheet protection

The owner of a spreadsheet can protect a range or a whole sheet (Data > Protect range / Protect sheet) and name the editors who may still change it. A protected sheet can leave ranges open to every editor. Viewers and commenters never edit.

The rules live in `lib/protection-rules.mjs` and are checked in three places:

- the browser cancels a blocked change before it runs and says why;
- the collab server (`server/protection-guard.mjs`) checks every edit in each message from someone other than the owner, and closes the connection with code 4403 if an edit breaks the rules (the page then reloads from the shared state). While anything is protected, only the owner may replace the whole workbook (open a file, or compact the edit log);
- the REST save route keeps the stored protections and protected cells when someone other than the owner saves.

Protected ranges move with inserted, deleted and moved rows and columns. Every client and the server work this out from the same edit log, so they agree.

In .xlsx files, a protected sheet is written as Excel sheet protection, with its open ranges as "allow edit ranges". Excel then enforces it too, without a password unless the file came with one. A range protection and the list of editors are written as hidden defined names (`_SynergyProtect1`, ...) that Excel keeps but doesn't enforce. A sheet protected in Excel opens protected (owner only), and its unlocked cells and edit ranges stay open. Excel's password hash is kept for the way back.

## Spreadsheet comments and pivot tables in .xlsx

Comment threads are written as Excel threaded comments. Each thread also gets a plain legacy comment, so older Excel versions and other programs still show the text. Opening such a file adds the threads to the spreadsheet's comments. People who aren't the person opening the file keep their names but aren't linked to an account. A note on a commented cell becomes the first message of the thread, because Excel allows only one of the two on a cell.

Pivot tables are written as real Excel pivot tables, with a pivot cache and records over the source range. The cache is marked to refresh when the file opens, so Excel lays the table out itself; the values we computed stay in the cells for programs that don't refresh. Excel pivot tables from a file come in as pivot definitions that can be refreshed. Pivot tables over a range on a sheet, an Excel table or a defined name are read; those over external data or the data model are not.

## Sparklines, shapes and what-if analysis

Insert > Line / Column / Win/Loss sparkline draws a small chart inside each location cell, one per row (or column) of the data range. Selecting a cell that holds a sparkline and choosing one of those items edits its group (type, colours, high/low/first/last/negative points) or clears it. Sparklines move with inserted and deleted rows and columns, and are written to .xlsx as Excel sparkline groups (the worksheet's x14 extension), which Excel and LibreOffice read; sparklines from those files come back.

Insert > Shape and Text box put a shape (rectangle, rounded rectangle, oval, triangle, right triangle, diamond, parallelogram, trapezoid, pentagon, hexagon, octagon, pentagon arrow, chevron, arrows in four directions, star, plus, callout or line) or a text box over the grid. Shapes move and resize like pictures, and double-clicking one (or Format > Format shape) changes its fill, outline, text and alignment. In .xlsx they are Excel shapes (`xdr:sp` with a preset geometry) in the sheet's drawing part. Shapes from Excel with other presets keep their preset on the way back but are drawn as rectangles. Grouped shapes (nested groups too) come in as separate shapes, each where it sits in the group; the grouping itself is not kept.

The Formulas menu has Trace precedents and Trace dependents (one more level per click, as in Excel; references to other sheets get a dashed arrow from a sheet icon), Remove arrows, and Show formulas (Ctrl+`), which only changes what is drawn for the person who turned it on. Names, tables and INDIRECT/OFFSET are not followed by the arrows.

Data > Goal Seek tries values in the changing cell until the formula reaches the target (secant steps with bisection once the answer is bracketed, 100 tries, within 0.001). The tries are not undo steps; the answer is entered as one edit, so Undo puts the old value back. Data > Scenario Manager keeps named sets of values for up to 32 changing cells per scenario, shows them on the sheet, and builds a Scenario Summary sheet for chosen result cells. Scenarios are written to .xlsx as the worksheet's scenarios, which Excel's Scenario Manager lists.

## Data tables and Solver

Data > Data table… works out a one- or two-variable data table for the selected block, as Excel lays it out: input values down the first column (column input cell), along the top row (row input cell) or both, with the formulas on the other edge. Each value is put into the input cell, the formula engine recalculates and the result is read back; the input cell is then restored and the results are entered as one undoable edit. After an edit, yours or a collaborator's, the workbook's data tables are worked out again. Each client works them out itself: the trial inputs stay on that client (they are not sent to others), and results that are already in the cells are not written again, so two clients settle on the same values instead of trading edits (Data > Recalculate data tables does it on demand); Remove data table leaves the results as plain values. In .xlsx a data table is Excel's TABLE formula (`<f t="dataTable">`), read back on import with its cached results.

Data > Solver… sets an objective cell to its maximum, minimum or a value by changing variable cells (up to 200), subject to <=, =, >=, integer and binary constraints, optionally keeping unconstrained variables non-negative. The model is worked out from the live formulas: when every cell involved is linear in the variables it is solved exactly by [HiGHS](https://highs.dev) (MIT, WebAssembly, served from `/vendor/highs/` and loaded on first use), including integer and binary variables; otherwise a penalty method with Nelder-Mead and pattern search is used, which suits small, smooth problems like Excel's GRG Nonlinear engine. The tries are not undo steps; Keep Solver solution enters the answer as one edit. Each sheet's model is saved with the workbook and written to .xlsx as Excel's hidden solver_* names, so Excel's Solver opens it (and settings we don't use are kept). AllDifferent constraints and the Evolutionary engine are not supported.

## Slicers, timelines and pivot charts

Insert > Slicer… adds a slicer for each chosen field of a table or a pivot table: a box of buttons over the grid, one per value. Clicking a button shows only that value; Ctrl-click (or Multi-select) adds and removes values; Clear shows all again. Insert > Timeline… does the same for a date field with a strip of periods (years, quarters, months or days); click a period, Shift-click to stretch the pick. On a table a pick sets the column's filter (one undo step); on a pivot table it sets the field's filter and the pivot table is written again. Slicers can be moved and resized like shapes and are shared with collaborators. Slicers on a pivot table are written to .xlsx as Excel's own slicers (a slicer cache tied to the pivot table and its cache, the slicer part on the sheet and its place in the drawing), so Excel shows working slicer buttons; Excel's pivot table slicers in a file come in as slicers here. Every slicer and timeline is also kept as hidden sheet-level names (`_SynergySlicerN`), which is what this app reads back; slicers on tables and timelines reach Excel only that way. Filters on a pivot table's row or column fields are written as the pivot table's hidden items, which Excel shows as the field's filter.

Insert > Pivot chart charts the pivot table under the selection: the innermost row field gives the categories and each value column a series (grand totals left out). When the pivot table changes (its fields, a refresh, a slicer), the chart follows. In .xlsx a pivot chart names its pivot table in the chart's `c:pivotSource`, as Excel writes pivot charts; the link is also kept in an extension of ours. Pivot charts from Excel are linked to their pivot table again by name.

## Automate (scripts) and macros

Automate > Scripts… opens the workbook's scripts: JavaScript in the style of Office Scripts (`function main(workbook) { ... }`, with `ExcelScript.*` type annotations accepted). The API covers `workbook.getActiveWorksheet()`, `getWorksheet(name)`, `getWorksheets()`, `addWorksheet()`, and on a worksheet `getRange("A1:B2")`, `getCell`, `getRangeByIndexes`, `getUsedRange` and `activate`; a range has `getValue(s)`, `setValue(s)`, `getFormula(s)`, `setFormula(s)`, `setNumberFormat`, `clear`, `getOffsetRange`, `getResizedRange` and `getFormat().getFont()/getFill()` for bold, italic and colours. `console.log` goes to the output pane. Automate > Record actions writes a script from your edits: values, formulas, clearing, bold, italic, colours and number formats.

A script runs in a sandbox: a Web Worker started from a `data:` URL (an opaque origin, so no cookies or same-origin access) whose network, storage and worker APIs are removed before the script starts (`public/script-sandbox.js`). It sees a copy of the workbook's values and formulas, and its changes come back as a list of operations that are applied when it finishes; a script that throws changes nothing. It is stopped after 10 seconds and may make up to 20,000 changes. Formulas are not recalculated while it runs. Scripts are saved with the workbook, shared with collaborators, run only when someone clicks Run, and travel in .xlsx as a custom XML part.

VBA macros are never run. An .xlsm keeps its VBA project (`xl/vbaProject.bin` and any signature) byte for byte, along with the code names its modules refer to, and downloads as .xlsm again. Other programs' custom XML parts (such as Power Query's DataMashup) are kept the same way.

## Get data (queries)

Data > Get data… loads CSV or other delimited text, JSON (a list of records, nested fields flattened to `a.b` columns, or the list at a dotted path) or a table on an HTML page, from a web address or a file. Before loading you can skip rows at the top, use the first row as headers, choose columns and drop empty rows; the preview shows the result. The data goes to a new sheet or a chosen cell, and the query (source and steps) is saved with the workbook. Refresh all queries fetches web sources again and rewrites their data, clearing rows that went away, as one undoable edit; a file query is refreshed from Queries and connections by choosing the file again.

Web addresses are fetched by the app's server (`POST /api/get-data`, signed-in users only): http and https on ports 80, 443, 8080 and 8443, no user names in the address, at most 10 MB and 15 seconds, and every address the host resolves to must be public. Loopback, private, link-local (including cloud metadata), carrier-grade NAT, multicast and reserved ranges are refused, IPv4 inside IPv6 included; the connection is made to the address that was checked and every redirect is checked again. `IMPORT_ALLOW_HOSTS` (comma-separated host names or addresses) lets an administrator allow particular internal hosts.

In .xlsx each query is a workbook connection in `xl/connections.xml` (a web query, or a text query naming the file) with a query table and its `ExternalData_n` range on the sheet, as Excel writes them; the full definition rides in the connection's extension list. Web queries made by Excel come in as refreshable queries; other connections (Power Query, databases) are kept as they are and written back, except ones tied to the workbook's data model.

## Dynamic arrays and calculation

FILTER, SORT, UNIQUE, SEQUENCE, LET, LAMBDA and the other dynamic-array functions spill into the cells below and to the right, and a spill reference such as `=SUM(C1#)` follows the spill as it grows or shrinks. In .xlsx a spilling formula is written as Excel writes dynamic arrays (an array formula with the `cm` cell-metadata flag and `xl/metadata.xml`), with its spilled values; new functions get Excel's `_xlfn.` prefix, LET and LAMBDA names `_xlpm.`, and `A1#` is stored as `_xlfn.ANCHORARRAY(A1)`.

Formulas > Calculation options… turns on iterative calculation (maximum iterations and maximum change) for formulas that refer to themselves; without it a circular reference shows a notice. The settings are shared with collaborators and written to the workbook's `calcPr`, and read from it. The engine stops after the iteration count; the maximum change is kept for Excel but not used here.

## Links to other workbooks

A formula such as `=[Budget]Plan!B2` or `='[Budget 2025]Plan'!B2` reads another spreadsheet in the suite. Typing one links the spreadsheet with that title; Data > Edit links… lists the links with Update values, Change source and Break link (which turns the formulas reading it into their values), and Add link. The linked values are kept with the workbook, so formulas work without opening the other spreadsheet, and are brought up to date when the workbook opens and on Update values. In .xlsx links are Excel's external links (`xl/externalLinks/externalLinkN.xml` with the cached values, formulas written as `[1]Plan!B2`); external links in an Excel file come in as links with their cached values.

## Version history

File > Version history saves named versions, and a version is saved automatically every minute while the spreadsheet changes. Each version can be previewed (sheet by sheet), compared with the current workbook (cells changed, added and removed) and restored, which replaces the workbook for everyone editing it. Versions use the same versions API as documents and presentations.

## Flash Fill, cell styles, themes and split panes

Data > Flash Fill (Ctrl+E) fills the column from the examples typed at its top: it learns which words of the neighbouring columns to take, in what case (as is, upper, lower, proper, initials) and with what text between them, so "John Smith" -> "Smith, J." fills the rest of the column. The fill is one undo step.

Format > Cell styles… applies Excel's built-in cell styles (Good, Bad, Neutral, headings, Accent 1-6 with their tints, Currency, Percent and others) and Format > Theme… changes the workbook theme (Office, Office 2023, Grayscale, Ocean, Forest, Sunset, Violet, Paper). Cells styled with theme colours change with the theme. The theme is written to `xl/theme/theme1.xml` and read from Excel files.

View > Split top and bottom (or side by side) opens a second pane on the same workbook, which scrolls and selects on its own; the bar between them can be dragged, and View > Remove split closes it. A split is written to .xlsx as Excel's split window, and a file saved split opens split.

## Analyze Data and Write a formula

Insert > Analyze Data… looks at the table around the selection and suggests pivot tables (with a pivot chart), charts and insights: which value leads a column and by how much, steady rises and falls, unusual values, and columns that move together. These are worked out from the numbers on this computer, with no AI model involved; Insert adds the suggestion to the workbook. When the suite has an AI model, More insights from AI asks it for plainly worded insights from a summary of the columns and the first 30 rows.

Formulas > Write a formula… asks the AI model for a formula from a request in plain language ("total Sales where Region is North"), giving it the cell, the table around it and its column names and a few rows. The answer is shown with an explanation and goes into the cell only on Insert.

Both use the suite's own model through `@synergy/ai` (bring your own: `AI_*` settings, or `OFFICE_AI_*` for this app), on the server (`/api/sheet-ai`, signed-in users only). Without a model they say AI is off; nothing is sent anywhere.

## Fidelity with real .xlsx files

`scripts/xlsx-fidelity.mts` opens .xlsx files the way the editor does, saves them again and compares the two: cell values, formulas, fonts, fills, number formats, alignment, borders, merges, column widths, comments, links, sheet visibility, and the parts (charts, pivot tables, tables, images, shapes, slicers, sparklines, conditional formatting, data validation, names, external links, frozen panes, filters).

```
node --import tsx scripts/xlsx-fidelity.mts <folder or files> [--json results.json]
```

It was run on 47 files from the test suites of [Apache POI](https://github.com/apache/poi/tree/trunk/test-data/spreadsheet) (42 files, Apache License 2.0) and [LibreOffice](https://github.com/LibreOffice/core/tree/master/sc/qa/unit/data/xlsx) (5 files, Mozilla Public License 2.0). The files are not kept in this repository. The first run found these losses, now fixed:

| Loss | Files | Fix |
|---|---|---|
| Excel tables dropped | ExcelTables, WithTable, StructuredReferences, DataValidationEvaluations, ExcelPivotTableSample | A table without `headerRowCount` (Excel's default of one header row) was read as having none. |
| Charts dropped | WithChart, WithThreeCharts, 45544, SimpleScatterChart | Series without categories, 3-D, doughnut, area, radar and scatter charts are read; area and scatter charts are drawn and written as such. |
| File would not open | ConditionalFormattingSamples (18 sheets) | Filters by icon, colour, top 10 or date period in a sheet's filter stopped the reader. |
| Pivot table dropped | ExcelPivotTableSample | A pivot cache whose source is a table or defined name (`worksheetSource name=`) is read. |

After milestone 7, 41 of the 47 came back with no difference. Milestone 8 fixed the other six, and now all 47 come back with no difference found:

| File | Was | Fix |
|---|---|---|
| chart_sheet | Chart sheets (a sheet that is only a chart) were not kept. | Read and written as Excel chart sheets (`xl/chartsheets/`), in their place among the sheets. |
| WithDrawing | EMF and WMF pictures were dropped. | Drawn as SVG on screen (the converter the Slides app uses) and written back as the original bytes. |
| groupShape | Grouped shapes came back ungrouped. | Kept as groups (`grpSp`), with Group and Ungroup in the editor. |
| customIndexedColors | A "very hidden" sheet came back as hidden. | `state="veryHidden"` is kept (hidden in the editor, written back as very hidden). |
| SimpleScatterChart | A second drawing that no sheet uses was dropped. | Both charts now come back. |
| sample-beta | A file from a beta of Excel 2007 (pre-release namespace and shared strings) did not open. | The pre-release namespace and `sstItem` strings are read. The checker's own reader (ExcelJS) still can't read the original, so for this file it compares parts only. |

Smaller differences the checker treats as the same: theme colours become the colours they stand for, identical data validation rules on neighbouring cells are merged, names that refer to `#REF!` are dropped, and Excel's built-in names (`_xlnm.`) are written by the app as needed.

## Slides: .pptx round-trip fidelity

`scripts/pptx-fidelity.mts` imports each .pptx, exports it again, and measures both packages the same way from their XML: slides, words of slide text (per paragraph, runs joined), words of speaker notes, pictures, tables, charts, visible shapes, groups and media. Losses show up as counts going down. It also lists the import warnings and how many files raised each one. The decks are only read as data.

```bash
cd apps/office
npx tsx scripts/pptx-fidelity.mts <dir or file>... [--json results.json] [--out exported/]
```

The corpus is not kept in the repository. It is 128 decks taken from the test files of three permissively licensed projects:

| Source | Files | Licence | Where |
|---|---|---|---|
| python-pptx | 60 | MIT | `tests/test_files` and `features/steps/test_files` |
| Apache POI | 27 | Apache-2.0 | `test-data/slideshow` |
| LibreOffice | 41 (every 7th file) | MPL-2.0 | `sd/qa/unit/data/pptx` |

Results before and after the fidelity fixes. Recall is how much of the source survives the round trip. The first run did not measure shapes, groups or media.

| Measure | Before | After | Milestone 10 |
|---|---|---|---|
| Files that round-trip | 120 / 128 | 127 / 128 | 127 / 128 |
| Slides | 366 / 366 | 373 / 366 (blank slides added to 7 templates) | 373 / 366 |
| Words of slide text | 100% | 100% | 100% |
| Words of speaker notes | 99.7% | 100% | 100% |
| Pictures | 71 / 78 | 75 / 78 | 75 / 78 |
| Tables | 15 / 15 | 15 / 15 | 15 / 15 |
| Charts | 94 / 95 | 94 / 95 | 94 / 95 |
| Visible shapes | not measured | 588 / 590 | 588 / 590 |
| Groups | not measured | 12 / 29 | 29 / 29 |
| Audio and video | not measured | 2 / 3 | 2 / 3 |

The fixes made in this pass:

- Templates with no slides open with one blank slide instead of failing. All their layouts, and the layouts of every other foreign master, are kept as custom layouts.
- Pictures whose `blipFill` sits inside `mc:AlternateContent` are read, using the fallback first.
- EMF and WMF pictures were skipped before. They are now drawn as SVG (`lib/slides/metafile.ts`), and the original metafile is written back into exported .pptx files.
- Speaker notes whose text holds line breaks are exported as one paragraph per line.

Known remaining losses:

- One POI file (`Divino_Revelado.pptx`) is a corrupt zip. POI's own test for it is disabled.
- Two pictures are linked to files on the author's disk (`r:link`), so there is no picture to import. A third has no `blipFill` at all.
- TIFF pictures (2) are skipped because browsers can't show them. One OLE object is skipped, and so is a chart with no series.
- One recording in a format browsers can't play becomes its poster picture, and 4 SmartArt graphics without a saved drawing are rebuilt from their text.

Milestone 10 brought the groups back: groups inside groups are kept (the 17 groups inside one group in `group-rot.pptx` come back as they were), and a SmartArt graphic inside a group of the slide's no longer takes its neighbours with it. Combination charts keep each series' chart type and axis.

## Docs: .docx round-trip fidelity

`scripts/docx-fidelity.mts` imports each .docx, exports it again, and measures both packages the same way from their XML. It counts words of body text, of the headers and footers the sections use, of the notes the text refers to and of the comments it refers to. It also counts paragraphs, tables, pictures, charts, SmartArt, equations, list paragraphs, fields, links, words in tracked changes, content controls, sections, comments and notes. Losses show up as counts going down. It lists the import warnings and how many files raised each one. The fallback half of `mc:AlternateContent` is left out of the counts, because it repeats its choice for older readers. The documents are only read as data.

```bash
cd apps/office
npx tsx scripts/docx-fidelity.mts <dir or file>... [--json results.json] [--out exported/]
```

The corpus is not kept in the repository. It is 266 documents taken from the test files of three permissively licensed projects:

| Source | Files | Licence | Where |
|---|---|---|---|
| python-docx | 44 | MIT | `tests/test_files` and `features/steps/test_files` |
| Apache POI | 130 | Apache-2.0 | `test-data/document` |
| LibreOffice | 92 (every 15th file) | MPL-2.0 | `sw/qa/extras/ooxmlexport/data` |

Results before and after the fidelity fixes. Recall is how much of the source survives the round trip. In the "before" column the document with 5,000 nested tables failed, so its text is not counted there.

| Measure | Before | After |
|---|---|---|
| Files that round-trip | 250 / 266 | 251 / 266 |
| Words of body text | 99.8% | 100.0% |
| Words in headers and footers | 73.0% | 97.2% |
| Words of footnotes and endnotes | 100% | 100% |
| Words of comments | 77.3% | 77.3% |
| Paragraphs | 21,979 / 22,041 | 27,037 / 27,041 |
| Tables | 214 / 214 | 238 / 5,214 (one file nests 5,000) |
| Pictures | 76 / 98 | 95 / 98 |
| Charts | 11 / 13 | 11 / 13 |
| SmartArt | 1 / 1 | 1 / 1 |
| Equations | 12 / 12 | 12 / 12 |
| Links | 400 / 400 | 400 / 400 |
| Words in tracked changes | 238 / 239 | 238 / 239 |
| Sections | 296 / 296 | 296 / 296 |
| Notes | 22 / 22 | 22 / 22 |
| Comments | 9 / 10 | 9 / 10 |

The 15 files that don't round-trip are 2 password-encrypted documents and 13 corrupt or truncated zips from POI's fuzzing tests. Encrypted documents now open with a message saying to remove the password, rather than a generic error.

The fixes made in this pass:

- Table rows inside content controls or custom XML (`w:sdt` around `w:tr`) were dropped. They are now read.
- A content control nested inside another dropped the inner text. The inner text now goes into the outer control. A control holding more than text, such as a picture or a field, is removed and its content kept.
- VML text boxes (`v:textbox` in `w:pict`, or the `mc:Fallback` of a shape) and groups of shapes with text (`wpg:wgp`) lost their text. Each becomes one borderless text box the size of the drawing.
- Embedded OLE objects (`w:object`) come in as their preview picture.
- EMF and WMF pictures were skipped. They are now drawn as SVG (with the Slides metafile converter), and the original metafile is written back on export.
- Legacy form fields (FORMTEXT, FORMCHECKBOX, FORMDROPDOWN) become text, checkbox and drop-down content controls. A text field whose result runs on past its paragraph (one in the corpus spans a whole table) no longer hides what follows.
- A comment on a point (a `commentReference` with no range) is anchored on the word before it.
- Tables nested more than 24 deep overflowed the stack. Below that depth they are flattened to their paragraphs.
- Headers marked `w:type="odd"` (some writers use it for the default) were dropped. They are now read as the default.
- Phonetic guides (`w:ruby`) lost the whole run. The base text is now kept and the guide is dropped.

Known remaining losses:

- Of the 161 fields in the corpus, 46 stayed fields when it was measured, and another 79 are legacy form fields, which come back as content controls. The rest (DOCPROPERTY, IF, `=` formulas, and the page numbers nested inside them) kept only their result text then. Since milestone 4 these are kept as fields, nested fields included, and they evaluate and update; the corpus has not been re-measured since.
- Page-number fields in headers and footers are written without the page numbers Word had cached. Word fills them in, but they count as missing words in the header and footer recall.
- Block-level content controls stay block controls, except in headers and footers and around a section break or page break, where they are unwrapped and their content kept.
- One comment sits on an empty paragraph with no text to anchor it to.
- Shapes inside a group lose their separate positions and become one text box.
- In the print layout, under mirror margins, a paragraph split across pages inside a list item or table cell keeps the margins of the page it starts on. Top-level paragraphs and table rows move to the next page's margins.
- Pictures in TIFF or PDF format can't be shown and are skipped. A picture linked to a file on the author's disk has nothing to import.
- A chart type that can't be drawn (2 `chartex` charts) is replaced by a placeholder. Combination charts keep each series' chart type and secondary axis, and SmartArt is written with full layout, style and colour definitions (both shared with Slides).
- INDEX columns are written in the field instruction, not as a section, so Word re-flows the index when it is updated.
- HTML export draws charts and SmartArt as empty boxes. Word's password hash in restrict editing is checked, and ours is written the way Word writes it.
- Mail merge that follows a Sheet live replays values, number formats and defined names, and recalculates formulas with the Sheets formula engine. Sheet edits that don't change data (conditional formats, drawings, notes, links, tables) are ignored. Mentions send an e-mail when SMTP is set up.
- .odt, .rtf and .doc need LibreOffice on the server: there is no permissively licensed browser reader or writer for them at Word fidelity. Ctrl+P prints every page at the largest section's paper size, and printing from the browser's own menu is not intercepted. The split window shows Web layout, not pages.

## Settings

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string. Both processes need the same one. |
| `DEV_USER_EMAIL` | Signs every request in as this user when there is no gateway. Ignored when `NODE_ENV=production`. |
| `NEXT_PUBLIC_COLLAB_URL` | WebSocket URL browsers use for the collab server, for example `wss://office.<domain>/collab`. Also a build argument in the Docker image. |
| `COLLAB_PORT` | Port for the collab server (default 3071). |
| `COLLAB_ADDRESS` | Address the collab server listens on (default `127.0.0.1`; the Docker deploy uses `0.0.0.0` so the gateway can reach it). |
| `DOCS_ORG` | Organisation every document belongs to (default `synergy`). |
| `DOCX2PDF_URL` / `DOCX2PDF_TOKEN` | Optional document-to-PDF converter (such as Gotenberg) for PDF export, and its bearer token. |
| `SUITE_DOMAIN` | The suite's domain, used by the suite header's app launcher and in the links of @mention e-mails. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASSWORD` / `MAIL_FROM` | Mail server for @mention e-mails (port 465 means TLS). People @mentioned in a comment who can open the document get an e-mail with a link. Without `SMTP_HOST` no mail is sent. |
| `PROXY_SHARED_SECRET` | Shared secret the gateway sends, so the app can't be reached around it. |
| `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | The suite's AI model (see `packages/ai`): any OpenAI-compatible server (OpenAI, vLLM, LM Studio, OpenRouter, Azure, Groq), Ollama or Anthropic. `OFFICE_AI_*` versions of these override them for this app only. Unset: AI features say AI is off. |

## Production

Deployed with the rest of the suite as the `office` and `office-collab` services in `deploy/compose.yml`; see [deploy/README.md](../../deploy/README.md).
