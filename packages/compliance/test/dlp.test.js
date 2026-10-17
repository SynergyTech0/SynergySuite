const test = require("node:test");
const assert = require("node:assert/strict");
const {
  scanText, evaluateDlp, luhn, ibanValid, abaValid, isInternal, patternProblem, createPolicyClient,
  DEFAULT_LABELS, labelById, allowsExternal, isDowngrade, msipHeader, parseMsipHeader, msipProperties, validateLabels,
} = require("../dist");

const types = (text, settings) => scanText(text, settings).map((m) => [m.type, m.count]);

test("validators", () => {
  assert.equal(luhn("4111111111111111"), true);
  assert.equal(luhn("4111111111111112"), false);
  assert.equal(ibanValid("GB82 WEST 1234 5698 7654 32"), true);
  assert.equal(ibanValid("GB82 WEST 1234 5698 7654 33"), false);
  assert.equal(abaValid("021000021"), true);
  assert.equal(abaValid("021000022"), false);
});

test("finds card numbers that pass Luhn, not look-alikes", () => {
  assert.deepEqual(types("Card: 4111 1111 1111 1111, exp 12/29"), [["credit-card", 1]]);
  assert.deepEqual(types("Order 4111 1111 1111 1112 shipped"), []);
  assert.deepEqual(types("Tracking 1234567812345670"), []); // passes Luhn, no card prefix
  assert.deepEqual(types("Phone 555-123-4567, zip 90210"), []);
  const [m] = scanText("4111-1111-1111-1111 and 5500 0000 0000 0004 and 4111111111111111");
  assert.equal(m.count, 2);
  assert.deepEqual(m.samples, ["•••• 1111", "•••• 0004"]);
});

test("SSNs follow the rules; bare digits need a supporting word", () => {
  assert.deepEqual(types("SSN 123-45-6789"), [["us-ssn", 1]]);
  assert.deepEqual(types("ref 000-12-3456 and 666-12-3456 and 912-12-3456"), []);
  assert.deepEqual(types("Invoice 123456789"), []);
  assert.deepEqual(types("Her social security number is 123456789"), [["us-ssn", 1]]);
});

test("IBANs, routing numbers, NINOs, SINs and credentials", () => {
  assert.deepEqual(types("Pay to GB82 WEST 1234 5698 7654 32"), [["iban", 1]]);
  assert.deepEqual(types("routing 021000021 account 12345"), [["us-bank-routing", 1]]);
  assert.deepEqual(types("call 021000021"), []);
  assert.deepEqual(types("NI number AB 12 34 56 C"), [["uk-nino", 1]]);
  assert.deepEqual(types("SIN: 046 454 286"), [["ca-sin", 1]]);
  assert.deepEqual(types("key AKIAIOSFODNN7EXAMPLE"), [["credentials", 1]]);
  assert.deepEqual(types("-----BEGIN OPENSSH PRIVATE KEY-----\nabc"), [["credentials", 1]]);
});

test("custom types by keyword and pattern", () => {
  const settings = { types: [
    { id: "proj", name: "Project Falcon", keywords: ["Falcon", "project hawk"] },
    { id: "emp", name: "Employee ID", pattern: "EMP-\\d{6}" },
  ] };
  assert.deepEqual(types("The falcon plan, see Project Hawk and EMP-123456, EMP-654321", settings), [["proj", 2], ["emp", 2]]);
  assert.deepEqual(types("falconry is a hobby", settings), []);
  assert.equal(patternProblem("("), patternProblem("(")); // stable
  assert.match(patternProblem("("), /Not a valid pattern/);
  assert.match(patternProblem("a*"), /empty/);
  assert.equal(patternProblem("EMP-\\d+"), null);
});

test("internal domains include subdomains", () => {
  assert.equal(isInternal("pat@example.com", ["example.com"]), true);
  assert.equal(isInternal("pat@eu.example.com", ["example.com"]), true);
  assert.equal(isInternal("pat@notexample.com", ["example.com"]), false);
  assert.equal(isInternal("pat@example.com", []), false);
});

const rule = (over) => ({ id: "r", name: "Rule", enabled: true, mode: "enforce", apps: [], types: [], labels: [], scope: "anyone", action: "block", ...over });
const settings = (rules) => ({ rules, types: [], internalDomains: ["example.com"] });
const card = "Card 4111 1111 1111 1111";

test("external rules only fire for outside recipients", () => {
  const s = settings([rule({ types: [{ type: "credit-card", min: 1 }], scope: "external" })]);
  assert.equal(evaluateDlp(s, { app: "mail", text: card, recipients: ["bob@example.com"] }).action, "allow");
  const d = evaluateDlp(s, { app: "mail", text: card, recipients: ["bob@example.com", "eve@gmail.com"] });
  assert.equal(d.action, "block");
  assert.deepEqual(d.outside, ["eve@gmail.com"]);
  assert.equal(d.external, true);
  assert.match(d.tip, /outside the company/);
  assert.equal(evaluateDlp(s, { app: "drive", text: card, external: true }).action, "block");
});

