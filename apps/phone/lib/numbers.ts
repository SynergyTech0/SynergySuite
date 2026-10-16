import { UserError } from "./util";

/**
 * Phone numbers are kept in E.164: a plus, the country code, then the number (+15551234567).
 * People type them every way there is, so anything with 7 to 15 digits is accepted; without a
 * leading + or 00 the default country code is put in front (PHONE_COUNTRY_CODE, 1 if unset).
 */
export function toE164(raw: unknown, countryCode = process.env.PHONE_COUNTRY_CODE || "1"): string | null {
  const s = String(raw ?? "").trim();
  if (!s || /[a-z@]/i.test(s)) return null;
  let digits = s.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (digits.startsWith("+")) {
    const d = digits.slice(1).replace(/\D/g, "");
    return d.length >= 7 && d.length <= 15 && !d.startsWith("0") ? `+${d}` : null;
  }
  const cc = countryCode.replace(/\D/g, "") || "1";
  // A national number with its trunk prefix (0 in most countries, 1 in North America).
  if (cc === "1" && digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  else if (cc !== "1" && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length < 7 || digits.length + cc.length > 15) return null;
  return `+${cc}${digits}`;
}

export function needE164(raw: unknown, what = "phone number"): string {
  const n = toE164(raw);
  if (!n) throw new UserError(`Enter a ${what} with its area code, like +1 555 123 4567`);
  return n;
}

/** +15551234567 → +1 555 123 4567 for North American numbers; others keep their digits in groups. */
export function formatNumber(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (m) return `+1 ${m[1]} ${m[2]} ${m[3]}`;
  const d = e164.replace(/^\+/, "");
  return `+${d.replace(/(\d{1,3})(?=(\d{3})+$)/g, "$1 ")}`;
}
