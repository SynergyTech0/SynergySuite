import { type Params, body, route } from "@/lib/api";
import { balances, ledger, updateAccount } from "@/lib/trust";

/** The account's ledger and what each client holds in it. */
export const GET = route(async (me, _req, { params }: Params<"id">) => {
  const { id } = await params;
  return { ledger: await ledger(me, { accountId: id }), balances: await balances(me, id) };
});
export const PATCH = route(async (me, req, { params }: Params<"id">) => {
  await updateAccount(me, (await params).id, await body(req));
  return { ok: true };
});
