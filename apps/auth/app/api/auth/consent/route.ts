import { redirect, formBody } from '@/lib/http';
import { currentUser } from '@/lib/session';
import { saveGrant } from '@/lib/oauth';
import { audit } from '@/lib/audit';

export async function POST(req: Request) {
  const body = await formBody(req);
  const returnTo = body.get('return_to') ?? '';
  const clientId = body.get('client_id') ?? '';
  const scope = body.get('scope') ?? '';
  const decision = body.get('decision') ?? '';

  const auth = await currentUser(req);
  if (!auth) return redirect('/login');
  // return_to must be our own authorize URL
  if (!returnTo.startsWith('/api/oidc/authorize?')) return redirect('/account');

  if (decision !== 'approve') {
    await audit('consent.denied', auth.user.email, { client_id: clientId }, req);
    return redirect('/account?consent=denied');
  }
  await saveGrant(auth.user.id, clientId, scope);
  await audit('consent.granted', auth.user.email, { client_id: clientId, scope }, req);
  return redirect(returnTo);
}
