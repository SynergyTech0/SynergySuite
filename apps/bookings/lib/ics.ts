/**
 * RFC 5545 invitations for customers, so Outlook, Gmail and Apple Calendar add the appointment
 * (METHOD:REQUEST) and take it off again (METHOD:CANCEL). Times are UTC, which every client reads.
 */
export type IcsAppointment = {
  id: string; sequence: number; title: string; description: string; location: string;
  start: Date; end: Date; organizerEmail: string; organizerName: string; attendeeEmail: string; attendeeName: string;
};

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines of at most 75 UTF-8 bytes, split between characters. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    if (bytes + n > 75) {
      out.push(cur);
      cur = " ";
      bytes = 1;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n");
}

export function buildIcs(a: IcsAppointment, method: "REQUEST" | "CANCEL", now = new Date()): string {
  const host = process.env.SUITE_DOMAIN || "localhost";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Synergy//Bookings//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${a.id}@bookings.${host}`,
    `SEQUENCE:${a.sequence}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(a.start)}`,
    `DTEND:${stamp(a.end)}`,
    `SUMMARY:${esc(a.title)}`,
    `DESCRIPTION:${esc(a.description)}`,
    a.location ? `LOCATION:${esc(a.location)}` : null,
    `ORGANIZER;CN=${esc(a.organizerName)}:mailto:${a.organizerEmail}`,
    `ATTENDEE;CN=${esc(a.attendeeName)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${a.attendeeEmail}`,
    `STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    method === "REQUEST" ? "BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nTRIGGER:-PT15M\r\nEND:VALARM" : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((l): l is string => l !== null);
  return lines.map((l) => l.split("\r\n").map(fold).join("\r\n")).join("\r\n") + "\r\n";
}
