import { UserError } from "./accounts";
import { q } from "./db";
import { call, ensureMailbox } from "./provision";

/**
 * Distribution lists and shared mailboxes on Stalwart, kept in step by the Groups app through
 * PUT/DELETE /api/svc/groups/<address>: each PUT makes the mail server match exactly.
 *   list:   an x:MailingList whose recipients are the members (outside addresses allowed).
 *   shared: a Group account. Stalwart keeps membership on each user (memberGroupIds), so members
 *           need a mailbox here, and only addresses on a domain the server hosts can be members.
 *           Members see it under "Shared Folders/<address>/" and may send as it (accounts.ts).
 * Sets are patched one key at a time ("memberGroupIds/<id>": true | null), never replaced, so
 * other groups a user belongs to are left alone.
 */
export type GroupSpec = { kind: "list" | "shared"; name: string; members: string[] };
export type GroupResult = { address: string; provisioned: boolean; note?: string; skipped?: string[] };

const NOT_SET_UP = "MAIL_ADMIN_URL isn't set, so Mail can't change the mail server; set this address up there yourself";

export async function putGroup(address: string, spec: GroupSpec): Promise<GroupResult> {
  const url = process.env.MAIL_ADMIN_URL;
  if (!url) return { address, provisioned: false, note: NOT_SET_UP };
  const domains = new Map<string, string | null>();
  const { local, domain } = split(address);
  const domainId = await domainOf(url, domains, domain);
  if (!domainId) throw new UserError(`This suite's mail server doesn't host ${domain} addresses`, 403);
  if (spec.kind === "list") {
    await putList(url, address, local, domainId, spec);
    return { address, provisioned: true };
  }
  const skipped = await putShared(url, address, local, domainId, spec, domains);
  return skipped.length
    ? { address, provisioned: true, skipped, note: "Only addresses on this suite's mail domains can be members of a shared mailbox" }
    : { address, provisioned: true };
}

export async function deleteGroup(address: string): Promise<GroupResult> {
  const url = process.env.MAIL_ADMIN_URL;
  if (!url) return { address, provisioned: false, note: NOT_SET_UP };
  const { local, domain } = split(address);
  const domainId = await domainOf(url, new Map(), domain);
  if (!domainId) return { address, provisioned: true };
  const listId = await listOf(url, address, local, domainId);
  if (listId) await set(url, "x:MailingList/set", { destroy: [listId] }, listId, "notDestroyed");
  const groupId = await first(url, "x:Account/query", { filter: { name: local, domainId } });
  if (groupId && (await typeOf(url, groupId)) === "Group") {
    const granted = await q<{ user_id: string }>("SELECT user_id FROM shared_mailbox_grants WHERE address = $1", [address]);
    if (granted.length) {
      // A member whose own mailbox has gone can't be updated; there's nothing to take away then.
      const update = Object.fromEntries(granted.map((r) => [r.user_id, { [`memberGroupIds/${groupId}`]: null }]));
      await call(url, [["x:Account/set", { update }, "m"]]);
    }
    // Stalwart won't destroy a group anyone still belongs to (objectIsLinked), and it names them:
    // members added on the server itself, or whose grant Mail lost. Take them out too, then retry.
    const res = await call(url, [["x:Account/set", { destroy: [groupId] }, "s"]]);
    const linked: { object?: string; id?: string }[] = res?.notDestroyed?.[groupId]?.linkedObjects ?? [];
    const others = linked.filter((o) => o.object === "Account" && o.id).map((o) => o.id!);
    if (res?.notDestroyed?.[groupId] && others.length) {
      await call(url, [["x:Account/set", { update: Object.fromEntries(others.map((id) => [id, { [`memberGroupIds/${groupId}`]: null }])) }, "m"]]);
      await set(url, "x:Account/set", { destroy: [groupId] }, groupId, "notDestroyed");
    } else if (res?.notDestroyed?.[groupId]) {
      console.error("[mail] mail server refused", "x:Account/set", JSON.stringify(res.notDestroyed[groupId]));
      throw new UserError("The mail server refused a group change", 502);
    }
  }
  await q("DELETE FROM shared_mailbox_grants WHERE address = $1", [address]);
  return { address, provisioned: true };
}

async function putList(url: string, address: string, local: string, domainId: string, spec: GroupSpec): Promise<void> {
  // The whole recipients set each time: exactly the members, whoever was there before.
  const recipients = Object.fromEntries(spec.members.map((m) => [m, true]));
  const id = await listOf(url, address, local, domainId);
  if (id) await set(url, "x:MailingList/set", { update: { [id]: { description: spec.name, recipients } } }, id, "notUpdated");
  else await set(url, "x:MailingList/set", { create: { l: { name: local, domainId, description: spec.name, recipients } } }, "l", "notCreated");
}

