// iCalendar (RFC 5545) text: content lines in and out, the component tree, and the date-time
// values with time zones that events are made of. Time zones are IANA names; times are turned
// into instants with Intl, so expansion and storage agree on what "9:00 in New York" means on
// either side of a daylight saving change.

export type Prop = { name: string; params: Record<string, string>; value: string };
export type Component = { name: string; props: Prop[]; components: Component[] };

/** Joins folded lines: a line starting with a space or tab continues the one before. */
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1] += line.slice(1);
    else if (line.trim()) out.push(line);
  }
  return out;
}

export function parseLine(line: string): Prop | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const parts: string[] = [];
  let cur = "";
  quoted = false;
  for (const ch of head) {
    if (ch === '"') quoted = !quoted;
    if (ch === ";" && !quoted) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/"/g, "");
  }
  return { name: parts[0].toUpperCase(), params, value: line.slice(colon + 1) };
}

/** Parses an iCalendar object; throws on anything that isn't one. */
export function parseICalendar(text: string): Component {
  const stack: Component[] = [];
  let root: Component | null = null;
  for (const line of unfold(text)) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === "BEGIN") {
      const c: Component = { name: p.value.trim().toUpperCase(), props: [], components: [] };
      if (stack.length) stack[stack.length - 1].components.push(c);
      else if (!root) root = c;
      else throw new Error("more than one object");
      stack.push(c);
    } else if (p.name === "END") {
      const c = stack.pop();
      if (!c || c.name !== p.value.trim().toUpperCase()) throw new Error("mismatched END");
    } else if (stack.length) stack[stack.length - 1].props.push(p);
  }
  if (!root || stack.length) throw new Error("not a complete iCalendar object");
  return root;
}

export const getProp = (c: Component, name: string) => c.props.find((p) => p.name === name);
export const getProps = (c: Component, name: string) => c.props.filter((p) => p.name === name);

export function unescapeText(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_, ch: string) => (ch === "n" || ch === "N" ? "\n" : ch));
}
export function escapeText(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/** Folds at 75 octets (RFC 5545 3.1), never inside a UTF-8 character. */
export function fold(line: string): string {
  if (Buffer.byteLength(line) <= 75) return line;
  const out: string[] = [];
  let chunk = "";
  let size = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (size + n > (out.length ? 74 : 75)) {
      out.push(chunk);
      chunk = "";
      size = 0;
    }
    chunk += ch;
    size += n;
  }
  out.push(chunk);
  return out.join("\r\n ");
}

const paramValue = (v: string) => (/[;:,]/.test(v) ? `"${v.replace(/"/g, "")}"` : v);

export function serialize(c: Component): string {
  const lines: string[] = [];
  const walk = (x: Component) => {
    lines.push(`BEGIN:${x.name}`);
    for (const p of x.props) {
      const params = Object.entries(p.params).map(([k, v]) => `;${k}=${paramValue(v)}`).join("");
      lines.push(fold(`${p.name}${params}:${p.value}`));
    }
    x.components.forEach(walk);
    lines.push(`END:${x.name}`);
  };
  walk(c);
  return lines.join("\r\n") + "\r\n";
}

// ---- time zones ----

const zoneOk = new Map<string, boolean>();
export function isTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  if (!zoneOk.has(tz)) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      zoneOk.set(tz, true);
    } catch {
      zoneOk.set(tz, false);
    }
  }
  return zoneOk.get(tz)!;
}

// Windows zone names Outlook and Exchange put in TZID, for the most common zones.
const WINDOWS: Record<string, string> = {
  "Eastern Standard Time": "America/New_York", "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver", "US Mountain Standard Time": "America/Phoenix",
  "Pacific Standard Time": "America/Los_Angeles", "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu", "Atlantic Standard Time": "America/Halifax",
  "Canada Central Standard Time": "America/Regina", "SA Pacific Standard Time": "America/Bogota",
  "E. South America Standard Time": "America/Sao_Paulo", "Argentina Standard Time": "America/Buenos_Aires",
  "GMT Standard Time": "Europe/London", "Greenwich Standard Time": "Atlantic/Reykjavik", "UTC": "UTC",
  "W. Europe Standard Time": "Europe/Berlin", "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest", "Central European Standard Time": "Europe/Warsaw",
  "E. Europe Standard Time": "Europe/Chisinau", "FLE Standard Time": "Europe/Kiev", "GTB Standard Time": "Europe/Bucharest",
  "Russian Standard Time": "Europe/Moscow", "Turkey Standard Time": "Europe/Istanbul", "Israel Standard Time": "Asia/Jerusalem",
  "South Africa Standard Time": "Africa/Johannesburg", "Arabian Standard Time": "Asia/Dubai",
  "India Standard Time": "Asia/Kolkata", "China Standard Time": "Asia/Shanghai", "Singapore Standard Time": "Asia/Singapore",
  "Tokyo Standard Time": "Asia/Tokyo", "Korea Standard Time": "Asia/Seoul", "AUS Eastern Standard Time": "Australia/Sydney",
  "E. Australia Standard Time": "Australia/Brisbane", "W. Australia Standard Time": "Australia/Perth",
  "New Zealand Standard Time": "Pacific/Auckland",
};

