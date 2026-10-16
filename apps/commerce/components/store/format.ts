// Money and availability wording, shared by the server pages and the cart.

/** A formatter for the store's currency; falls back to plain numbers if the code is unknown. */
export function moneyFormatter(currency: string): (amount: string | number) => string {
  let fmt: Intl.NumberFormat;
  try {
    fmt = new Intl.NumberFormat(undefined, { style: "currency", currency });
  } catch {
    fmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return (amount) => {
    const n = typeof amount === "number" ? amount : Number(amount);
    return fmt.format(Number.isFinite(n) ? n : 0);
  };
}

/** "Sold out", "Only 3 left", or null when there's plenty (or it isn't tracked). */
export function stockNote(available: number | null): { text: string; tone: "out" | "low" } | null {
  if (available === null) return null;
  if (available <= 0) return { text: "Sold out", tone: "out" };
  if (available <= 5) return { text: `Only ${available} left`, tone: "low" };
  return null;
}

/** Up to two letters for a product with no picture. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
