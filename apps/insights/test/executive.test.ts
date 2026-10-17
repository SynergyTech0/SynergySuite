import { describe, expect, it } from "vitest";
import { config } from "@/lib/config";
import { CARDS, EXECUTIVE_COLLECTION, EXECUTIVE_DASHBOARD, type ExecutiveCard, findExecutive, layout, provisionExecutive } from "@/lib/executive";
import { ANALYSTS_GROUP, Metabase } from "@/lib/metabase";

const c = config({ INSIGHTS_SECRET: "s3cret", SUITE_DOMAIN: "example.com", METABASE_INTERNAL_URL: "http://mb" });

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Card = { id: number; name: string; description: string; display: string; collection_id: number; visualization_settings: Record<string, unknown>; dataset_query: Record<string, unknown> };

/** Just enough of Metabase's API, kept in memory, to watch what provisioning does. */
function fakeMetabase() {
  let next = 100;
  const collections: { id: number; name: string; location: string; archived: boolean; personal_owner_id: number | null }[] = [
    { id: 1, name: "Jane's Personal Collection", location: "/", archived: false, personal_owner_id: 7 },
  ];
  const cards = new Map<number, Card>();
  const dashboards = new Map<number, { id: number; name: string; collection_id: number; dashcards: { id: number; card_id: number | null }[] }>();
  const writes: string[] = [];
  const graphPuts: unknown[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = url.replace("http://mb", "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (method !== "GET" && path !== "/api/session") writes.push(`${method} ${path.replace(/\d+/g, ":id")}`);
    if (path === "/api/session/properties") return json(200, { "has-user-setup": true });
    if (path === "/api/session") return json(200, { id: "svc" });
    if (path === "/api/permissions/group") {
      return json(200, [{ id: 1, name: "All Users", magic_group_type: "all-internal-users" }, { id: 2, name: "Administrators", magic_group_type: "admin" }, { id: 3, name: ANALYSTS_GROUP }]);
    }
    if (path === "/api/collection/graph" && method === "GET") return json(200, { revision: 4, groups: {} });
    if (path === "/api/collection/graph" && method === "PUT") return graphPuts.push(body), json(200, {});
    if (path === "/api/collection" && method === "GET") return json(200, [{ id: "root", name: "Our analytics" }, ...collections]);
    if (path === "/api/collection" && method === "POST") {
      const made = { id: next++, name: body.name, location: "/", archived: false, personal_owner_id: null };
      collections.push(made);
      return json(200, made);
    }
    const items = path.match(/^\/api\/collection\/(\d+)\/items\?/);
    if (items) {
      const id = Number(items[1]);
      return json(200, {
        data: [
          ...[...cards.values()].filter((x) => x.collection_id === id).map((x) => ({ id: x.id, model: "card", name: x.name })),
          ...[...dashboards.values()].filter((x) => x.collection_id === id).map((x) => ({ id: x.id, model: "dashboard", name: x.name })),
        ],
      });
    }
    if (path === "/api/card" && method === "POST") {
      const card = { ...body, id: next++ } as Card;
      cards.set(card.id, card);
      return json(200, card);
    }
    const card = path.match(/^\/api\/card\/(\d+)$/);
    if (card) {
      const id = Number(card[1]);
      if (method === "PUT") cards.set(id, { ...cards.get(id)!, ...body });
      return json(200, cards.get(id));
    }
    if (path === "/api/dashboard" && method === "POST") {
      const d = { id: next++, name: body.name, collection_id: body.collection_id, dashcards: [] };
      dashboards.set(d.id, d);
      return json(200, d);
    }
    const dash = path.match(/^\/api\/dashboard\/(\d+)$/);
    if (dash) {
      const d = dashboards.get(Number(dash[1]))!;
      if (method === "PUT") d.dashcards = body.dashcards.map((x: { card_id: number | null }, i: number) => ({ id: 1000 + i, card_id: x.card_id }));
      return json(200, d);
    }
    throw new Error(`unexpected ${method} ${path}`);
  }) as typeof fetch;
  return { fetchImpl, collections, cards, dashboards, writes, graphPuts };
}

