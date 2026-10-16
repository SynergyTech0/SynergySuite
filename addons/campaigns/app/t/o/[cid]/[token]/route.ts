import { getContactByToken, recordEvent } from '@/lib/repo';

export const dynamic = 'force-dynamic';

// 1x1 transparent GIF
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export async function GET(_req: Request, { params }: { params: Promise<{ cid: string; token: string }> }) {
  const { cid, token } = await params;
  try {
    const c = await getContactByToken(token);
    if (c) await recordEvent(cid, c.id, c.email, 'open', null);
  } catch { /* never break the pixel */ }
  return new Response(PIXEL, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Content-Length': String(PIXEL.length),
    },
  });
}
