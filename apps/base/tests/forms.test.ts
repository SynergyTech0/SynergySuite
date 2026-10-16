/**
 * Forms: layouts (pure), and against a real Postgres (TEST_DATABASE_URL) saving forms and the
 * Synergy Forms link, with a stand-in Synergy Forms API on a local port.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Field } from "@/lib/fields";
import { cleanLayout, defaultLayout, onlineQuestions } from "@/lib/formLayout";

const field = (id: string, type: Field["type"], extra: Partial<Field> = {}): Field => ({ id, name: id.toUpperCase(), pgName: `f_${id}`, type, options: {}, required: false, description: "", position: 0, ...extra });

describe("form layouts", () => {
  const fields = [
    field("id", "autonumber"),
    field("name", "text", { required: true }),
    field("notes", "longtext"),
    field("tags", "multichoice", { options: { choices: ["a", "b"] } }),
    field("size", "choice", { options: { choices: ["S", "M"] } }),
    field("paid", "yesno", { required: true }),
    field("customer", "lookup", { required: true }),
  ];

  it("lays out every field but the ID, long ones full width, with a subform per relationship", () => {
    const l = defaultLayout(fields, [{ tableId: "t2", fieldId: "x" }]);
    expect(l.items.map((i) => i.field)).toEqual(["name", "notes", "tags", "size", "paid", "customer"]);
    expect(l.items.filter((i) => i.wide).map((i) => i.field)).toEqual(["notes", "tags"]);
    expect(l.subforms).toEqual([{ table: "t2", field: "x" }]);
    expect(l.columns).toBe(2);
  });

  it("keeps only the known parts of a layout", () => {
    const l = cleanLayout({ columns: 3, title: "  ", items: [{ field: "a", label: " Name ", evil: 1 }, { field: "a" }, { nope: 1 }], subforms: "x", allowDeletions: false });
    expect(l).toEqual({ title: undefined, columns: 2, items: [{ field: "a", label: "Name", wide: undefined }], subforms: [], allowEdits: true, allowAdditions: true, allowDeletions: false });
  });

  it("asks online what Synergy Forms can ask, and says what it can't", () => {
    const { questions, fieldIds, notes } = onlineQuestions(defaultLayout(fields, []), fields);
    expect(fieldIds).toEqual(["name", "notes", "size", "paid"]);
    expect(questions).toEqual([
      { label: "NAME", type: "text", required: true },
      { label: "NOTES", type: "textarea", required: false },
      { label: "SIZE", type: "select", required: false, options: ["S", "M"] },
      { label: "PAID", type: "checkbox", required: false },
    ]);
    expect(notes).toEqual([
      expect.stringMatching(/^TAGS isn't on the online form/),
      expect.stringMatching(/^CUSTOMER isn't on the online form; .*related records/),
      expect.stringMatching(/^CUSTOMER is required but isn't asked online/),
    ]);
  });
});

/** A stand-in for Synergy Forms' API, keeping forms and submissions in memory. */
function fakeForms() {
  const forms = new Map<string, { id: string; slug: string; title: string; fields: { label: string; type: string }[]; published: boolean }>();
  const subs = new Map<string, { id: string; data: Record<string, string>; submitted_at: string }[]>();
  const seen: { method: string; url: string; email?: string; secret?: string }[] = [];
  let next = 1;
  let sub = 100;
  const read = (req: IncomingMessage) =>
    new Promise<any>((resolve) => {
      let s = "";
      req.on("data", (c) => (s += c));
      req.on("end", () => resolve(s ? JSON.parse(s) : {}));
    });
  const server: Server = createServer(async (req, res) => {
    seen.push({ method: req.method!, url: req.url!, email: req.headers["x-auth-request-email"] as string, secret: req.headers["x-proxy-auth-secret"] as string });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers["x-proxy-auth-secret"] !== "s3cret") return send(401, { error: "unauthenticated" });
    const m = req.url!.match(/^\/api\/forms(?:\/(\d+))?(\/submissions)?$/);
    if (!m) return send(404, { error: "not found" });
    const body = req.method === "GET" ? {} : await read(req);
    if (req.method === "POST" && !m[1]) {
      const slug = body.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if ([...forms.values()].some((f) => f.slug === slug)) return send(409, { error: "a form with that title exists" });
      const f = { id: String(next++), slug, title: body.title, fields: body.fields, published: false };
      forms.set(f.id, f);
      return send(200, f);
    }
    const f = m[1] ? forms.get(m[1]) : undefined;
    if (!f) return send(404, { error: "not found" });
    if (req.method === "PATCH") {
      if (body.fields) f.fields = body.fields;
      if (body.title) f.title = body.title;
      if (body.published !== undefined && body.published !== null) f.published = !!body.published;
      return send(200, f);
    }
    if (req.method === "GET" && m[2]) return send(200, [...(subs.get(f.id) ?? [])].reverse());
    return send(405, { error: "no" });
  });
  return {
    server,
    forms,
    seen,
    /** A response as the public page would store it. */
    submit(formId: string, data: Record<string, string>) {
      subs.set(formId, [...(subs.get(formId) ?? []), { id: String(sub++), data, submitted_at: new Date().toISOString() }]);
    },
  };
}

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("forms", () => {
  let cat: typeof import("@/lib/catalog");
  let rows: typeof import("@/lib/rows");
  let fm: typeof import("@/lib/forms");
  let pg: typeof import("@/lib/db");
  const fake = fakeForms();
  const owner = "f-owner@example.com";
  const viewer = "f-viewer@example.com";
  const made: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await new Promise<void>((r) => fake.server.listen(0, "127.0.0.1", r));
    process.env.FORMS_INTERNAL_URL = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
    process.env.PROXY_SHARED_SECRET = "s3cret";
    process.env.SUITE_DOMAIN = "example.org";
    cat = await import("@/lib/catalog");
    rows = await import("@/lib/rows");
    fm = await import("@/lib/forms");
    pg = await import("@/lib/db");
  });

  afterAll(async () => {
    for (const id of made) await cat.deleteDatabase(id, owner).catch(() => {});
    await pg.db().close();
    await new Promise((r) => fake.server.close(r));
  });

  async function shop() {
    const d = await cat.createDatabase(owner, { name: "Shop" });
    made.push(d.id);
    const customers = await cat.createTable(d.id, owner, {
      name: "Customers",
      fields: [
        { name: "Name", type: "text", required: true },
        { name: "Email", type: "email" },
        { name: "Size", type: "choice", options: { choices: ["S", "M", "L"] } },
        { name: "Visits", type: "number" },
        { name: "Newsletter", type: "yesno" },
      ],
    });
    const orders = await cat.createTable(d.id, owner, {
      name: "Orders",
      fields: [
        { name: "Item", type: "text" },
        { name: "Customer", type: "lookup", options: { targetTable: customers.id } },
      ],
    });
    return { d, customers, orders };
  }

  it("makes a form with every field and a subform for each relationship, and checks layouts", async () => {
    const s = await shop();
    const f = await fm.createForm(s.d.id, owner, { tableId: s.customers.id });
    expect(f.name).toBe("Customers");
    expect(f.layout.items.map((i) => i.field)).toEqual(s.customers.fields.slice(1).map((x) => x.id));
    expect(f.layout.subforms).toEqual([{ table: s.orders.id, field: s.orders.fields[2].id }]);
    // Fields of other tables and subforms that aren't relationships are dropped on save.
    const u = await fm.updateForm(f.id, owner, {
      name: "Customer card",
      layout: { columns: 1, items: [{ field: s.customers.fields[1].id, label: "Full name" }, { field: s.orders.fields[1].id }], subforms: [{ table: s.orders.id, field: s.orders.fields[1].id }] },
    });
    expect(u.layout.items).toEqual([{ field: s.customers.fields[1].id, label: "Full name", wide: undefined }]);
    expect(u.layout.subforms).toEqual([]);
    expect(u.layout.columns).toBe(1);
    await expect(fm.createForm(s.d.id, owner, { tableId: s.orders.id, name: "customer CARD" })).rejects.toThrow(/already a form/);
    expect((await fm.listForms(s.d.id, owner)).map((x) => x.name)).toEqual(["Customer card"]);
    // A table's forms go with it.
    const o = await fm.createForm(s.d.id, owner, { tableId: s.orders.id });
    await cat.deleteTable(s.orders.id, owner);
    await expect(fm.getForm(o.id, owner)).rejects.toMatchObject({ status: 404 });
  });

  it("lets viewers open forms but not change them", async () => {
    const s = await shop();
    await pg.db().q(`INSERT INTO base_members (database_id, email, role) VALUES ($1, $2, 'viewer')`, [s.d.id, viewer]);
    const f = await fm.createForm(s.d.id, owner, { tableId: s.customers.id });
    expect((await fm.getForm(f.id, viewer)).name).toBe("Customers");
    await expect(fm.updateForm(f.id, viewer, { name: "Mine" })).rejects.toMatchObject({ status: 403 });
    await expect(fm.createForm(s.d.id, viewer, { tableId: s.customers.id, name: "Mine" })).rejects.toMatchObject({ status: 403 });
    await expect(fm.publishForm(f.id, viewer)).rejects.toMatchObject({ status: 403 });
    await expect(fm.getForm(f.id, "stranger@example.com")).rejects.toMatchObject({ status: 404 });
    // A form in another database can't be made on this table.
    const other = await cat.createDatabase(owner, { name: "Other" });
    made.push(other.id);
    await expect(fm.createForm(other.id, owner, { tableId: s.customers.id })).rejects.toMatchObject({ status: 404 });
  });

  it("publishes to Synergy Forms and brings responses in as records", async () => {
    const s = await shop();
    const [, name, email, size, visits, news] = s.customers.fields;
    const f = await fm.createForm(s.d.id, owner, { tableId: s.customers.id, name: "Sign up" });
    const { form, notes } = await fm.publishForm(f.id, owner);
    expect(notes).toEqual([]);
    expect(form.online).toMatchObject({ url: "https://forms.example.org/f/sign-up", published: true, fields: [name.id, email.id, size.id, visits.id, news.id] });
    const online = [...fake.forms.values()].find((x) => x.slug === "sign-up")!;
    expect(online.published).toBe(true);
    expect(online.fields.map((q) => q.type)).toEqual(["text", "email", "select", "text", "checkbox"]);
    expect(fake.seen.at(-1)).toMatchObject({ email: owner, secret: "s3cret" });

    fake.submit(online.id, { f0: "Ada", f1: "ada@example.com", f2: "M", f3: "3", f4: "yes" });
    fake.submit(online.id, { f0: "Bob", f1: "", f2: "", f3: "lots", f4: "" });
    fake.submit(online.id, { f0: "Cy", f1: "", f2: "", f3: "", f4: "" });
    const r = await fm.syncResponses(f.id, owner);
    expect(r.added).toBe(2);
    expect(r.failed).toEqual([expect.objectContaining({ reason: expect.stringMatching(/Visits: expected a number/) })]);
    expect(r.form.online?.syncedAt).toBeTruthy();
    const t = await cat.getTable(s.customers.id, owner);
    const got = (await rows.listRows(t)).rows.map((x) => [x.values[name.id], x.values[email.id], x.values[size.id], x.values[visits.id], x.values[news.id]]);
    expect(got).toEqual([
      ["Ada", "ada@example.com", "M", "3", true],
      ["Cy", null, null, null, false],
    ]);
    // Responses are brought in once.
    expect((await fm.syncResponses(f.id, owner)).added).toBe(0);

    // A changed form updates the online form; responses already in are read with the old questions first.
    fake.submit(online.id, { f0: "Di", f1: "", f2: "S", f3: "", f4: "" });
    await fm.updateForm(f.id, owner, { layout: { items: [{ field: size.id, label: "T-shirt" }, { field: name.id }] } });
    const again = await fm.publishForm(f.id, owner);
    expect(again.added).toBe(1);
    expect(online.fields).toEqual([expect.objectContaining({ label: "T-shirt", type: "select" }), expect.objectContaining({ label: "Name", type: "text", required: true })]);
    fake.submit(online.id, { f0: "L", f1: "Eve" });
    expect((await fm.syncResponses(f.id, owner)).added).toBe(1);
    const names = (await rows.listRows(t)).rows.map((x) => `${x.values[name.id]}:${x.values[size.id] ?? ""}`);
    expect(names).toEqual(["Ada:M", "Cy:", "Di:S", "Eve:L"]);

    // Closing stops responses; deleting the form closes it too.
    expect((await fm.unpublishForm(f.id, owner)).online?.published).toBe(false);
    expect(online.published).toBe(false);
    await fm.publishForm(f.id, owner);
    expect(online.published).toBe(true);
    await fm.deleteForm(f.id, owner);
    expect(online.published).toBe(false);
  });

  it("names forms apart in Synergy Forms, makes a new one if it was deleted there, and says what can't go online", async () => {
    const s = await shop();
    const a = await fm.createForm(s.d.id, owner, { tableId: s.orders.id, name: "Orders A", layout: { title: "Order", items: s.orders.fields.map((x) => ({ field: x.id })) } });
    const b = await fm.createForm(s.d.id, owner, { tableId: s.orders.id, name: "Orders B", layout: { title: "Order", items: s.orders.fields.map((x) => ({ field: x.id })) } });
    const pa = await fm.publishForm(a.id, owner);
    expect(pa.notes).toEqual([expect.stringMatching(/^Customer isn't on the online form/)]);
    const pb = await fm.publishForm(b.id, owner);
    expect(pb.form.online?.url).toMatch(/\/f\/order-2$/);
    // Deleted in Synergy Forms: syncing says so, publishing makes a new one.
    const id = [...fake.forms.values()].find((x) => x.slug === "order-2")!.id;
    fake.forms.delete(id);
    await expect(fm.syncResponses(b.id, owner)).rejects.toMatchObject({ status: 404 });
    const re = await fm.publishForm(b.id, owner);
    expect(re.form.online?.url).toMatch(/\/f\/order-2$/);
    // A form with nothing that can be asked online can't be published.
    const c = await fm.createForm(s.d.id, owner, { tableId: s.orders.id, name: "Orders C", layout: { items: [{ field: s.orders.fields[2].id }] } });
    await expect(fm.publishForm(c.id, owner)).rejects.toMatchObject({ status: 400 });
    await expect(fm.syncResponses(c.id, owner)).rejects.toThrow(/isn't online/);
  });

  it("says when Synergy Forms can't be reached", async () => {
    const s = await shop();
    const f = await fm.createForm(s.d.id, owner, { tableId: s.customers.id });
    const was = process.env.FORMS_INTERNAL_URL;
    process.env.FORMS_INTERNAL_URL = "http://127.0.0.1:9";
    try {
      await expect(fm.publishForm(f.id, owner)).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/isn't reachable/) });
    } finally {
      process.env.FORMS_INTERNAL_URL = was;
    }
    expect((await fm.getForm(f.id, owner)).online).toBeNull();
  });
});
