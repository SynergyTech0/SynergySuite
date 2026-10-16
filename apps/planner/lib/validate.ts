// Colours reach the page as inline CSS, so anything but a hex colour is refused rather than escaped.
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export const isHexColor = (v: unknown): v is string => typeof v === "string" && HEX_COLOR.test(v);

/** A date from a JSON body: null/"" clears it, anything unparseable is `undefined` (reject). */
export function parseDate(v: unknown): Date | null | undefined {
  if (v === null || v === "") return null;
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
