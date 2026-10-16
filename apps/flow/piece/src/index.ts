/**
 * The Synergy piece for the flow designer: actions and triggers for the suite's own apps.
 *
 * Every step calls the Flow app's /api/connect endpoint with the person's Synergy key. Flow
 * turns the key back into the person and calls the target app as them, so each app applies its
 * own access rules and nothing here holds app credentials. Flow creates the "Synergy" connection
 * for each person the first time they open the designer, so they never type the key.
 */
import { createAction, createPiece, createTrigger, PieceAuth, Property, TriggerStrategy } from "@activepieces/pieces-framework";
import { DedupeStrategy, pollingHelper, type Polling } from "@activepieces/pieces-common";

export const synergyAuth = PieceAuth.CustomAuth({
  displayName: "Synergy",
  description: "Synergy Flow fills this in for you. The key acts as you in the suite apps; keep it private.",
  required: true,
  props: {
    baseUrl: Property.ShortText({ displayName: "Flow address", description: "Where the engine reaches the Flow app, e.g. http://flow:3780", required: true }),
    key: PieceAuth.SecretText({ displayName: "Synergy key", required: true }),
  },
  validate: async ({ auth }) => {
    try {
      await call(auth, "whoami", {});
      return { valid: true };
    } catch (e) {
      return { valid: false, error: (e as Error).message };
    }
  },
});

type Conn = { baseUrl?: string; key?: string };

/** Older engines pass the custom-auth props directly; newer ones wrap them in { props }. */
function conn(auth: unknown): Conn {
  const a = (auth ?? {}) as { props?: Conn } & Conn;
  return a.props ?? a;
}

