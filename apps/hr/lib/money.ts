/** Money is kept in whole cents everywhere in payroll, so sums never drift. */

export function toCents(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Rounds a fractional cent amount to whole cents (half away from zero). */
export function roundCents(c: number): number {
  return Math.sign(c) * Math.round(Math.abs(c));
}

/** Cents as a plain decimal string: 123456 -> "1234.56". */
export function centsToDecimal(c: number): string {
  const neg = c < 0;
  const abs = Math.abs(Math.round(c));
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Cents for people: 123456 -> "$1,234.56". */
export function formatCents(c: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Math.round(c) / 100);
}
