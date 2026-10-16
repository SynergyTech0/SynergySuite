import { redirect } from 'next/navigation';
import { pageUser } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const auth = await pageUser();
  redirect(auth ? '/account' : '/login');
}
