// Formula engine conformance test.
// Expected values are what Google Sheets returns for the same input.
import { compile, evaluate, FErr, addr, parseAddr, colToName, nameToCol } from '../web/sheets/formula.js';

// Fixture grid:
//      A          B        C         D
// 1    Widget     10       2.5       2026-01-05(serial 46027)
// 2    Gadget     20       7.5       x
// 3    Doohickey  30       1.25
// 4    Widget     40       0
// 5    (blank)    50       -3
const CELLS = {
  A1: 'Widget', B1: 10, C1: 2.5,   D1: 46027,
  A2: 'Gadget', B2: 20, C2: 7.5,   D2: 'x',
  A3: 'Doohickey', B3: 30, C3: 1.25,
  A4: 'Widget', B4: 40, C4: 0,
  A5: '',       B5: 50, C5: -3,
  E1: 1, E2: 2, E3: 3,
  F1: 'a', F2: 'b', F3: 'c',
};

const resolver = {
  self: { r: 9, c: 9 },
  cell: ref => {
    const k = ref.replace(/\$/g, '').toUpperCase();
    return k in CELLS ? CELLS[k] : '';
  },
  range: rs => {
    const [s, e] = rs.split(':').map(x => parseAddr(x.replace(/\$/g, '')));
    if (!s || !e) return null;
    const out = [];
    for (let r = Math.min(s.r, e.r); r <= Math.max(s.r, e.r); r++) {
      const row = [];
      for (let c = Math.min(s.c, e.c); c <= Math.max(s.c, e.c); c++) {
        const k = addr(r, c);
        row.push(k in CELLS ? CELLS[k] : '');
      }
      out.push(row);
    }
    return out;
  },
};

function calc(src) {
  const ast = compile(src);
  if (!ast) return '#ERROR!';
  const v = evaluate(ast, resolver);
  if (v instanceof FErr) return v.code;
  if (Array.isArray(v)) return JSON.stringify(v);
  return v;
}

