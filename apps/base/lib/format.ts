/** How values show in a datasheet cell, and what goes in the box when a cell is edited. */
import type { Field } from "./fields";

export function display(f: Field, v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  switch (f.type) {
    case "currency": {
      const n = Number(v);
      try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency: f.options.currencyCode ?? "USD", minimumFractionDigits: f.options.decimals ?? 2, maximumFractionDigits: f.options.decimals ?? 2 }).format(n);
      } catch {
        return n.toFixed(2);
      }
    }
    case "number": {
      if (f.options.decimals === undefined) return String(v);
      return Number(v).toLocaleString("en-US", { minimumFractionDigits: f.options.decimals, maximumFractionDigits: f.options.decimals });
    }
    case "date": {
      const [y, m, d] = String(v).split("-");
      return `${Number(m)}/${Number(d)}/${y}`;
    }
    case "datetime":
      return new Date(String(v)).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" });
    case "yesno":
      return v ? "Yes" : "No";
    case "multichoice":
      return (v as string[]).join("; ");
    default:
      return String(v);
  }
}

/** A date-time as the value of an <input type="datetime-local"> (local time). */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Numbers and dates line up on the right, as in Access. */
export const alignRight = (f: Field) => ["autonumber", "number", "currency", "date", "datetime"].includes(f.type);
