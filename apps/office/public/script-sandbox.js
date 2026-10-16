// The sandbox Automate scripts run in (see lib/script-worker.ts). The page
// loads this text and starts it as a worker from a data: URL, so it has an
// opaque origin; here the network and storage APIs are taken away first.
// A script gets a copy of the workbook's values and an Office Scripts style
// API; its changes are sent back as a list of operations.
// Reading a formula's result after the script has changed cells needs the
// workbook to recalculate: the run stops there and asks for the results
// after its first N changes ("sync"); the page works them out on the live
// sheet and runs the script again with those results ("oracle"), until it
// gets through. Scripts are deterministic (no network, clock or storage
// access that differs between runs), so each run retraces the last.
// Plain JavaScript on purpose: it runs as is, without the app's compiler.
(() => {
  function sandbox() {
    const g = globalThis;
    for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches", "BroadcastChannel", "Worker", "SharedWorker", "Request", "Response", "navigator", "location", "WebTransport", "RTCPeerConnection", "FileReaderSync"]) {
      try {
        let o = g;
        while (o) {
          if (Object.prototype.hasOwnProperty.call(o, name)) Object.defineProperty(o, name, { value: void 0, writable: false, configurable: false });
          o = Object.getPrototypeOf(o);
        }
      } catch {
      }
    }
    const post = globalThis.postMessage.bind(globalThis);
    const onMessage = (e) => {
      const { code, snapshot, oracle = {} } = e.data;
      let dirty = false;
      const SYNC = {};
      // Where the first unanswered read was (kept even if the script catches the stop).
      let needSync = -1;
      const logs = [];
      const ops = [];
      const MAX_OPS = 2e4;
      const push = (op) => {
        if (ops.length >= MAX_OPS) throw new Error("The script made too many changes (20,000 at most).");
        ops.push(op);
        if (op.op === "values" || op.op === "clear") dirty = true;
      };
      const colIndex = (s) => s.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const colName = (c) => {
        let s = "";
        for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
        return s;
      };
      const parse = (a) => {
        const m = /^\s*\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?\s*$/.exec(a);
        if (!m) throw new Error(`"${a}" is not a cell or range address.`);
        const r1 = Number(m[2]) - 1;
        const c1 = colIndex(m[1]);
        const r2 = m[4] ? Number(m[4]) - 1 : r1;
        const c2 = m[3] ? colIndex(m[3]) : c1;
        return { row: Math.min(r1, r2), column: Math.min(c1, c2), rows: Math.abs(r2 - r1) + 1, columns: Math.abs(c2 - c1) + 1 };
      };
      const sheets = snapshot.sheets.map((s) => ({ name: s.name, values: s.values.map((r) => r.slice()), formulas: s.formulas.map((r) => r.slice()) }));
      let active = snapshot.active;
      const at = (s, r, c) => s.values[r] ? s.values[r][c] : void 0;
      // Before reading formula results that changes since the copy was made may move: bring them up to date.
      const fresh = (s, b) => {
        if (!dirty) return;
        let formulas = false;
        for (let i = 0; i < b.rows && !formulas; i++) for (let j = 0; j < b.columns && !formulas; j++) if (s.formulas[b.row + i]?.[b.column + j]) formulas = true;
        if (!formulas) return;
        const answer = oracle[ops.length];
        if (!answer) {
          if (needSync < 0) needSync = ops.length;
          throw SYNC;
        }
        for (const x of sheets) {
          const got = answer[x.name];
          if (!got) continue;
          x.formulas.forEach((row, r) => row?.forEach((f, c) => {
            if (f) (x.values[r] ||= [])[c] = got[r]?.[c] ?? null;
          }));
        }
        dirty = false;
      };
      const put = (s, r, c, v, f) => {
        (s.values[r] ||= [])[c] = v;
        (s.formulas[r] ||= [])[c] = f;
      };
      const plain = (v) => {
        if (v == null) return null;
        if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        return String(v);
      };
      const filled = (s, r, c) => {
        const v = at(s, r, c);
        return v != null && v !== "" || !!s.formulas[r]?.[c];
      };
      // The block of filled cells around a range, as Ctrl+A finds it.
      const region = (s, b0) => {
        const b = { ...b0 };
        for (let grew = true; grew; ) {
          grew = false;
          const rowHas = (r) => r >= 0 && Array.from({ length: b.columns + 2 }, (_, j) => b.column - 1 + j).some((c) => c >= 0 && filled(s, r, c));
          const colHas = (c) => c >= 0 && Array.from({ length: b.rows + 2 }, (_, i) => b.row - 1 + i).some((r) => r >= 0 && filled(s, r, c));
          if (rowHas(b.row - 1)) (b.row--, b.rows++, grew = true);
          if (rowHas(b.row + b.rows)) (b.rows++, grew = true);
          if (colHas(b.column - 1)) (b.column--, b.columns++, grew = true);
          if (colHas(b.column + b.columns)) (b.columns++, grew = true);
        }
        return b;
      };
      // Rows or columns inserted or deleted in the copy, so later reads see the move.
      const shiftCells = (s, dim, index, count, insert) => {
        for (const grid of [s.values, s.formulas]) {
          if (dim === "rows") {
            if (insert) grid.splice(index, 0, ...Array.from({ length: count }, () => []));
            else grid.splice(index, count);
          } else
            for (const row of grid) {
              if (!row) continue;
              if (insert) row.splice(index, 0, ...Array.from({ length: count }, () => null));
              else row.splice(index, count);
            }
        }
      };
      const rangeOf = (s, b) => {
        if (b.rows * b.columns > 1e6 && !b.whole) throw new Error("That range is too large.");
        const range = {
          getAddress: () => `${s.name}!${colName(b.column)}${b.row + 1}${b.rows * b.columns > 1 ? `:${colName(b.column + b.columns - 1)}${b.row + b.rows}` : ""}`,
          getRowCount: () => b.rows,
          getColumnCount: () => b.columns,
          getRowIndex: () => b.row,
          getColumnIndex: () => b.column,
          getWorksheet: () => worksheet(s),
          getCell: (r, c) => rangeOf(s, { row: b.row + r, column: b.column + c, rows: 1, columns: 1 }),
          getOffsetRange: (r, c) => rangeOf(s, { ...b, row: b.row + r, column: b.column + c }),
          getResizedRange: (r, c) => rangeOf(s, { ...b, rows: Math.max(1, b.rows + r), columns: Math.max(1, b.columns + c) }),
          getValue: () => (fresh(s, { ...b, rows: 1, columns: 1 }), at(s, b.row, b.column) ?? ""),
          getValues: () => fresh(s, b) ?? Array.from({ length: b.rows }, (_, i) => Array.from({ length: b.columns }, (_2, j) => at(s, b.row + i, b.column + j) ?? "")),
          getFormula: () => s.formulas[b.row]?.[b.column] ?? String(at(s, b.row, b.column) ?? ""),
          getFormulas: () => Array.from({ length: b.rows }, (_, i) => Array.from({ length: b.columns }, (_2, j) => s.formulas[b.row + i]?.[b.column + j] ?? String(at(s, b.row + i, b.column + j) ?? ""))),
          setValue: (v) => range.setValues(Array.from({ length: b.rows }, () => Array.from({ length: b.columns }, () => v))),
          setValues: (m) => {
            if (!Array.isArray(m) || m.length !== b.rows || m.some((r) => !Array.isArray(r) || r.length !== b.columns)) throw new Error(`setValues needs ${b.rows} rows of ${b.columns} values for ${range.getAddress()}.`);
            const cells = m.map(
              (r, i) => r.map((raw, j) => {
                const v = plain(raw);
                if (typeof v === "string" && v.startsWith("=")) {
                  put(s, b.row + i, b.column + j, null, v);
                  return { f: v };
                }
                put(s, b.row + i, b.column + j, v, null);
                return { v };
              })
            );
            push({ op: "values", sheet: s.name, row: b.row, column: b.column, cells });
          },
          setFormula: (f) => range.setValue(String(f).startsWith("=") ? f : `=${f}`),
          setFormulas: (m) => range.setValues(m.map((r) => r.map((f) => String(f).startsWith("=") ? f : `=${f}`))),
          clear: () => {
            for (let i = 0; i < b.rows; i++) for (let j = 0; j < b.columns; j++) if (at(s, b.row + i, b.column + j) !== void 0) put(s, b.row + i, b.column + j, null, null);
            push({ op: "clear", sheet: s.name, box: b });
          },
          setNumberFormat: (pattern) => push({ op: "format", sheet: s.name, box: b, pattern: String(pattern) }),
          setNumberFormatLocal: (pattern) => push({ op: "format", sheet: s.name, box: b, pattern: String(pattern) }),
          getFormat: () => ({
            getFont: () => ({
              setBold: (on) => push({ op: "style", sheet: s.name, box: b, style: { bold: !!on } }),
              setItalic: (on) => push({ op: "style", sheet: s.name, box: b, style: { italic: !!on } }),
              setColor: (color) => push({ op: "style", sheet: s.name, box: b, style: { color: String(color) } }),
              setSize: (size) => push({ op: "style", sheet: s.name, box: b, style: { size: Number(size) } }),
              setName: (name) => push({ op: "style", sheet: s.name, box: b, style: { font: String(name) } }),
              setUnderline: (u) => push({ op: "style", sheet: s.name, box: b, style: { underline: u !== "None" && u !== false && u != null } }),
              setStrikethrough: (on) => push({ op: "style", sheet: s.name, box: b, style: { strike: !!on } })
            }),
            getFill: () => ({ setColor: (color) => push({ op: "style", sheet: s.name, box: b, style: { fill: String(color) } }) }),
            setHorizontalAlignment: (a) => push({ op: "style", sheet: s.name, box: b, style: { align: String(a).toLowerCase() } }),
            setVerticalAlignment: (a) => push({ op: "style", sheet: s.name, box: b, style: { valign: String(a).toLowerCase() } }),
            setWrapText: (on) => push({ op: "style", sheet: s.name, box: b, style: { wrap: !!on } }),
            setColumnWidth: (px) => push({ op: "size", sheet: s.name, dim: "columns", index: b.column, count: b.columns, px: Number(px) }),
            setRowHeight: (px) => push({ op: "size", sheet: s.name, dim: "rows", index: b.row, count: b.rows, px: Number(px) }),
            autofitColumns: () => push({ op: "autofit", sheet: s.name, index: b.column, count: b.columns }),
            autofitRows: () => void 0
          }),
          getText: () => String(range.getValue() ?? ""),
          getTexts: () => range.getValues().map((r) => r.map((v) => String(v ?? ""))),
          getLastCell: () => rangeOf(s, { row: b.row + b.rows - 1, column: b.column + b.columns - 1, rows: 1, columns: 1 }),
          getLastRow: () => rangeOf(s, { ...b, row: b.row + b.rows - 1, rows: 1 }),
          getLastColumn: () => rangeOf(s, { ...b, column: b.column + b.columns - 1, columns: 1 }),
          getEntireRow: () => rangeOf(s, { row: b.row, rows: b.rows, column: 0, columns: 16384, whole: "rows" }),
          getEntireColumn: () => rangeOf(s, { column: b.column, columns: b.columns, row: 0, rows: 1048576, whole: "columns" }),
          getSurroundingRegion: () => rangeOf(s, region(s, b)),
          merge: (across) => push({ op: "merge", sheet: s.name, box: b, across: !!across }),
          unmerge: () => push({ op: "unmerge", sheet: s.name, box: b }),
          setRowHidden: (on) => push({ op: "hide", sheet: s.name, dim: "rows", index: b.row, count: b.rows, hidden: !!on }),
          setColumnHidden: (on) => push({ op: "hide", sheet: s.name, dim: "columns", index: b.column, count: b.columns, hidden: !!on }),
          insert: (shift) => {
            const dim = b.whole || (String(shift).toLowerCase() === "right" ? "columns" : "rows");
            if (!b.whole) throw new Error("Only whole rows or columns can be inserted from a script here: use getEntireRow() or getEntireColumn() first.");
            shiftCells(s, dim, dim === "rows" ? b.row : b.column, dim === "rows" ? b.rows : b.columns, true);
            push({ op: "insert", sheet: s.name, dim, index: dim === "rows" ? b.row : b.column, count: dim === "rows" ? b.rows : b.columns });
          },
          delete: (shift) => {
            const dim = b.whole || (String(shift).toLowerCase() === "left" ? "columns" : "rows");
            if (!b.whole) throw new Error("Only whole rows or columns can be deleted from a script here: use getEntireRow() or getEntireColumn() first.");
            shiftCells(s, dim, dim === "rows" ? b.row : b.column, dim === "rows" ? b.rows : b.columns, false);
            push({ op: "delete", sheet: s.name, dim, index: dim === "rows" ? b.row : b.column, count: dim === "rows" ? b.rows : b.columns });
          },
          getSort: () => ({
            apply: (fields, matchCase, hasHeaders) => {
              const top = hasHeaders ? 1 : 0;
              for (let i = top; i < b.rows; i++) for (let j = 0; j < b.columns; j++) if (s.formulas[b.row + i]?.[b.column + j]) throw new Error("Scripts here sort values only: this range has formulas.");
              const rows = Array.from({ length: b.rows - top }, (_, i) => Array.from({ length: b.columns }, (_2, j) => at(s, b.row + top + i, b.column + j) ?? null));
              const cmp = (x, y) => {
                if (x == null || x === "") return y == null || y === "" ? 0 : 1;
                if (y == null || y === "") return -1;
                if (typeof x === "number" && typeof y === "number") return x - y;
                const a = String(x);
                const c = String(y);
                return matchCase ? (a < c ? -1 : a > c ? 1 : 0) : a.localeCompare(c, void 0, { sensitivity: "base" });
              };
              rows.sort((p, q) => {
                for (const f of fields || [{ key: 0 }]) {
                  const k = Number(f.key) || 0;
                  const d = cmp(p[k], q[k]);
                  if (d) return f.ascending === false && p[k] != null && p[k] !== "" && q[k] != null && q[k] !== "" ? -d : d;
                }
                return 0;
              });
              if (rows.length) rangeOf(s, { row: b.row + top, column: b.column, rows: rows.length, columns: b.columns }).setValues(rows);
            }
          })
        };
        return range;
      };
      const used = (s) => {
        let maxR = -1;
        let maxC = -1;
        s.values.forEach(
          (r, i) => r?.forEach((v, j) => {
            if (v != null && v !== "" || s.formulas[i]?.[j]) {
              maxR = Math.max(maxR, i);
              maxC = Math.max(maxC, j);
            }
          })
        );
        return maxR < 0 ? null : { row: 0, column: 0, rows: maxR + 1, columns: maxC + 1 };
      };
      const worksheet = (s) => ({
        getName: () => s.name,
        getRange: (a) => rangeOf(s, parse(a)),
        getCell: (r, c) => rangeOf(s, { row: r, column: c, rows: 1, columns: 1 }),
        getRangeByIndexes: (r, c, rows, columns) => rangeOf(s, { row: r, column: c, rows, columns }),
        calculate: () => void 0,
        getUsedRange: () => {
          const b = used(s);
          return b ? rangeOf(s, b) : void 0;
        },
        activate: () => {
          active = s.name;
          push({ op: "activate", sheet: s.name });
        },
        setName: (name) => {
          const n = String(name);
          if (!n.trim() || find(n) && find(n) !== s) throw new Error(`There is already a sheet named ${n}.`);
          push({ op: "renameSheet", sheet: s.name, name: n });
          if (active === s.name) active = n;
          s.name = n;
        },
        delete: () => {
          if (sheets.length < 2) throw new Error("A workbook needs at least one sheet.");
          push({ op: "deleteSheet", sheet: s.name });
          sheets.splice(sheets.indexOf(s), 1);
          if (active === s.name) active = sheets[0].name;
        },
        getPosition: () => sheets.indexOf(s),
        setTabColor: (color) => push({ op: "sheet", sheet: s.name, tabColor: String(color) }),
        setVisibility: (v) => push({ op: "sheet", sheet: s.name, hidden: String(v).toLowerCase() !== "visible" }),
        setShowGridlines: (on) => push({ op: "sheet", sheet: s.name, gridlines: !!on }),
        getFreezePanes: () => ({
          freezeRows: (n) => push({ op: "freeze", sheet: s.name, rows: Number(n) || 0, columns: 0 }),
          freezeColumns: (n) => push({ op: "freeze", sheet: s.name, rows: 0, columns: Number(n) || 0 }),
          freezeAt: (a) => {
            const r = typeof a === "string" ? parse(a) : { row: a.getRowIndex(), column: a.getColumnIndex(), rows: a.getRowCount(), columns: a.getColumnCount() };
            push({ op: "freeze", sheet: s.name, rows: r.row + r.rows, columns: r.column + r.columns });
          },
          unfreeze: () => push({ op: "freeze", sheet: s.name, rows: 0, columns: 0 })
        }),
        addTable: (a, hasHeaders) => {
          const b = typeof a === "string" ? parse(a.replace(/^.*!/, "")) : { row: a.getRowIndex(), column: a.getColumnIndex(), rows: a.getRowCount(), columns: a.getColumnCount() };
          push({ op: "addTable", sheet: s.name, box: b, headers: hasHeaders !== false });
        }
      });
      const find = (name) => sheets.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
      const workbook = {
        getActiveWorksheet: () => worksheet(find(active) || sheets[0]),
        getWorksheet: (name) => {
          const s = find(name);
          return s ? worksheet(s) : void 0;
        },
        getWorksheets: () => sheets.map(worksheet),
        getFirstWorksheet: () => worksheet(sheets[0]),
        getLastWorksheet: () => worksheet(sheets[sheets.length - 1]),
        getSelectedRange: () => {
          const sel = snapshot.selection;
          const s = sel && find(sel.sheet);
          return s ? rangeOf(s, sel.box) : void 0;
        },
        getActiveCell: () => {
          const sel = snapshot.selection;
          const s = sel && find(sel.sheet);
          return s ? rangeOf(s, { row: sel.box.row, column: sel.box.column, rows: 1, columns: 1 }) : void 0;
        },
        addTable: (a, hasHeaders) => {
          const m = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(String(a));
          const s = m ? find((m[1] || m[2]).replace(/''/g, "'")) : find(active);
          if (!s) throw new Error(`No sheet for ${a}.`);
          worksheet(s).addTable(m ? m[3] : String(a), hasHeaders);
        },
        getApplication: () => ({ calculate: () => void 0 }),
        addWorksheet: (name) => {
          let n = name ? String(name) : `Sheet${sheets.length + 1}`;
          for (let k = 2; find(n); k++) n = `${name || "Sheet"}${k}`;
          const s = { name: n, values: [], formulas: [] };
          sheets.push(s);
          push({ op: "addSheet", name: n });
          return worksheet(s);
        }
      };
      const text = (x) => typeof x === "string" ? x : (() => {
        try {
          return JSON.stringify(x);
        } catch {
          return String(x);
        }
      })();
      const console = { log: (...a) => logs.length < 500 && logs.push(a.map(text).join(" ")) };
      try {
        const js = code;
        const ExcelScript = {
          HorizontalAlignment: { general: "General", left: "Left", center: "Center", right: "Right", fill: "Fill", justify: "Justify", centerAcrossSelection: "CenterAcrossSelection", distributed: "Distributed" },
          VerticalAlignment: { top: "Top", center: "Center", bottom: "Bottom", justify: "Justify", distributed: "Distributed" },
          InsertShiftDirection: { down: "Down", right: "Right" },
          DeleteShiftDirection: { up: "Up", left: "Left" },
          SheetVisibility: { visible: "Visible", hidden: "Hidden", veryHidden: "VeryHidden" },
          RangeUnderlineStyle: { none: "None", single: "Single", double: "Double", singleAccountant: "SingleAccountant", doubleAccountant: "DoubleAccountant" }
        };
        const main = new Function("console", "ExcelScript", `"use strict";
${js}
;return typeof main === "function" ? main : null;`)(console, ExcelScript);
        if (!main) throw new Error("The script needs a function main(workbook).");
        const returned = main(workbook);
        if (needSync >= 0) throw SYNC;
        if (returned && typeof returned.then === "function") throw new Error("Scripts run synchronously here: main can't be async.");
        post({ ok: true, ops, logs, returned: plain(returned) ?? void 0 });
      } catch (err) {
        if (needSync >= 0) {
          post({ ok: false, sync: needSync, error: "", logs, ops: ops.slice(0, needSync) });
          return;
        }
        post({ ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err), logs, ops });
      }
    };
    globalThis.onmessage = onMessage;
  }
  sandbox();
})();