const CASES = [
  // --- arithmetic & precedence ---
  ['1+2*3', 7], ['(1+2)*3', 9], ['2^3^2', 512], ['-2^2', 4], ['10/4', 2.5],
  ['1/0', '#DIV/0!'], ['5%', 0.05], ['50%*200', 100], ['-(3+4)', -7],
  ['1e3+1', 1001], ['2*-3', -6], ['10-2-3', 5],

  // --- comparison & text ---
  ['1<2', true], ['2<=2', true], ['3<>3', false], ['"a"&"b"', 'ab'],
  ['"x"="X"', true], ['1&2', '12'], ['B1>B2', false], ['A1="Widget"', true],

  // --- references ---
  ['B1', 10], ['B1+B2', 30], ['$B$1*2', 20], ['A5', ''], ['Z99', ''],

  // --- SUM family ---
  ['SUM(B1:B5)', 150], ['SUM(B1:B5,10)', 160], ['SUM(A1:A5)', 0],
  ['AVERAGE(B1:B5)', 30], ['AVERAGE(C1:C5)', 1.65],
  ['MIN(B1:B5)', 10], ['MAX(B1:B5)', 50], ['COUNT(B1:B5)', 5],
  ['COUNT(A1:A5)', 0], ['COUNTA(A1:A5)', 4], ['COUNTBLANK(A1:A5)', 1],
  ['PRODUCT(E1:E3)', 6], ['MEDIAN(B1:B5)', 30], ['MEDIAN(E1:E3)', 2],
  ['SUMPRODUCT(E1:E3,E1:E3)', 14],

  // --- math ---
  ['ABS(-5)', 5], ['SQRT(16)', 4], ['SQRT(-1)', '#NUM!'], ['POWER(2,10)', 1024],
  ['MOD(10,3)', 1], ['MOD(-1,3)', 2], ['MOD(5,0)', '#DIV/0!'],
  ['INT(3.9)', 3], ['INT(-3.1)', -4], ['TRUNC(-3.9)', -3],
  ['ROUND(2.5)', 3], ['ROUND(-2.5)', -3], ['ROUND(3.14159,2)', 3.14],
  ['ROUNDUP(3.1)', 4], ['ROUNDDOWN(3.9)', 3], ['CEILING(4.2,1)', 5],
  ['FLOOR(4.8,1)', 4], ['SIGN(-9)', -1], ['LOG(100)', 2], ['LN(1)', 0],

  // --- logic ---
  ['IF(TRUE,1,2)', 1], ['IF(FALSE,1,2)', 2], ['IF(B1>5,"big","small")', 'big'],
  ['IF(1/0,1,2)', '#DIV/0!'],
  ['IF(FALSE,1/0,"safe")', 'safe'],            // lazy: must NOT evaluate 1/0
  ['AND(TRUE,TRUE)', true], ['AND(TRUE,FALSE)', false],
  ['OR(FALSE,TRUE)', true], ['NOT(TRUE)', false], ['XOR(TRUE,TRUE)', false],
  ['IFERROR(1/0,"oops")', 'oops'], ['IFERROR(5,"oops")', 5],
  ['IFS(FALSE,1,TRUE,2)', 2], ['IFS(FALSE,1)', '#N/A'],
  ['ISBLANK(A5)', true], ['ISBLANK(A1)', false],
  ['ISNUMBER(B1)', true], ['ISNUMBER(A1)', false], ['ISTEXT(A1)', true],
  ['ISERROR(1/0)', true], ['ISERROR(1)', false],

  // --- conditional aggregates ---
  ['SUMIF(A1:A5,"Widget",B1:B5)', 50],
  ['SUMIF(B1:B5,">20")', 120],
  ['SUMIF(B1:B5,">=30")', 120],
  ['COUNTIF(A1:A5,"Widget")', 2],
  ['COUNTIF(B1:B5,">15")', 4],
  ['COUNTIF(A1:A5,"W*")', 2],
  ['AVERAGEIF(A1:A5,"Widget",B1:B5)', 25],
  ['SUMIFS(B1:B5,A1:A5,"Widget")', 50],
  ['SUMIFS(B1:B5,A1:A5,"Widget",C1:C5,">1")', 10],
  ['COUNTIFS(A1:A5,"Widget",B1:B5,">20")', 1],

  // --- lookup ---
  ['VLOOKUP("Gadget",A1:B5,2,FALSE)', 20],
  ['VLOOKUP("Nope",A1:B5,2,FALSE)', '#N/A'],
  ['VLOOKUP("Doohickey",A1:C5,3,FALSE)', 1.25],
  ['VLOOKUP("Gadget",A1:B5,5,FALSE)', '#VALUE!'],
  ['MATCH("Doohickey",A1:A5,0)', 3],
  ['MATCH("Nope",A1:A5,0)', '#N/A'],
  ['MATCH(30,B1:B5,0)', 3],
  ['INDEX(B1:B5,2)', 20],
  ['INDEX(A1:C5,2,3)', 7.5],
  ['INDEX(B1:B5,MATCH("Widget",A1:A5,0))', 10],
  ['XLOOKUP("Gadget",A1:A5,B1:B5)', 20],
  ['XLOOKUP("Nope",A1:A5,B1:B5,"missing")', 'missing'],
  ['CHOOSE(2,"a","b","c")', 'b'],
  ['ROWS(A1:A5)', 5], ['COLUMNS(A1:C5)', 3],

  // --- text ---
  ['LEN("hello")', 5], ['UPPER("abc")', 'ABC'], ['LOWER("ABC")', 'abc'],
  ['LEFT("hello",2)', 'he'], ['RIGHT("hello",3)', 'llo'], ['MID("hello",2,3)', 'ell'],
  ['TRIM("  a  b  ")', 'a b'], ['PROPER("john SMITH")', 'John Smith'],
  ['CONCATENATE("a","b","c")', 'abc'], ['TEXTJOIN("-",TRUE,"a","b")', 'a-b'],
  ['SUBSTITUTE("a-b-c","-","+")', 'a+b+c'],
  ['SUBSTITUTE("a-b-c","-","+",2)', 'a-b+c'],
  ['REPLACE("abcdef",2,3,"XY")', 'aXYef'],
  ['FIND("b","abc")', 2], ['FIND("z","abc")', '#VALUE!'],
  ['SEARCH("B","abc")', 2], ['REPT("ab",3)', 'ababab'],
  ['EXACT("a","A")', false], ['VALUE("42")', 42], ['CHAR(65)', 'A'], ['CODE("A")', 65],
  ['TEXT(0.1234,"0.0%")', '12.3%'],
  ['TEXT(1234.5,"$0.00")', '$1,234.50'],

  // --- dates ---
  ['YEAR(46027)', 2026], ['MONTH(46027)', 1], ['DAY(46027)', 5],
  ['DATE(2026,1,5)', 46027], ['DAYS(46030,46027)', 3],

  // --- errors propagate ---
  ['NOTAFUNCTION(1)', '#NAME?'],
  ['SUM(B1:B5)/0', '#DIV/0!'],
  ['1+"abc"', '#VALUE!'],
  ['SUM(', '#ERROR!'],
  ['1+', '#ERROR!'],
  [')', '#ERROR!'],
  ['IFERROR(VLOOKUP("Nope",A1:B5,2,FALSE),0)', 0],

  // --- nesting ---
  ['SUM(B1:B5)-AVERAGE(B1:B5)', 120],
  ['IF(SUM(B1:B5)>100,ROUND(AVERAGE(C1:C5),1),0)', 1.7],
  ['ROUND(SUM(B1:B3)*1.075,2)', 64.5],
  ['UPPER(LEFT(A1,3))&"-"&TEXT(B1,"0")', 'WID-10'],
];

// address helpers
const ADDR_CASES = [
  [() => colToName(0), 'A'], [() => colToName(25), 'Z'], [() => colToName(26), 'AA'],
  [() => colToName(701), 'ZZ'], [() => colToName(702), 'AAA'],
  [() => nameToCol('A'), 0], [() => nameToCol('Z'), 25], [() => nameToCol('AA'), 26],
  [() => nameToCol('ZZ'), 701], [() => addr(0, 0), 'A1'], [() => addr(9, 27), 'AB10'],
];

let pass = 0, fail = 0;
const failures = [];

for (const [src, want] of CASES) {
  let got;
  try { got = calc(src); } catch (e) { got = 'THREW: ' + e.message; }
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) < 1e-9
    : got === want;
  if (ok) pass++; else { fail++; failures.push({ src, want, got }); }
}
for (const [fn, want] of ADDR_CASES) {
  let got; try { got = fn(); } catch (e) { got = 'THREW'; }
  if (got === want) pass++; else { fail++; failures.push({ src: fn.toString(), want, got }); }
}

console.log(`\nFormula engine: ${pass}/${pass + fail} passed, ${fail} failed\n`);
if (failures.length) {
  for (const f of failures)
    console.log(`  FAIL  ${f.src}\n        want ${JSON.stringify(f.want)}  got ${JSON.stringify(f.got)}`);
  process.exit(1);
}
console.log('All formula cases match Google Sheets behaviour.\n');
