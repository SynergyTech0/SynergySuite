/**
 * Line-by-line comparison of two versions of a contract, for the redline view. Longest common
 * subsequence over lines; long texts fall back to a cheaper comparison so a huge paste can't stall
 * the server.
 */
export type DiffLine = { op: "same" | "add" | "del"; text: string };

const MAX_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  // Trim the shared start and end first: most edits touch a small part of a long contract.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head = a.slice(0, start).map((text): DiffLine => ({ op: "same", text }));
  const tail = a.slice(endA).map((text): DiffLine => ({ op: "same", text }));
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  let middle: DiffLine[];
  if (x.length * y.length > MAX_CELLS) {
    middle = [...x.map((text): DiffLine => ({ op: "del", text })), ...y.map((text): DiffLine => ({ op: "add", text }))];
  } else {
    const n = x.length;
    const m = y.length;
    const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
    middle = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) {
        middle.push({ op: "same", text: x[i] });
        i++;
        j++;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) middle.push({ op: "del", text: x[i++] });
      else middle.push({ op: "add", text: y[j++] });
    }
    while (i < n) middle.push({ op: "del", text: x[i++] });
    while (j < m) middle.push({ op: "add", text: y[j++] });
  }
  return [...head, ...middle, ...tail];
}
