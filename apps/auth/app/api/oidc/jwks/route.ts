import { json } from '@/lib/http';
import { jwks } from '@/lib/keys';

export async function GET() {
  return json(await jwks());
}
