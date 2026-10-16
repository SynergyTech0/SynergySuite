import type { Row } from "./appointments";
import { buildIcs } from "./ics";
import { outbox } from "./mailer";
import type { Page } from "./pages";
import { meetUrl, publicBase } from "./suite";

export type Event = "booked" | "moved" | "cancelled" | "reminder";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** "Tuesday, October 20, 2026 at 2:30 PM (New York time)", in the page's time zone. */
export function when(start: Date, tz: string): string {
  const day = start.toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const time = start.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const zone = tz === "UTC" ? "UTC" : `${tz.split("/").pop()!.replace(/_/g, " ")} time`;
  return `${day} at ${time} (${zone})`;
}

function minutes(r: Row): number {
  return Math.round((r.end_at.getTime() - r.start_at.getTime()) / 60_000);
}

const SUBJECTS: Record<Event, (r: Row) => string> = {
  booked: (r) => `Booked: ${r.service_name} with ${r.page_name}`,
  moved: (r) => `New time: ${r.service_name} with ${r.page_name}`,
  cancelled: (r) => `Cancelled: ${r.service_name} with ${r.page_name}`,
  reminder: (r) => `Reminder: ${r.service_name} with ${r.page_name}`,
};

const LEADS: Record<Event, string> = {
  booked: "Your appointment is booked.",
  moved: "Your appointment has a new time.",
  cancelled: "Your appointment has been cancelled.",
  reminder: "This is a reminder of your upcoming appointment.",
};

function layout(color: string, title: string, rows: [string, string][], footer: string): string {
  const cells = rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${v}</td></tr>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f5f6f8;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1f2328">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e3e5e9">
<div style="height:6px;background:${color}"></div><div style="padding:20px 24px">
<h1 style="font-size:18px;margin:0 0 12px">${esc(title)}</h1><table style="border-collapse:collapse">${cells}</table>
<p style="margin:18px 0 0">${footer}</p></div></div></body></html>`;
}

const HEX: Record<string, string> = {
  blue: "#0f6cbd", green: "#107c41", red: "#c4314b", orange: "#ca5010", purple: "#8764b8", teal: "#038387", pink: "#c239b3", gray: "#69797e",
};

function details(page: Page, r: Row): [string, string, string][] {
  const join = r.meet_room ? meetUrl(r.meet_room) : null;
  return [
    ["What", r.service_name, esc(r.service_name)],
    ["When", `${when(r.start_at, page.timeZone)}, ${minutes(r)} minutes`, esc(`${when(r.start_at, page.timeZone)}, ${minutes(r)} minutes`)],
    ["With", r.staff_name || r.staff_email, esc(r.staff_name || r.staff_email)],
    ...(join ? [["Join online", join, `<a href="${esc(join)}">${esc(join)}</a>`] as [string, string, string]]
      : r.location ? [["Where", r.location, esc(r.location)] as [string, string, string]] : []),
  ];
}

/** The customer's email, with an invitation their calendar app understands. */
function toCustomer(page: Page, r: Row, ev: Event) {
  const manage = `${publicBase()}/booking/${r.token}`;
  const rows = details(page, r);
  const contact = page.phone ? ` or call ${page.phone}` : "";
  const footerText = ev === "cancelled"
    ? `To book again, visit ${publicBase()}/book/${page.slug}`
    : `To change or cancel, visit ${manage}${contact}.`;
  const footerHtml = ev === "cancelled"
    ? `<a href="${esc(`${publicBase()}/book/${page.slug}`)}">Book again</a>`
    : `<a href="${esc(manage)}" style="display:inline-block;background:${HEX[page.color] ?? HEX.blue};color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Change or cancel</a>${contact ? esc(contact) : ""}`;
  const text = [`Hello ${r.customer_name},`, "", LEADS[ev], "", ...rows.map(([k, v]) => `${k}: ${v}`), "", footerText, "", page.name].join("\n");
  const ics = buildIcs({
    id: r.id, sequence: r.sequence, title: `${r.service_name} with ${page.name}`,
    description: [rows.map(([k, v]) => `${k}: ${v}`).join("\n"), ev === "cancelled" ? "" : `Change or cancel: ${manage}`].filter(Boolean).join("\n\n"),
    location: r.meet_room ? meetUrl(r.meet_room) : r.location, start: r.start_at, end: r.end_at,
    organizerEmail: page.senderEmail || page.createdBy, organizerName: page.name, attendeeEmail: r.customer_email, attendeeName: r.customer_name,
  }, ev === "cancelled" ? "CANCEL" : "REQUEST");
  return {
    to: r.customer_email,
    subject: SUBJECTS[ev](r),
    text,
    html: layout(HEX[page.color] ?? HEX.blue, LEADS[ev], rows.map(([k, , h]) => [k, h]), footerHtml),
    // A reminder repeats what the calendar already has, so it carries no invitation.
    ...(ev === "reminder" ? {} : { ics: { method: ev === "cancelled" ? "CANCEL" as const : "REQUEST" as const, content: ics } }),
  };
}

function toStaff(page: Page, r: Row, ev: Exclude<Event, "reminder">) {
  const verb = { booked: "New booking", moved: "Booking moved", cancelled: "Booking cancelled" }[ev];
  const link = `${publicBase()}/?appointment=${r.id}`;
  const rows: [string, string, string][] = [
    ["Customer", `${r.customer_name} <${r.customer_email}>`, esc(`${r.customer_name} <${r.customer_email}>`)],
    ...(r.customer_phone ? [["Phone", r.customer_phone, esc(r.customer_phone)] as [string, string, string]] : []),
    ...details(page, r).filter(([k]) => k !== "With"),
    ...(r.notes ? [["Notes", r.notes, esc(r.notes)] as [string, string, string]] : []),
    ...r.answers.map((a) => [a.label, a.answer, esc(a.answer)] as [string, string, string]),
    ...(ev === "cancelled" && r.cancel_reason ? [["Reason", r.cancel_reason, esc(r.cancel_reason)] as [string, string, string]] : []),
  ];
  return {
    to: r.staff_email,
    subject: `${verb}: ${r.service_name}, ${r.customer_name}`,
    text: [`${verb} on ${page.name}.`, "", ...rows.map(([k, v]) => `${k}: ${v}`), "", `Open in Bookings: ${link}`].join("\n"),
    html: layout(HEX[page.color] ?? HEX.blue, `${verb} on ${page.name}`, rows.map(([k, , h]) => [k, h]), `<a href="${esc(link)}">Open in Bookings</a>`),
  };
}

/**
 * Emails the customer, and the staff member unless they made the change themselves. Returns
 * whether the customer's email went out. Never throws: a booking stands even when mail is down.
 */
export async function notify(page: Page, r: Row, ev: Event): Promise<boolean> {
  const from = page.senderEmail || page.createdBy;
  try {
    const sends = [outbox.send({ from, fromName: page.name, ...toCustomer(page, r, ev) })];
    const actor = ev === "cancelled" ? r.cancelled_by : ev === "booked" ? r.booked_by : null;
    if (ev !== "reminder" && actor !== r.staff_email) sends.push(outbox.send({ from, fromName: "Bookings", ...toStaff(page, r, ev) }));
    const [customer] = await Promise.all(sends);
    return customer.sent;
  } catch (e) {
    console.error("[bookings] notify:", (e as Error).message);
    return false;
  }
}
