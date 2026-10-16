/** Shared display formatters for the accounting UI. */

export function formatMoney(value: number, opts: { cents?: boolean } = {}): string {
  const n = opts.cents ? value / 100 : value;
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDate(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

/** Money in any currency, for reports that mix companies. */
export function formatAmount(value: number, currency = 'USD'): string {
  try {
    return value.toLocaleString('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}
