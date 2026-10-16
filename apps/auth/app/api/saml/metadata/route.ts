import { samlIdp } from '@/lib/saml';

export async function GET() {
  const idp = await samlIdp();
  return new Response(idp.getMetadata(), {
    headers: { 'Content-Type': 'application/xml' },
  });
}
