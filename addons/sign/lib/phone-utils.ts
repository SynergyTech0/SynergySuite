/** Formats a 10-digit North American number as (555) 123-4567 while typing; anything else is left as typed. */
export function formatPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (value.trim().startsWith("+") || digits.length > 10) return value;
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
