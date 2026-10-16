// @mentions in comments e-mail the people named who can open the document.
import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyMentions, publicOrigin, smtpSender } from "../lib/mentions";

const doc = { id: "d1", org: "synergy", owner_email: "owner@acme.test", scope: "private", company_role: null, kind: "slide", title: "Plan" };
const by = { email: "ana@acme.test", name: "Ana", org: "synergy" };

test("mentions e-mail the owner and people the document is shared with, once per thread", async () => {
  const sent: { to: string; subject: string; text: string }[] = [];
  const send = async (to: string, subject: string, text: string) => void sent.push({ to, subject, text });
  const granted = async (_d: unknown, emails: string[]) => new Set(emails.filter((e) => e === "bo@acme.test"));
  const told = await notifyMentions({ doc, by, body: "@owner@acme.test @Bo@acme.test @eve@else.test @ana@acme.test look", quote: "Q3 numbers", origin: "https://office.example.test", send, granted });
  assert.deepEqual(told, ["owner@acme.test", "bo@acme.test"]);
  assert.equal(sent[0].subject, 'Ana mentioned you in "Plan"');
  assert.match(sent[0].text, /> Q3 numbers/);
  assert.match(sent[0].text, /https:\/\/office\.example\.test\/slides\/d1/);
  // a reply naming the same people again tells no one new
  assert.deepEqual(await notifyMentions({ doc, by, body: "@bo@acme.test again", before: ["hi @bo@acme.test"], origin: "", send, granted }), []);
  // company-wide documents: people at the mentioner's domain
  assert.deepEqual(await notifyMentions({ doc: { ...doc, scope: "company", company_role: "commenter" }, by, body: "@cy@acme.test @x@other.test", origin: "", send, granted: async () => new Set() }), ["cy@acme.test"]);
  // no mail server: nothing is sent, nothing fails
  assert.deepEqual(await notifyMentions({ doc, by, body: "@owner@acme.test", origin: "", send: null, granted }), []);
  // a failing mail server never loses the comment
  assert.deepEqual(await notifyMentions({ doc, by, body: "@owner@acme.test", origin: "", send: async () => { throw new Error("down"); }, granted }), []);
});

test("mail server and link settings come from the environment", async () => {
  assert.equal(await smtpSender({}), null);
  assert.equal(typeof (await smtpSender({ SMTP_HOST: "127.0.0.1", SMTP_PORT: "2525" })), "function");
  assert.equal(publicOrigin("http://127.0.0.1:3870/api/x", { SUITE_DOMAIN: "acme.test" }), "https://office.acme.test");
  assert.equal(publicOrigin("http://127.0.0.1:3870/api/x", {}), "http://127.0.0.1:3870");
});
