import { UserError } from "@/lib/accounts";
import { deleteGroup, putGroup } from "@/lib/groups";
import { svcRoute } from "@/lib/svc";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ address: string }> };
const EMAIL = /^[^@\s/<>"]+@[^@\s/<>"]+\.[^@\s/<>"]+$/;

async function addressOf({ params }: Params): Promise<string> {
  let a = (await params).address;
  try { a = decodeURIComponent(a); } catch { /* already decoded */ }
  a = a.trim().toLowerCase();
  if (!EMAIL.test(a)) throw new UserError("Bad address");
  return a;
}

/**
 * For the Groups app: { kind: "list" | "shared", name, members: [emails] } makes the address on
 * the mail server a distribution list or a shared mailbox with exactly those members.
 * -> { address, provisioned, note?, skipped? }
 */
export const PUT = svcRoute(async (req, ctx: Params) => {
  const address = await addressOf(ctx);
  const b = (await req.json().catch(() => null)) as { kind?: unknown; name?: unknown; members?: unknown } | null;
  if (!b || (b.kind !== "list" && b.kind !== "shared")) throw new UserError('kind must be "list" or "shared"');
  if (!Array.isArray(b.members) || b.members.some((m) => typeof m !== "string")) throw new UserError("members must be a list of addresses");
  const members = [...new Set((b.members as string[]).map((m) => m.trim().toLowerCase()).filter(Boolean))];
  const bad = members.find((m) => !EMAIL.test(m));
  if (bad) throw new UserError(`"${bad}" is not an email address`);
  const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 200) : address;
  return putGroup(address, { kind: b.kind, name, members });
});

export const DELETE = svcRoute(async (_req, ctx: Params) => deleteGroup(await addressOf(ctx)));
