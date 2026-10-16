import { GraphError } from "./graph";
import { isFatal, type JobContext } from "./context";
import { SuiteError, type ContactInput, type EventInput, type TaskInput } from "./suite";
import type { Workload } from "./types";

/**
 * Calendar, contacts and To Do from Microsoft 365, each through its delta query so a re-run
 * copies only what changed (and removes what was deleted there).
 */

const enc = encodeURIComponent;

/** HTML (an Outlook body) as plain text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const bodyText = (b?: { content?: string; contentType?: string }) =>
  !b?.content ? "" : b.contentType?.toLowerCase() === "html" ? htmlToText(b.content) : b.content.trim();

/** A Graph dateTimeTimeZone read as UTC (we ask Graph for UTC; anything else is taken as given). */
export function utc(d?: { dateTime?: string; timeZone?: string } | null): string | null {
  if (!d?.dateTime) return null;
  const s = /[zZ]|[+-]\d\d:\d\d$/.test(d.dateTime) ? d.dateTime : `${d.dateTime}Z`;
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/** Runs one item's change, recording a failure instead of stopping (unless the whole run must stop). */
async function guarded(ctx: JobContext, w: Workload, label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (isFatal(e)) throw e;
    await ctx.failed(w, label, e);
  }
}

/** Pages through a delta query from where the last run stopped, saving the link after each page. */
async function delta<T>(ctx: JobContext, w: Workload, scope: string, first: string, headers: Record<string, string>, each: (item: T) => Promise<void>) {
  const cur = await ctx.cursors.get<{ next: string; delta: string }>(w, scope);
  let url = cur.next || cur.delta || first;
  for (;;) {
    let page;
    try {
      page = await ctx.graph!.page<T>(url, headers);
    } catch (e) {
      // An expired delta link (410 Gone, or a sync-state error): start over from the beginning.
      if (e instanceof GraphError && (e.status === 410 || /syncstate/i.test(e.code)) && url !== first) {
        url = first;
        continue;
      }
      throw e;
    }
    for (const item of page.value) await each(item);
    if (page.nextLink) {
      await ctx.cursors.put(w, scope, { next: page.nextLink, delta: cur.delta ?? "" });
      url = page.nextLink;
      continue;
    }
    await ctx.cursors.put(w, scope, { next: "", delta: page.deltaLink ?? cur.delta ?? "" });
    return;
  }
}

// ---------- calendar ----------

type GEvent = {
  id: string; "@removed"?: unknown; subject?: string; body?: { content?: string; contentType?: string };
  start?: { dateTime?: string; timeZone?: string }; end?: { dateTime?: string; timeZone?: string }; isAllDay?: boolean;
  location?: { displayName?: string }; attendees?: { emailAddress?: { address?: string } }[];
  organizer?: { emailAddress?: { address?: string; name?: string } }; isOrganizer?: boolean; isCancelled?: boolean;
  seriesMasterId?: string | null; type?: string; changeKey?: string; lastModifiedDateTime?: string;
};

export function toEvent(e: GEvent, mapEmail: (a: string) => string): EventInput | null {
  const startAt = utc(e.start);
  let endAt = utc(e.end);
  if (!startAt) return null;
  if (!endAt || endAt <= startAt) endAt = new Date(Date.parse(startAt) + (e.isAllDay ? 86400_000 : 60_000)).toISOString();
  const organizer = e.organizer?.emailAddress?.address;
  const desc = bodyText(e.body);
  const note = !e.isOrganizer && organizer ? `Organizer: ${e.organizer?.emailAddress?.name ? `${e.organizer.emailAddress.name} <${organizer}>` : organizer}\n\n` : "";
  return {
    title: (e.subject || "(no title)").slice(0, 300),
    description: (note + desc).trim().slice(0, 2000),
    location: (e.location?.displayName ?? "").slice(0, 300),
    startAt, endAt, allDay: e.isAllDay === true,
    attendees: e.isOrganizer === false ? [] : (e.attendees ?? []).map((a) => a.emailAddress?.address ?? "").filter((a) => a.includes("@")).map(mapEmail),
  };
}