/** An IANA zone for a TZID a client sent: IANA itself, a "/vendor/.../Area/City" path, or a Windows name. */
export function zoneFor(tzid: string | undefined, fallback = "UTC"): string {
  if (!tzid) return fallback;
  const t = tzid.trim();
  if (isTimeZone(t) && /\//.test(t)) return t;
  if (WINDOWS[t]) return WINDOWS[t];
  const m = /([A-Za-z_]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/.exec(t);
  if (m && isTimeZone(m[1])) return m[1];
  if (isTimeZone(t)) return t;
  return fallback;
}

export type WallTime = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** The wall-clock time in `tz` at instant `d`. */
export function wallTime(d: Date, tz: string): WallTime {
  const parts: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(d)) if (p.type !== "literal") parts[p.type] = Number(p.value);
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute, second: parts.second };
}

/**
 * The instant a wall-clock time in `tz` names. A time skipped by a spring-forward change is
 * moved forward by the gap (02:30 becomes 03:30); a repeated autumn time is the first one.
 */
export function fromWallTime(w: WallTime, tz: string): Date {
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const offsetAt = (t: number) => {
    const x = wallTime(new Date(t), tz);
    return Date.UTC(x.year, x.month - 1, x.day, x.hour, x.minute, x.second) - Math.floor(t / 1000) * 1000;
  };
  // The offsets half a day either side cover any change near this time.
  const before = asUtc - offsetAt(asUtc - 43200000);
  const after = asUtc - offsetAt(asUtc + 43200000);
  const fits = (t: number) => offsetAt(t) === asUtc - t;
  if (fits(before) && fits(after)) return new Date(Math.min(before, after));
  if (fits(before)) return new Date(before);
  if (fits(after)) return new Date(after);
  return new Date(before); // in the gap: read with the offset from before it (RFC 5545 3.3.5)
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** "20260310T093000" in `tz`. */
export function formatLocal(d: Date, tz: string): string {
  const w = wallTime(d, tz);
  return `${pad(w.year, 4)}${pad(w.month)}${pad(w.day)}T${pad(w.hour)}${pad(w.minute)}${pad(w.second)}`;
}
/** "20260310T143000Z" */
export function formatUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
/** "20260310" (the UTC date: all-day dates are kept as UTC midnights). */
export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export type DateValue = { date: Date; allDay: boolean; tzid: string };

/** DTSTART and friends: a DATE (all day), a UTC time, a time in TZID, or a floating time. */
export function parseDateValue(p: Prop, fallbackTz = "UTC"): DateValue | null {
  return parseDateText(p.value, p.params.VALUE, p.params.TZID, fallbackTz);
}

export function parseDateText(value: string, valueType?: string, tzid?: string, fallbackTz = "UTC"): DateValue | null {
  const v = value.trim();
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (d || (valueType ?? "").toUpperCase() === "DATE") {
    if (!d) return null;
    return { date: new Date(Date.UTC(+d[1], +d[2] - 1, +d[3])), allDay: true, tzid: "UTC" };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const w: WallTime = { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5], second: +m[6] };
  if (m[7]) return { date: new Date(Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)), allDay: false, tzid: zoneFor(tzid, fallbackTz) };
  const tz = zoneFor(tzid, fallbackTz);
  return { date: fromWallTime(w, tz), allDay: false, tzid: tz };
}

/** ISO 8601 durations as iCalendar writes them ("PT1H30M", "P1D", "-PT15M"), in milliseconds. */
export function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const ms = (((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 24 + +(m[4] ?? 0)) * 60 + +(m[5] ?? 0)) * 60000 + +(m[6] ?? 0) * 1000;
  return m[1] === "-" ? -ms : ms;
}