const ALL = { books: 11, crm: 12, desk: 13, planner: 14 };
const cardCount = Object.keys(CARDS).length;

describe("Executive overview", () => {
  it("makes the collection, every card and the dashboard once, closed to everyone but admins", async () => {
    const f = fakeMetabase();
    const r = await provisionExecutive(new Metabase(c, f.fetchImpl), ALL);
    expect(r).toMatchObject({ status: "ok", cards: cardCount });
    expect(f.collections.filter((x) => x.name === EXECUTIVE_COLLECTION)).toHaveLength(1);
    expect(f.cards.size).toBe(cardCount);
    expect([...f.dashboards.values()].map((d) => d.name)).toEqual([EXECUTIVE_DASHBOARD]);
    const collectionId = f.collections.find((x) => x.name === EXECUTIVE_COLLECTION)!.id;
    expect(f.graphPuts).toEqual([{ revision: 4, groups: { 1: { [collectionId]: "none" }, 3: { [collectionId]: "none" } } }]);
    const d = f.dashboards.get(r.dashboardId!)!;
    expect(new Set(d.dashcards.map((x) => x.card_id).filter(Boolean))).toEqual(new Set(f.cards.keys()));
    // Each card runs on its own app's database, as a native query.
    const revenue = [...f.cards.values()].find((x) => x.name === CARDS.revenueThisMonth.name)!;
    expect(revenue.dataset_query).toMatchObject({ type: "native", database: 11, native: { query: CARDS.revenueThisMonth.sql } });
    expect([...f.cards.values()].find((x) => x.name === CARDS.openCases.name)!.dataset_query).toMatchObject({ database: 13 });
  });

  it("changes nothing on a second run", async () => {
    const f = fakeMetabase();
    const mb = new Metabase(c, f.fetchImpl);
    const first = await provisionExecutive(mb, ALL);
    f.writes.length = 0;
    const again = await provisionExecutive(mb, ALL);
    expect(again).toEqual(first);
    expect(f.writes).toEqual([]);
    expect(f.cards.size).toBe(cardCount);
    expect(f.dashboards.size).toBe(1);
  });

  it("updates a card whose query changed, in place", async () => {
    const f = fakeMetabase();
    const mb = new Metabase(c, f.fetchImpl);
    await provisionExecutive(mb, ALL);
    const card = [...f.cards.values()].find((x) => x.name === CARDS.cash.name)!;
    card.dataset_query = { ...card.dataset_query, native: { query: "SELECT 1" } };
    card.visualization_settings = {};
    f.writes.length = 0;
    await provisionExecutive(mb, ALL);
    expect(f.writes).toEqual(["PUT /api/card/:id"]);
    expect(f.cards.get(card.id)!.dataset_query).toMatchObject({ native: { query: CARDS.cash.sql } });
    expect(f.cards.size).toBe(cardCount);
  });

  it("reads queries in the newer stages form too", async () => {
    const f = fakeMetabase();
    const mb = new Metabase(c, f.fetchImpl);
    await provisionExecutive(mb, ALL);
    for (const card of f.cards.values()) {
      const q = card.dataset_query as { database: number; native: { query: string } };
      card.dataset_query = { "lib/type": "mbql/query", database: q.database, stages: [{ "lib/type": "mbql.stage/native", native: q.native.query }] };
    }
    f.writes.length = 0;
    await provisionExecutive(mb, ALL);
    expect(f.writes).toEqual([]);
  });

  it("adds the cards of a source connected later and lays the dashboard out again, without duplicates", async () => {
    const f = fakeMetabase();
    const mb = new Metabase(c, f.fetchImpl);
    const first = await provisionExecutive(mb, { books: 11 });
    const books = Object.values(CARDS).filter((x: ExecutiveCard) => x.source === "books").length;
    expect(first.cards).toBe(books);
    expect(f.cards.size).toBe(books);
    const second = await provisionExecutive(mb, ALL);
    expect(second.dashboardId).toBe(first.dashboardId);
    expect(f.cards.size).toBe(cardCount);
    expect(f.dashboards.size).toBe(1);
    expect(f.collections.filter((x) => x.name === EXECUTIVE_COLLECTION)).toHaveLength(1);
    expect(f.graphPuts).toHaveLength(1);
    const ids = f.dashboards.get(second.dashboardId!)!.dashcards.map((x) => x.card_id).filter(Boolean);
    expect(ids).toHaveLength(cardCount);
  });

  it("puts back a card someone took off the dashboard", async () => {
    const f = fakeMetabase();
    const mb = new Metabase(c, f.fetchImpl);
    const r = await provisionExecutive(mb, ALL);
    const d = f.dashboards.get(r.dashboardId!)!;
    d.dashcards = d.dashcards.filter((x) => x.card_id !== d.dashcards.find((y) => y.card_id)!.card_id);
    await provisionExecutive(mb, ALL);
    expect(d.dashcards.filter((x) => x.card_id)).toHaveLength(cardCount);
  });

  it("does nothing until one of its sources is connected", async () => {
    const f = fakeMetabase();
    const r = await provisionExecutive(new Metabase(c, f.fetchImpl), { base: 5, forms: 6 });
    expect(r.status).toBe("skipped");
    expect(f.writes).toEqual([]);
  });

  it("finds the dashboard by name and collection", () => {
    const list = [
      { id: 1, name: EXECUTIVE_DASHBOARD, collection: "Sales" },
      { id: 2, name: EXECUTIVE_DASHBOARD, collection: EXECUTIVE_COLLECTION },
    ];
    expect(findExecutive(list)?.id).toBe(2);
    expect(findExecutive([])).toBeUndefined();
  });
});