export async function importCalendar(ctx: JobContext): Promise<void> {
  const u = enc(ctx.job.subject_id);
  await ctx.step("calendar", "Calendar");
  const from = new Date(Date.now() - ctx.limits.calendarPastDays * 86400_000).toISOString();
  const to = new Date(Date.now() + ctx.limits.calendarFutureDays * 86400_000).toISOString();
  const headers = { Prefer: 'outlook.timezone="UTC", odata.maxpagesize=50, IdType="ImmutableId"' };
  const me = ctx.source.kind === "m365" ? (await ctx.graph!.json<{ mail?: string; userPrincipalName?: string }>(`/users/${u}?$select=mail,userPrincipalName`).catch(() => null)) : null;
  const myAddrs = new Set([me?.mail, me?.userPrincipalName].filter(Boolean).map((a) => a!.toLowerCase()));

  await delta<GEvent>(ctx, "calendar", "calendarView", `/users/${u}/calendarView/delta?startDateTime=${enc(from)}&endDateTime=${enc(to)}`, headers, async (e) => {
    const label = e.subject || e.id;
    await guarded(ctx, "calendar", label, async () => {
      const have = await ctx.items.get("calendar", e.id);
      if (e["@removed"] || e.isCancelled) {
        if (have?.target_id) {
          try {
            await ctx.suite.eventDelete(ctx.who, have.target_id);
          } catch (x) {
            if (!(x instanceof SuiteError && x.notFound)) throw x;
          }
          await ctx.items.del("calendar", e.id);
          await ctx.copied("calendar", "deleted");
        }
        return;
      }
      // Someone else's meeting whose organizer moves to the suite too: it shows from their calendar.
      const organizer = e.organizer?.emailAddress?.address?.toLowerCase() ?? "";
      if (e.isOrganizer === false && organizer && !myAddrs.has(organizer) && ctx.mapping.has(organizer) && ctx.job.workloads.includes("calendar")) {
        if (!have) {
          await ctx.items.put("calendar", e.id, "", "", { skipped: "organizer migrates" });
          await ctx.skipped("calendar", label, "Meeting organized by someone who also moves to the suite; it shows from their calendar");
        }
        return;
      }
      // Keep a recurring series' pattern, so it can be brought across as a series once Calendar has them.
      if (e.seriesMasterId && !(await ctx.items.get("calendar-series", e.seriesMasterId))) {
        const m = await ctx.graph!.json<{ subject?: string; recurrence?: unknown; start?: unknown; end?: unknown; isAllDay?: boolean }>(
          `/users/${u}/events/${enc(e.seriesMasterId)}?$select=subject,recurrence,start,end,isAllDay`, headers,
        ).catch(() => null);
        await ctx.items.put("calendar-series", e.seriesMasterId, "", "", { subject: m?.subject ?? "", recurrence: m?.recurrence ?? null, start: m?.start ?? null, end: m?.end ?? null, isAllDay: m?.isAllDay ?? false });
      }
      const input = toEvent(e, (a) => ctx.mapEmail(a));
      if (!input) {
        await ctx.skipped("calendar", label, "No start time");
        return;
      }
      const version = e.changeKey || e.lastModifiedDateTime || "";
      const info = { seriesMasterId: e.seriesMasterId ?? null, type: e.type ?? "singleInstance" };
      if (have?.target_id) {
        if (have.version === version) return;
        try {
          await ctx.suite.eventUpdate(ctx.who, have.target_id, input);
          await ctx.items.put("calendar", e.id, have.target_id, version, info);
          await ctx.copied("calendar", "updated");
          return;
        } catch (x) {
          if (!(x instanceof SuiteError && x.notFound)) throw x;
        }
      }
      const id = await ctx.suite.eventCreate(ctx.who, input);
      await ctx.items.put("calendar", e.id, id, version, info);
      await ctx.copied("calendar");
    });
  });
}

// ---------- contacts ----------

type GAddress = { street?: string; city?: string; state?: string; postalCode?: string; countryOrRegion?: string };
type GContact = {
  id: string; "@removed"?: unknown; givenName?: string; surname?: string; middleName?: string; nickName?: string;
  companyName?: string; jobTitle?: string; department?: string; emailAddresses?: { name?: string; address?: string }[];
  businessPhones?: string[]; homePhones?: string[]; mobilePhone?: string; businessAddress?: GAddress; homeAddress?: GAddress;
  otherAddress?: GAddress; businessHomePage?: string; birthday?: string; personalNotes?: string; displayName?: string;
  changeKey?: string; lastModifiedDateTime?: string;
};