export async function call<T = any>(auth: unknown, op: string, input: Record<string, unknown>): Promise<T> {
  const { baseUrl, key } = conn(auth);
  if (!baseUrl || !key) throw new Error("The Synergy connection is missing its address or key");
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/connect`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ op, input }),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw new Error(data?.error || `Synergy answered ${res.status}`);
  return data as T;
}

type Option = { label: string; value: string };

/** A dropdown filled from one of Flow's list operations. */
function listDropdown(displayName: string, op: string, opts: { required?: boolean; description?: string; refreshers?: string[]; input?: (p: Record<string, unknown>) => Record<string, unknown> | null } = {}) {
  return Property.Dropdown({
    auth: synergyAuth,
    displayName,
    description: opts.description,
    required: (opts.required ?? true) as true,
    refreshers: opts.refreshers ?? [],
    options: async (props) => {
      if (!props.auth) return { disabled: true, options: [], placeholder: "Connect Synergy first" };
      const input = opts.input ? opts.input(props) : {};
      if (input === null) return { disabled: true, options: [], placeholder: "Choose the item above first" };
      try {
        const { options } = await call<{ options: Option[] }>(props.auth, op, input);
        return { disabled: false, options };
      } catch (e) {
        return { disabled: true, options: [], placeholder: (e as Error).message };
      }
    },
  });
}

// ---- Mail

const sendEmail = createAction({
  auth: synergyAuth,
  name: "send_email",
  displayName: "Send an email",
  description: "Sends an email from your Synergy mailbox.",
  props: {
    to: Property.ShortText({ displayName: "To", description: "One or more addresses, separated by commas", required: true }),
    cc: Property.ShortText({ displayName: "Cc", required: false }),
    subject: Property.ShortText({ displayName: "Subject", required: true }),
    body: Property.LongText({ displayName: "Message", required: true }),
    html: Property.Checkbox({ displayName: "Message is HTML", required: false, defaultValue: false }),
  },
  run: async ({ auth, propsValue }) => call(auth, "mail.send", propsValue),
});

const newEmail = pollingTrigger({
  name: "new_email",
  displayName: "New email",
  description: "Starts when a new email arrives in your Synergy inbox.",
  op: "mail.inbox",
  props: {},
  sampleData: { uid: 1042, subject: "Quarterly numbers", from: { name: "Ada Lovelace", address: "ada@example.com" }, to: [{ name: "", address: "you@example.com" }], date: "2026-10-16T09:30:00.000Z", hasAttachments: false },
});

// ---- Calendar

const createEvent = createAction({
  auth: synergyAuth,
  name: "create_event",
  displayName: "Create a calendar event",
  description: "Adds an event to your Synergy calendar.",
  props: {
    title: Property.ShortText({ displayName: "Title", required: true }),
    start: Property.DateTime({ displayName: "Starts", required: true }),
    end: Property.DateTime({ displayName: "Ends", required: true }),
    location: Property.ShortText({ displayName: "Location", required: false }),
    description: Property.LongText({ displayName: "Description", required: false }),
    attendees: Property.ShortText({ displayName: "Attendees", description: "Email addresses, separated by commas", required: false }),
    allDay: Property.Checkbox({ displayName: "All day", required: false, defaultValue: false }),
    calendar: Property.StaticDropdown({ displayName: "Calendar", required: false, defaultValue: "personal", options: { options: [{ label: "My calendar", value: "personal" }, { label: "Company calendar", value: "company" }] } }),
  },
  run: async ({ auth, propsValue }) => call(auth, "calendar.create", propsValue),
});

// ---- To Do

const createTodo = createAction({
  auth: synergyAuth,
  name: "create_todo",
  displayName: "Add a To Do task",
  description: "Adds a task to one of your To Do lists.",
  props: {
    listId: listDropdown("List", "todo.lists", { required: false, description: "Leave empty for your default Tasks list" }),
    title: Property.ShortText({ displayName: "Title", required: true }),
    due: Property.ShortText({ displayName: "Due date", description: "YYYY-MM-DD", required: false }),
    notes: Property.LongText({ displayName: "Notes", required: false }),
    important: Property.Checkbox({ displayName: "Important", required: false, defaultValue: false }),
  },
  run: async ({ auth, propsValue }) => call(auth, "todo.create", propsValue),
});

// ---- Planner

const createCard = createAction({
  auth: synergyAuth,
  name: "create_planner_task",
  displayName: "Add a Planner task",
  description: "Adds a task to a bucket of a Planner plan.",
  props: {
    boardId: listDropdown("Plan", "planner.boards"),
    listId: listDropdown("Bucket", "planner.lists", { refreshers: ["boardId"], input: (p) => (p.boardId ? { boardId: p.boardId } : null) }),
    title: Property.ShortText({ displayName: "Title", required: true }),
    description: Property.LongText({ displayName: "Description", required: false }),
    dueDate: Property.ShortText({ displayName: "Due date", description: "YYYY-MM-DD", required: false }),
    priority: Property.StaticDropdown({
      displayName: "Priority",
      required: false,
      options: { options: ["highest", "high", "medium", "low", "lowest"].map((v) => ({ label: v[0].toUpperCase() + v.slice(1), value: v })) },
    }),
  },
  run: async ({ auth, propsValue }) => call(auth, "planner.create", propsValue),
});

// ---- Chat

const postMessage = createAction({
  auth: synergyAuth,
  name: "post_chat_message",
  displayName: "Post a Chat message",
  description: "Posts a message to a Chat channel you belong to.",
  props: {
    channelId: listDropdown("Channel", "chat.channels"),
    body: Property.LongText({ displayName: "Message", required: true }),
  },
  run: async ({ auth, propsValue }) => call(auth, "chat.post", propsValue),
});

// ---- Forms

const newResponse = pollingTrigger({
  name: "new_form_response",
  displayName: "New form response",
  description: "Starts when someone responds to a Synergy form.",
  op: "forms.responses",
  props: { formId: listDropdown("Form", "forms.list") },
  sampleData: { id: 311, formId: 12, formTitle: "Event sign-up", submittedAt: "2026-10-16T09:30:00.000Z", answers: { Name: "Ada Lovelace", Email: "ada@example.com" }, summary: "Name: Ada Lovelace\nEmail: ada@example.com" },
});

// ---- Contacts, Drive, Desk, CRM

const createContact = createAction({
  auth: synergyAuth,
  name: "create_contact",
  displayName: "Add a contact",
  description: "Adds someone to your Contacts.",
  props: {
    firstName: Property.ShortText({ displayName: "First name", required: false }),
    lastName: Property.ShortText({ displayName: "Last name", required: false }),
    email: Property.ShortText({ displayName: "Email", required: false }),
    phone: Property.ShortText({ displayName: "Phone", required: false }),
    company: Property.ShortText({ displayName: "Company", required: false }),
    jobTitle: Property.ShortText({ displayName: "Job title", required: false }),
    notes: Property.LongText({ displayName: "Notes", required: false }),
  },
  run: async ({ auth, propsValue }) => call(auth, "contacts.create", propsValue),
});

const saveFile = createAction({
  auth: synergyAuth,
  name: "save_file",
  displayName: "Save a file to Drive",
  description: "Saves text, or a file from an earlier step, to your Drive. A file with the same name gets a new version.",
  props: {
    path: Property.ShortText({ displayName: "File name", description: "A name, or a path like Reports/2026/summary.txt (folders are created)", required: true }),
    file: Property.File({ displayName: "File", description: "A file from an earlier step", required: false }),
    text: Property.LongText({ displayName: "Text", description: "Used when no file is given", required: false }),
  },
  run: async ({ auth, propsValue }) => {
    const f = propsValue.file as { base64?: string; filename?: string } | undefined;
    if (!f?.base64 && !propsValue.text) throw new Error("Give a file or some text to save");
    return call(auth, "drive.save", { path: propsValue.path, base64: f?.base64, text: f?.base64 ? undefined : propsValue.text });
  },
});

const createTicket = createAction({
  auth: synergyAuth,
  name: "create_ticket",
  displayName: "Open a Desk ticket",
  description: "Opens a support ticket in Desk.",
  props: {
    subject: Property.ShortText({ displayName: "Subject", required: true }),
    requesterEmail: Property.ShortText({ displayName: "Requester email", required: true }),
    requesterName: Property.ShortText({ displayName: "Requester name", required: false }),
    body: Property.LongText({ displayName: "Description", required: false }),
    priority: Property.StaticDropdown({
      displayName: "Priority",
      required: false,
      defaultValue: "normal",
      options: { options: ["low", "normal", "high", "urgent"].map((v) => ({ label: v[0].toUpperCase() + v.slice(1), value: v })) },
    }),
  },
  run: async ({ auth, propsValue }) => call(auth, "desk.create", propsValue),
});

const createLead = createAction({
  auth: synergyAuth,
  name: "create_lead",
  displayName: "Add a CRM lead",
  description: "Adds a lead to CRM.",
  props: {
    name: Property.ShortText({ displayName: "Name", required: true }),
    company: Property.ShortText({ displayName: "Company", required: false }),
    email: Property.ShortText({ displayName: "Email", required: false }),
    phone: Property.ShortText({ displayName: "Phone", required: false }),
    source: Property.StaticDropdown({
      displayName: "Source",
      required: false,
      defaultValue: "other",
      options: { options: ["web", "referral", "event", "cold_outreach", "partner", "other"].map((v) => ({ label: v.replace("_", " "), value: v })) },
    }),
  },
  run: async ({ auth, propsValue }) => call(auth, "crm.create", propsValue),
});

// ---- Polling triggers

/**
 * A trigger that asks Flow for items newer than the last one it saw. Flow answers with
 * { items: [{ id, data }] }, newest first, where id only ever grows.
 */
function pollingTrigger(def: { name: string; displayName: string; description: string; op: string; props: Record<string, any>; sampleData: unknown }) {
  const polling: Polling<any, Record<string, unknown>> = {
    strategy: DedupeStrategy.LAST_ITEM,
    items: async ({ auth, propsValue }) => {
      const { items } = await call<{ items: { id: number; data: unknown }[] }>(auth, def.op, propsValue);
      return items;
    },
  };
  return createTrigger({
    auth: synergyAuth,
    name: def.name,
    displayName: def.displayName,
    description: def.description,
    props: def.props,
    type: TriggerStrategy.POLLING,
    sampleData: def.sampleData,
    onEnable: async (ctx) => {
      await pollingHelper.onEnable(polling, { auth: ctx.auth, store: ctx.store, propsValue: ctx.propsValue });
    },
    onDisable: async (ctx) => {
      await pollingHelper.onDisable(polling, { auth: ctx.auth, store: ctx.store, propsValue: ctx.propsValue });
    },
    run: async (ctx) => pollingHelper.poll(polling, { auth: ctx.auth, store: ctx.store, propsValue: ctx.propsValue, files: ctx.files }),
    test: async (ctx) => pollingHelper.test(polling, { auth: ctx.auth, store: ctx.store, propsValue: ctx.propsValue, files: ctx.files }),
  });
}

export const synergy = createPiece({
  displayName: "Synergy",
  description: "Mail, Calendar, To Do, Planner, Chat, Forms, Contacts, Drive, Desk and CRM in your Synergy suite",
  logoUrl: "https://raw.githubusercontent.com/SynergyTech0/SynergySuite/main/apps/flow/public/synergy-piece.svg",
  authors: ["SynergyTech0"],
  auth: synergyAuth,
  minimumSupportedRelease: "0.50.0",
  actions: [sendEmail, createEvent, createTodo, createCard, postMessage, createContact, saveFile, createTicket, createLead],
  triggers: [newEmail, newResponse],
});