test("the strongest action wins; test mode only audits; minimum counts and apps apply", () => {
  const s = settings([
    rule({ id: "a", types: [{ type: "credit-card", min: 1 }], action: "warn", tip: "Careful" }),
    rule({ id: "b", types: [{ type: "credit-card", min: 2 }], action: "block" }),
    rule({ id: "c", types: [{ type: "credit-card", min: 1 }], action: "block", mode: "test" }),
    rule({ id: "d", types: [{ type: "credit-card", min: 1 }], action: "block", apps: ["chat"] }),
    rule({ id: "e", types: [{ type: "credit-card", min: 1 }], action: "block", enabled: false }),
  ]);
  const d = evaluateDlp(s, { app: "mail", text: card });
  assert.equal(d.action, "warn");
  assert.equal(d.tip, "Careful");
  assert.deepEqual(d.rules.map((r) => [r.id, r.action]), [["a", "warn"], ["c", "audit"]]);
  assert.equal(evaluateDlp(s, { app: "mail", text: `${card} and 5500 0000 0000 0004` }).action, "block");
  assert.equal(evaluateDlp(settings([rule({ types: [{ type: "credit-card", min: 1 }], mode: "test" })]), { app: "mail", text: card }).action, "audit");
  assert.equal(evaluateDlp(s, { app: "mail", text: "nothing here" }).action, "allow");
});

test("rules can match a sensitivity label", () => {
  const hc = DEFAULT_LABELS[3].id;
  const s = settings([rule({ labels: [hc], scope: "external" })]);
  assert.equal(evaluateDlp(s, { app: "drive", labelId: hc.toUpperCase(), external: true }).action, "block");
  assert.equal(evaluateDlp(s, { app: "drive", labelId: DEFAULT_LABELS[0].id, external: true }).action, "allow");
});

test("labels: lookups, protection and Office markers", () => {
  const s = { labels: DEFAULT_LABELS };
  const [pub, , conf, hc] = DEFAULT_LABELS;
  assert.equal(labelById(s, `{${conf.id.toUpperCase()}}`).name, "Confidential");
  assert.equal(allowsExternal(s, hc.id), false);
  assert.equal(allowsExternal(s, pub.id), true);
  assert.equal(allowsExternal(s, null), true);
  assert.equal(isDowngrade(s, hc.id, pub.id), true);
  assert.equal(isDowngrade(s, pub.id, hc.id), false);
  assert.equal(isDowngrade(s, conf.id, null), true);
  const header = msipHeader(conf);
  assert.match(header, new RegExp(`MSIP_Label_${conf.id}_Enabled=true;`));
  assert.deepEqual(parseMsipHeader(header), { id: conf.id, name: "Confidential" });
  assert.equal(parseMsipHeader("nothing"), null);
  assert.equal(msipProperties(null).length, 0);
  assert.throws(() => validateLabels({ labels: [{ ...pub }, { ...pub }] }), /share the id/);
  assert.throws(() => validateLabels({ labels: [pub], defaultLabelId: hc.id }), /default label/);
});

test("the policy client carries labels and DLP, keeps them when the Admin center goes away, and reports", async () => {
  const policy = {
    holds: [], retention: [], updatedAt: "2026-10-16T00:00:00Z",
    labels: { labels: [DEFAULT_LABELS[0]], defaultLabelId: DEFAULT_LABELS[0].id },
    dlp: settings([rule({ types: [{ type: "credit-card", min: 1 }] })]),
  };
  let up = true;
  const posted = [];
  const fetch = async (url, init) => {
    if (!up) throw new Error("down");
    if (init && init.method === "POST") { posted.push([url, JSON.parse(init.body)]); return { ok: true }; }
    return { ok: true, json: async () => policy };
  };
  const c = createPolicyClient({ app: "mail", url: "http://admin", token: "t", fetch });
  assert.equal((await c.labels()).labels.length, 1);
  assert.equal((await c.checkDlp({ text: card })).action, "block");
  up = false;
  c.invalidate();
  assert.equal((await c.labels()).labels.length, 1);
  assert.equal((await c.checkDlp({ text: card })).action, "block");
  await c.reportDlp({ actor: "a@example.com", title: "x", action: "block", rules: [], matches: [] }); // swallowed
  up = true;
  await c.reportDlp({ actor: "a@example.com", title: "x", action: "block", rules: [], matches: [] });
  assert.deepEqual(posted.map(([u, b]) => [u, b.app]), [["http://admin/api/svc/dlp/incidents", "mail"]]);

  const none = createPolicyClient({ app: "mail", url: "" });
  assert.equal((await none.labels()).labels.length, 4);
  assert.equal((await none.checkDlp({ text: card })).action, "allow");
});

test("without listed domains the suite's own mail domain is inside", async () => {
  const before = process.env.MAIL_DOMAIN;
  process.env.MAIL_DOMAIN = "Example.com";
  try {
    const none = createPolicyClient({ app: "mail", url: "" });
    assert.deepEqual((await none.dlpSettings()).internalDomains, ["example.com"]);
  } finally {
    if (before === undefined) delete process.env.MAIL_DOMAIN; else process.env.MAIL_DOMAIN = before;
  }
});
