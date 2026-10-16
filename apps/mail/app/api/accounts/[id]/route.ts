import { route } from "@/lib/api";
import { UserError, removeAccount } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export const DELETE = route(async ({ user }, _req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!(await removeAccount(user, id))) throw new UserError("No such account", 404);
  return { ok: true };
});
