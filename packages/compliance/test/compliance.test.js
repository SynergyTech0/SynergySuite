const test = require("node:test");
const assert = require("node:assert/strict");
const { parseQuery, matchesQuery, queryToSql, complianceAuthorized, createPolicyClient } = require("../dist");

test("parses words, phrases, OR and exclusions", () => {
  assert.deepEqual(parseQuery('budget "Q3 forecast" draft OR final -spam -"do not use"'), {
    groups: [["budget"], ["q3 forecast"], ["draft", "final"]],
    none: ["spam", "do not use"],
  });
  assert.deepEqual(parseQuery(""), { groups: [], none: [] });
  assert.deepEqual(parseQuery("OR alone"), { groups: [["alone"]], none: [] });
});

test("matches in memory the same way", () => {
  const p = parseQuery('invoice "acme corp" -void');
  assert.equal(matchesQuery("Invoice for ACME Corp, March", p), true);
  assert.equal(matchesQuery("Invoice for ACME Corp, void", p), false);
  assert.equal(matchesQuery("Invoice for Acme", p), false);
  assert.equal(matchesQuery("anything", parseQuery("")), true);
});

test("builds parameterized SQL with escaped LIKE patterns", () => {
  const { sql, params } = queryToSql(parseQuery('50% a OR b -x_y'), ["subject", "body"], 3);
  assert.equal(
    sql,
    "((coalesce(subject::text,'') || ' ' || coalesce(body::text,'')) ILIKE $3) AND ((coalesce(subject::text,'') || ' ' || coalesce(body::text,'')) ILIKE $4 OR (coalesce(subject::text,'') || ' ' || coalesce(body::text,'')) ILIKE $5) AND NOT ((coalesce(subject::text,'') || ' ' || coalesce(body::text,'')) ILIKE $6)",
  );
  assert.deepEqual(params, ["%50\\%%", "%a%", "%b%", "%x\\_y%"]);
  assert.deepEqual(queryToSql(parseQuery(""), ["a"]), { sql: "TRUE", params: [] });
});

test("token check needs the configured token", () => {
  assert.equal(complianceAuthorized("Bearer abc", "abc"), true);
  assert.equal(complianceAuthorized("Bearer abd", "abc"), false);
  assert.equal(complianceAuthorized("Bearer ", ""), false);
  assert.equal(complianceAuthorized(null, "abc"), false);
});

const policy = {
  holds: [
    { id: "h1", name: "Dispute", custodians: ["pat@example.com"], apps: [] },
    { id: "h2", name: "Mail only", custodians: ["sam@example.com"], apps: ["mail"] },
  ],
  retention: [
    { id: "r1", app: "chat", days: 365 },
    { id: "r2", app: "chat", kind: "message", days: 90 },
    { id: "r3", app: "drive", days: 30 },
  ],
  updatedAt: "2026-10-16T00:00:00Z",
};
const ok = (body) => async () => ({ ok: true, json: async () => body });

test("holds cover their apps and match emails case-insensitively", async () => {
  const chat = createPolicyClient({ app: "chat", url: "http://admin", token: "t", fetch: ok(policy) });
  assert.equal(await chat.onHold("PAT@example.com"), true);
  assert.equal(await chat.onHold("sam@example.com"), false);
  const mail = createPolicyClient({ app: "mail", url: "http://admin", token: "t", fetch: ok(policy) });
  assert.equal(await mail.onHold("sam@example.com"), true);
});

test("the shortest matching retention rule wins", async () => {
  const chat = createPolicyClient({ app: "chat", url: "http://admin", token: "t", fetch: ok(policy) });
  assert.equal(await chat.retentionDays("message"), 90);
  assert.equal(await chat.retentionDays("file"), 365);
  const notes = createPolicyClient({ app: "notes", url: "http://admin", token: "t", fetch: ok(policy) });
  assert.equal(await notes.retentionDays("page"), null);
});

test("fails closed when the Admin center is unreachable", async () => {
  const down = createPolicyClient({ app: "chat", url: "http://admin", token: "t", fetch: async () => { throw new Error("down"); } });
  assert.equal(await down.onHold("anyone@example.com"), true);
  assert.equal(await down.retentionDays("message"), null);
  const bad = createPolicyClient({ app: "chat", url: "http://admin", token: "t", fetch: async () => ({ ok: false, status: 401 }) });
  assert.equal(await bad.onHold("anyone@example.com"), true);
});

test("without an Admin center nobody is on hold and nothing expires", async () => {
  const none = createPolicyClient({ app: "chat", url: "", fetch: async () => { throw new Error("not called"); } });
  assert.equal(await none.onHold("pat@example.com"), false);
  assert.equal(await none.retentionDays("message"), null);
});

test("caches the policy and shares one request", async () => {
  let calls = 0;
  const c = createPolicyClient({ app: "chat", url: "http://admin", token: "t", fetch: async () => { calls++; return { ok: true, json: async () => policy }; } });
  await Promise.all([c.onHold("a@x"), c.onHold("b@x"), c.retentionDays("message")]);
  assert.equal(calls, 1);
  c.invalidate();
  await c.onHold("a@x");
  assert.equal(calls, 2);
});
