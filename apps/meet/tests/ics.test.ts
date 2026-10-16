import { describe, expect, it } from "vitest";
import { buildIcs, type IcsMeeting } from "../lib/ics";

const NOW = new Date("2026-10-01T09:00:00Z");

function meeting(over: Partial<IcsMeeting> = {}): IcsMeeting {
  return {
    id: "m1",
    title: "Weekly sync",
    description: "",
    hostEmail: "host@example.com",
    hostName: "Host",
    startAt: new Date("2026-11-02T15:30:00Z"),
    durationMin: 45,
    rrule: null,
    sequence: 0,
    joinUrl: "https://meet.example.com/r/abc",
    invitees: [{ email: "a@example.com", name: "A" }],
    ...over,
  };
}

/** Undo RFC 5545 line folding so a property can be read whole. */
const unfold = (ics: string) => ics.replace(/\r\n /g, "");
const prop = (ics: string, name: string) =>
  unfold(ics).split("\r\n").find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));

describe("buildIcs", () => {
  it("ends every line with CRLF", () => {
    const ics = buildIcs(meeting(), "REQUEST", NOW);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("emits start, end and a DTSTAMP from `now`", () => {
    const ics = buildIcs(meeting(), "REQUEST", NOW);
    expect(prop(ics, "DTSTART")).toBe("DTSTART:20261102T153000Z");
    expect(prop(ics, "DTEND")).toBe("DTEND:20261102T161500Z");
    expect(prop(ics, "DTSTAMP")).toBe("DTSTAMP:20261001T090000Z");
  });

  it("escapes commas, semicolons, backslashes and newlines in text", () => {
    const ics = buildIcs(
      meeting({ title: "Plan, review; ship \\ go", description: "Line one\nLine two" }),
      "REQUEST",
      NOW,
    );
    expect(prop(ics, "SUMMARY")).toBe("SUMMARY:Plan\\, review\\; ship \\\\ go");
    expect(prop(ics, "DESCRIPTION")).toBe(
      "DESCRIPTION:Line one\\nLine two\\nJoin: https://meet.example.com/r/abc",
    );
  });

  it("folds lines longer than 75 characters with CRLF and a space", () => {
    const title = "x".repeat(200);
    const ics = buildIcs(meeting({ title }), "REQUEST", NOW);
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(ics).toMatch(/\r\n x/);
    expect(prop(ics, "SUMMARY")).toBe(`SUMMARY:${title}`);
  });

  it("folds by UTF-8 bytes without splitting a character", () => {
    const title = "Réunion d'équipe 東京 🚀 ".repeat(12);
    const ics = buildIcs(meeting({ title }), "REQUEST", NOW);
    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
      expect(line).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
    expect(prop(ics, "SUMMARY")).toBe(`SUMMARY:${title.replace(/,/g, "\\,")}`);
  });

  it("includes RRULE only for recurring meetings", () => {
    expect(prop(buildIcs(meeting(), "REQUEST", NOW), "RRULE")).toBeUndefined();
    const ics = buildIcs(meeting({ rrule: "FREQ=WEEKLY;BYDAY=MO" }), "REQUEST", NOW);
    expect(prop(ics, "RRULE")).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO");
  });

  it("marks REQUEST confirmed and CANCEL cancelled", () => {
    const req = buildIcs(meeting(), "REQUEST", NOW);
    expect(prop(req, "METHOD")).toBe("METHOD:REQUEST");
    expect(prop(req, "STATUS")).toBe("STATUS:CONFIRMED");
    const cancel = buildIcs(meeting({ sequence: 3 }), "CANCEL", NOW);
    expect(prop(cancel, "METHOD")).toBe("METHOD:CANCEL");
    expect(prop(cancel, "STATUS")).toBe("STATUS:CANCELLED");
    expect(prop(cancel, "SEQUENCE")).toBe("SEQUENCE:3");
  });

  it("lists the organizer and each invitee", () => {
    const ics = buildIcs(
      meeting({ invitees: [{ email: "a@example.com", name: "A" }, { email: "b@example.com" }] }),
      "REQUEST",
      NOW,
    );
    expect(prop(ics, "ORGANIZER")).toBe("ORGANIZER;CN=Host:mailto:host@example.com");
    const attendees = unfold(ics).split("\r\n").filter((l) => l.startsWith("ATTENDEE"));
    expect(attendees).toHaveLength(2);
    expect(attendees[1]).toContain("CN=b@example.com");
    expect(attendees[1]).toMatch(/:mailto:b@example\.com$/);
  });
});