export function toContact(c: GContact): ContactInput {
  const s = (v: unknown, n = 200) => String(v ?? "").trim().slice(0, n);
  const addr = (label: string, a?: GAddress) =>
    a && (a.street || a.city || a.state || a.postalCode || a.countryOrRegion)
      ? [{ label, street: s(a.street, 500), city: s(a.city), region: s(a.state), postcode: s(a.postalCode, 40), country: s(a.countryOrRegion) }]
      : [];
  const nameless = !c.givenName && !c.surname && !c.companyName;
  return {
    firstName: s(c.givenName || (nameless ? c.displayName : "")), lastName: s(c.surname), middleName: s(c.middleName), nickname: s(c.nickName),
    company: s(c.companyName), jobTitle: s(c.jobTitle), department: s(c.department),
    emails: (c.emailAddresses ?? []).filter((e) => e.address).map((e, i) => ({ label: i === 0 ? "work" : "other", value: s(e.address, 254) })),
    phones: [
      ...(c.mobilePhone ? [{ label: "mobile", value: s(c.mobilePhone, 60) }] : []),
      ...(c.businessPhones ?? []).map((p) => ({ label: "work", value: s(p, 60) })),
      ...(c.homePhones ?? []).map((p) => ({ label: "home", value: s(p, 60) })),
    ],
    addresses: [...addr("work", c.businessAddress), ...addr("home", c.homeAddress), ...addr("other", c.otherAddress)],
    websites: c.businessHomePage ? [{ label: "work", value: s(c.businessHomePage, 500) }] : [],
    birthday: c.birthday ? c.birthday.slice(0, 10) : "",
    notes: s(c.personalNotes, 10000),
  };
}

export async function importContacts(ctx: JobContext): Promise<void> {
  const u = enc(ctx.job.subject_id);
  const folders: { id: string; first: string; name: string }[] = [{ id: "default", first: `/users/${u}/contacts/delta`, name: "Contacts" }];
  for (const f of await ctx.graph!.all<{ id: string; displayName: string }>(`/users/${u}/contactFolders?$top=100&$select=id,displayName`)) {
    folders.push({ id: f.id, first: `/users/${u}/contactFolders/${enc(f.id)}/contacts/delta`, name: f.displayName });
  }
  for (const f of folders) {
    await ctx.step("contacts", f.name);
    await delta<GContact>(ctx, "contacts", f.id, f.first, { Prefer: "odata.maxpagesize=100" }, async (c) => {
      await guarded(ctx, "contacts", c.displayName || c.id, async () => {
        const have = await ctx.items.get("contacts", c.id);
        if (c["@removed"]) {
          if (have?.target_id) {
            try {
              await ctx.suite.contactDelete(ctx.who, have.target_id);
            } catch (x) {
              if (!(x instanceof SuiteError && x.notFound)) throw x;
            }
            await ctx.items.del("contacts", c.id);
            await ctx.copied("contacts", "deleted");
          }
          return;
        }
        const version = c.changeKey || c.lastModifiedDateTime || "";
        const input = toContact(c);
        if (have?.target_id) {
          if (have.version === version) return;
          try {
            await ctx.suite.contactUpdate(ctx.who, have.target_id, input);
            await ctx.items.put("contacts", c.id, have.target_id, version, { folder: f.name });
            await ctx.copied("contacts", "updated");
            return;
          } catch (x) {
            if (!(x instanceof SuiteError && x.notFound)) throw x;
          }
        }
        const id = await ctx.suite.contactCreate(ctx.who, input);
        await ctx.items.put("contacts", c.id, id, version, { folder: f.name });
        await ctx.copied("contacts");
      });
    });
  }
}

// ---------- To Do ----------

type GList = { id: string; displayName: string; wellknownListName?: string };
type GTask = {
  id: string; "@removed"?: unknown; title?: string; body?: { content?: string; contentType?: string }; importance?: string;
  status?: string; dueDateTime?: { dateTime?: string; timeZone?: string }; reminderDateTime?: { dateTime?: string; timeZone?: string };
  isReminderOn?: boolean; recurrence?: { pattern?: { type?: string; interval?: number; daysOfWeek?: string[] } } | null;
  lastModifiedDateTime?: string;
};

