const test = require("node:test");
const assert = require("node:assert/strict");
const { createGroupsClient, groupPrincipal, groupIdOf, groupsInternalUrl } = require("../dist");

const ID = "0b6f7c1e-3a9d-4c2b-8f1e-2d4a6b8c0e12";

function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    const path = new URL(url).pathname + new URL(url).search;
    if (!(path in routes)) return new Response("{}", { status: 404 });
    const r = routes[path];
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { f, calls };
}

test("principals for one person: their email and each group", async () => {
  const { f, calls } = fakeFetch({
    "/api/svc/memberships?email=ann%40x.test": { groups: [{ id: ID, kind: "team", name: "Sales", email: "sales@x.test", role: "member" }] },
  });
  const c = createGroupsClient({ url: "http://groups:3830", secret: "s3", fetch: f });
  assert.deepEqual(await c.principalsFor(" Ann@X.test "), ["ann@x.test", `group:${ID}`]);
  assert.equal(calls[0].init.headers["x-proxy-auth-secret"], "s3");
  // Cached: no second request.
  await c.groupsOf("ann@x.test");
  assert.equal(calls.length, 1);
  c.clear();
  await c.groupsOf("ann@x.test");
  assert.equal(calls.length, 2);
});

test("group members and membership checks", async () => {
  const { f } = fakeFetch({
    [`/api/svc/groups/${ID}`]: { id: ID, kind: "team", name: "Sales", email: "", privacy: "private", owners: ["ann@x.test"], members: ["ann@x.test", "bob@x.test"] },
  });
  const c = createGroupsClient({ url: "http://g", fetch: f });
  assert.equal(await c.isGroupMember(ID, "BOB@x.test"), true);
  assert.equal(await c.isGroupMember(ID, "eve@x.test"), false);
  assert.equal(await c.groupMembers("not-an-id"), null);
  assert.equal(await c.isGroupMember("0b6f7c1e-3a9d-4c2b-8f1e-000000000000", "ann@x.test"), false);
});

test("an unreachable Groups app is an error, and is not cached", async () => {
  let fail = true;
  const f = async () => {
    if (fail) throw new Error("down");
    return new Response(JSON.stringify({ groups: [] }), { status: 200 });
  };
  const c = createGroupsClient({ url: "http://g", fetch: f });
  await assert.rejects(c.groupsOf("a@x.test"), /didn't answer/);
  fail = false;
  assert.deepEqual(await c.groupsOf("a@x.test"), []);
});

test("principal strings", () => {
  assert.equal(groupPrincipal(ID.toUpperCase()), `group:${ID}`);
  assert.throws(() => groupPrincipal("nope"));
  assert.equal(groupIdOf(`group:${ID}`), ID);
  assert.equal(groupIdOf("ann@x.test"), null);
  assert.equal(groupIdOf("group:nope"), null);
  assert.equal(groupsInternalUrl({ NODE_ENV: "production" }), "http://groups:3830");
  assert.equal(groupsInternalUrl({ GROUPS_INTERNAL_URL: "http://h:1/" }), "http://h:1");
});
