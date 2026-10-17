import { json, sameOrigin } from '@/lib/http';
import { currentUser } from '@/lib/session';
import { audit } from '@/lib/audit';
import { revoke } from '@/lib/app-passwords';

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await currentUser(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  if (!sameOrigin(req)) return json({ error: 'cross_site' }, 403);
  const { id } = await ctx.params;
  if (!(await revoke(auth.user.id, id))) return json({ error: 'not_found' }, 404);
  await audit('app_password.revoked', auth.user.email, { id }, req);
  return json({ ok: true });
}