export function repeatOf(r: GTask["recurrence"]): string | null {
  const p = r?.pattern;
  if (!p?.type || (p.interval ?? 1) !== 1) return null;
  if (p.type === "daily") return "daily";
  if (p.type === "weekly") {
    const days = new Set((p.daysOfWeek ?? []).map((d) => d.toLowerCase()));
    return days.size === 5 && ["monday", "tuesday", "wednesday", "thursday", "friday"].every((d) => days.has(d)) ? "weekdays" : "weekly";
  }
  if (p.type === "absoluteMonthly" || p.type === "relativeMonthly") return "monthly";
  if (p.type === "absoluteYearly" || p.type === "relativeYearly") return "yearly";
  return null;
}

export function toTask(t: GTask, steps: { displayName?: string; isChecked?: boolean }[]): TaskInput {
  return {
    title: (t.title || "(untitled)").slice(0, 400),
    notes: bodyText(t.body).slice(0, 20000),
    important: t.importance === "high",
    due: t.dueDateTime?.dateTime ? t.dueDateTime.dateTime.slice(0, 10) : null,
    reminderAt: t.isReminderOn ? utc(t.reminderDateTime) : null,
    repeat: repeatOf(t.recurrence),
    completed: t.status === "completed",
    steps: steps.filter((s) => s.displayName).map((s) => ({ title: s.displayName!.slice(0, 400), done: s.isChecked === true })),
  };
}

export async function importTodo(ctx: JobContext): Promise<void> {
  const u = enc(ctx.job.subject_id);
  await ctx.step("todo", "Lists");
  let lists: GList[];
  try {
    lists = await ctx.graph!.all<GList>(`/users/${u}/todo/lists`);
  } catch (e) {
    if (e instanceof GraphError && (e.status === 403 || e.status === 404)) {
      await ctx.skipped("todo", "To Do", e.status === 403 ? "Microsoft refused access to To Do (grant Tasks.Read.All)" : "This person has no To Do lists");
      return;
    }
    throw e;
  }
  for (const l of lists) {
    await ctx.step("todo", l.displayName);
    let listId: string | null = null;
    if (l.wellknownListName !== "defaultList") {
      listId = (await ctx.items.get("todo-list", l.id))?.target_id || null;
      if (!listId) {
        listId = await ctx.suite.todoList(ctx.who, l.displayName.slice(0, 100) || "Tasks");
        await ctx.items.put("todo-list", l.id, listId, "", { name: l.displayName });
      }
    }
    await delta<GTask>(ctx, "todo", l.id, `/users/${u}/todo/lists/${enc(l.id)}/tasks/delta`, { Prefer: "odata.maxpagesize=100" }, async (t) => {
      await guarded(ctx, "todo", t.title || t.id, async () => {
        const have = await ctx.items.get("todo", t.id);
        if (t["@removed"]) {
          if (have?.target_id) {
            try {
              await ctx.suite.taskDelete(ctx.who, have.target_id);
            } catch (x) {
              if (!(x instanceof SuiteError && x.notFound)) throw x;
            }
            await ctx.items.del("todo", t.id);
            await ctx.copied("todo", "deleted");
          }
          return;
        }
        const version = t.lastModifiedDateTime || "";
        if (have?.target_id && have.version === version) return;
        const steps = await ctx.graph!.all<{ displayName?: string; isChecked?: boolean }>(`/users/${u}/todo/lists/${enc(l.id)}/tasks/${enc(t.id)}/checklistItems`).catch(() => []);
        const input = toTask(t, steps);
        if (have?.target_id) {
          try {
            await ctx.suite.taskUpdate(ctx.who, have.target_id, input);
            await ctx.items.put("todo", t.id, have.target_id, version, { list: l.id });
            await ctx.copied("todo", "updated");
            return;
          } catch (x) {
            if (!(x instanceof SuiteError && x.notFound)) throw x;
          }
        }
        const id = await ctx.suite.taskCreate(ctx.who, listId, input);
        await ctx.items.put("todo", t.id, id, version, { list: l.id });
        await ctx.copied("todo");
      });
    });
  }
}