describe("Executive overview layout", () => {
  it("fills the 24-column grid without overlaps", () => {
    const ids = Object.fromEntries(Object.keys(CARDS).map((k, i) => [k, i + 1]));
    const cells = layout(ids);
    const taken = new Set<string>();
    for (const d of cells) {
      expect(d.col + d.size_x).toBeLessThanOrEqual(24);
      for (let y = d.row; y < d.row + d.size_y; y++) {
        for (let x = d.col; x < d.col + d.size_x; x++) {
          expect(taken.has(`${x},${y}`)).toBe(false);
          taken.add(`${x},${y}`);
        }
      }
    }
    expect(cells.filter((d) => d.card_id).length).toBe(Object.keys(CARDS).length);
  });

  it("drops a section with no cards and widens what's left in a row", () => {
    const cells = layout({ revenueThisMonth: 1, cash: 2 });
    const headings = cells.filter((d) => (d.visualization_settings.virtual_card as { display?: string } | undefined)?.display === "heading");
    expect(headings.map((d) => d.visualization_settings.text)).toEqual(["Revenue & cash"]);
    expect(cells.filter((d) => d.card_id).map((d) => d.size_x)).toEqual([12, 12]);
  });
});

describe("Executive overview queries", () => {
  it("copes with an empty company: totals fall back to zero and charts use a fixed set of months or stages", () => {
    for (const card of Object.values(CARDS) as ExecutiveCard[]) {
      if (card.display === "scalar") expect(card.sql, card.name).toMatch(/COALESCE\(SUM|COUNT\(\*\)/);
      if (card.display === "bar") expect(card.sql, card.name).toMatch(/generate_series|VALUES/);
    }
  });

  it("never names a column the read-only role can't see", async () => {
    const { isSecretColumn } = await import("@/lib/sources");
    for (const card of Object.values(CARDS) as ExecutiveCard[]) {
      for (const m of card.sql.matchAll(/"([A-Za-z_]+)"/g)) expect(isSecretColumn(m[1]), `${card.name}: ${m[1]}`).toBe(false);
    }
  });
});
