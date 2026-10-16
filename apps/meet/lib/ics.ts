/**
 * Build RFC 5545 iCalendar (.ics) invites for SynergyMeet.
 *
 * We emit METHOD:REQUEST so Gmail/Outlook/Apple render it as a real invitation with Accept/Decline,
 * METHOD:CANCEL to withdraw it, and carry an RRULE for recurring meetings. Times are emitted in UTC
 * (…Z) which every calendar client understands without needing an embedded VTIMEZONE.
 */
export type IcsMeeting = {
  id: string;
  title: string;
  description: string;
  hostEmail: string;
  hostName: string;
  startAt: Date;
  durationMin: number;
  rrule: string | null;
  sequence: number;
  joinUrl: string;
  invitees: { email: string; name?: string }[];
};

function fmt(d: Date): string {
  // 20260714T221500Z
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/**
 * Fold long lines to 75 octets per RFC 5545 (calendars are strict about this). Lengths are UTF-8
 * bytes, and lines are only split between characters, never inside one.
 */
function fold(line: string): string {
  const LIMIT = 75;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, "utf8");
    if (bytes + size > LIMIT) {
      parts.push(current);
      current = " ";
      bytes = 1;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n");
}

/** `now` is the DTSTAMP: when this copy of the invitation was created. */
export function buildIcs(m: IcsMeeting, method: "REQUEST" | "CANCEL", now: Date = new Date()): string {
  const end = new Date(m.startAt.getTime() + m.durationMin * 60_000);
  const uid = `${m.id}@meet.${process.env.SUITE_DOMAIN || "localhost"}`;
  const status = method === "CANCEL" ? "CANCELLED" : "CONFIRMED";
  const descLines = [
    m.description,
    m.description ? "" : null,
    `Join: ${m.joinUrl}`,
  ].filter((x) => x !== null && x !== "") as string[];

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Synergy Technologies//SynergyMeet//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SEQUENCE:${m.sequence}`,
    `DTSTAMP:${fmt(now)}`,
    `DTSTART:${fmt(m.startAt)}`,
    `DTEND:${fmt(end)}`,
    m.rrule ? `RRULE:${m.rrule}` : null,
    `SUMMARY:${esc(m.title)}`,
    `DESCRIPTION:${esc(descLines.join("\n"))}`,
    `LOCATION:${esc(m.joinUrl)}`,
    `URL:${m.joinUrl}`,
    `STATUS:${status}`,
    `ORGANIZER;CN=${esc(m.hostName || m.hostEmail)}:mailto:${m.hostEmail}`,
    ...m.invitees.map(
      (i) =>
        `ATTENDEE;CN=${esc(i.name || i.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${i.email}`,
    ),
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((x): x is string => Boolean(x));

  return lines.map(fold).join("\r\n") + "\r\n";
}
