import { route } from "@/lib/api";
import { UserError, getAccount, removeAccount } from "@/lib/accounts";
import { policy } from "@/lib/policy";
import { sweepAccount } from "@/lib/preserver";

export const dynamic = "force-dynamic";

export const DELETE = route(async ({ user }, _req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  // Legal hold: one last copy of what arrived since the sweep's last pass, while Mail can still
  // sign in. What was preserved stays searchable after the account is gone.
  if (/^\d+$/.test(id) && (await policy().onHold(user))) {
    const acct = await getAccount(user, id).catch(() => null);
    if (acct) await sweepAccount(acct).catch((err) => console.error(`[mail] couldn't preserve ${acct.address} before removing it:`, (err as Error).message));
  }
  if (!(await removeAccount(user, id))) throw new UserError("No such account", 404);
  return { ok: true };
});