async function putShared(url: string, address: string, local: string, domainId: string, spec: GroupSpec,
  domains: Map<string, string | null>): Promise<string[]> {
  let groupId = await first(url, "x:Account/query", { filter: { name: local, domainId } });
  if (groupId) {
    if ((await typeOf(url, groupId)) !== "Group") throw new UserError(`${address} is a person's mailbox, not a shared mailbox`, 409);
    await set(url, "x:Account/set", { update: { [groupId]: { description: spec.name } } }, groupId, "notUpdated");
  } else {
    const res = await call(url, [["x:Account/set", { create: { g: { "@type": "Group", name: local, domainId, description: spec.name } } }, "c"]]);
    // Two PUTs at once: the other one created it, which is fine.
    groupId = res?.created?.g?.id ?? (await first(url, "x:Account/query", { filter: { name: local, domainId } }));
    if (!groupId) {
      console.error("[mail] could not create shared mailbox", address, JSON.stringify(res?.notCreated ?? res));
      throw new UserError(`The mail server refused to create ${address}`, 502);
    }
  }

  const users = new Map<string, string>(); // member -> their account id
  const skipped: string[] = [];
  for (const m of spec.members) {
    const { local: ml, domain: md } = split(m);
    const did = await domainOf(url, domains, md);
    if (!did) { skipped.push(m); continue; }
    await ensureMailbox(m, "");
    const uid = await first(url, "x:Account/query", { filter: { name: ml, domainId: did } });
    if (uid) users.set(m, uid);
    else skipped.push(m);
  }

  const before = await q<{ member: string; user_id: string }>("SELECT member, user_id FROM shared_mailbox_grants WHERE address = $1", [address]);
  const keep = new Set(users.values());
  const gone = before.filter((r) => !users.has(r.member));
  const key = `memberGroupIds/${groupId}`;
  const update: Record<string, Record<string, true | null>> = {};
  for (const uid of keep) update[uid] = { [key]: true }; // re-asserted every time, which repairs drift
  for (const r of gone) if (!keep.has(r.user_id)) update[r.user_id] = { [key]: null };
  if (Object.keys(update).length) {
    const res = await call(url, [["x:Account/set", { update }, "m"]]);
    const failed = Object.keys(res?.notUpdated ?? {}).filter((id) => keep.has(id));
    if (failed.length) {
      console.error("[mail] could not add shared mailbox members", address, JSON.stringify(res.notUpdated));
      throw new UserError(`The mail server refused to add members to ${address}`, 502);
    }
  }
  if (gone.length) await q("DELETE FROM shared_mailbox_grants WHERE address = $1 AND member = ANY($2)", [address, gone.map((r) => r.member)]);
  for (const [member, uid] of users) {
    await q(
      `INSERT INTO shared_mailbox_grants (address, member, user_id) VALUES ($1, $2, $3)
       ON CONFLICT (address, member) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [address, member, uid],
    );
  }
  return skipped;
}

function split(address: string): { local: string; domain: string } {
  const at = address.lastIndexOf("@");
  return { local: address.slice(0, at), domain: address.slice(at + 1) };
}

async function domainOf(url: string, cache: Map<string, string | null>, domain: string): Promise<string | null> {
  if (!cache.has(domain)) cache.set(domain, (await first(url, "x:Domain/query", { filter: { name: domain } })) ?? null);
  return cache.get(domain)!;
}

async function first(url: string, method: string, args: object): Promise<string | undefined> {
  return (await call(url, [[method, args, "q"]]))?.ids?.[0];
}

/** Stalwart can't filter mailing lists by name, so search their text for the address and pick the exact one. */
async function listOf(url: string, address: string, local: string, domainId: string): Promise<string | undefined> {
  const ids: string[] = (await call(url, [["x:MailingList/query", { filter: { text: address } }, "q"]]))?.ids ?? [];
  if (!ids.length) return undefined;
  const lists: { id: string; name?: string; domainId?: string }[] =
    (await call(url, [["x:MailingList/get", { ids, properties: ["id", "name", "domainId"] }, "g"]]))?.list ?? [];
  return lists.find((l) => l.name?.toLowerCase() === local && l.domainId === domainId)?.id;
}

async function typeOf(url: string, id: string): Promise<string | undefined> {
  return (await call(url, [["x:Account/get", { ids: [id], properties: ["@type"] }, "g"]]))?.list?.[0]?.["@type"];
}

/** One /set that must succeed for `key`; `failure` is where the server would say it didn't. */
async function set(url: string, method: string, args: object, key: string, failure: "notCreated" | "notUpdated" | "notDestroyed") {
  const res = await call(url, [[method, args, "s"]]);
  if (res?.[failure]?.[key]) {
    console.error("[mail] mail server refused", method, JSON.stringify(res[failure][key]));
    throw new UserError("The mail server refused a group change", 502);
  }
  return res;
}
