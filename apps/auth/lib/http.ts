import { NextResponse } from 'next/server';

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export const oauthError = (error: string, description: string, status = 400) =>
  json({ error, error_description: description }, status);

export const redirect = (url: string, setCookie?: string) => {
  const res = new NextResponse(null, { status: 303, headers: { Location: url } });
  if (setCookie) res.headers.set('Set-Cookie', setCookie);
  return res;
};

export async function formBody(req: Request): Promise<URLSearchParams> {
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const obj = await req.json().catch(() => ({}));
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) p.set(k, String(v));
    return p;
  }
  const text = await req.text();
  return new URLSearchParams(text);
}

/** Changes come only from the account page itself, not from another suite app's origin. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return req.headers.get('sec-fetch-site') !== 'cross-site' && req.headers.get('sec-fetch-site') !== 'same-site';
  try {
    return new URL(origin).host === (req.headers.get('x-forwarded-host') ?? req.headers.get('host'));
  } catch {
    return false;
  }
}

/*
 * CORS for what the suite header (<synergy-app-bar>, on every app's own subdomain) reads from here
 * with the sign-in cookie. Only https origins under SUITE_DOMAIN, plus localhost ports outside
 * production; anyone else gets no CORS headers, so their browser keeps the answer from them.
 * The answer differs by Origin, so it goes out with json()'s no-store (Next replaces Vary).
 */
export function suiteCors(req: Request, env: Record<string, string | undefined> = process.env): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin) return {};
  const allow = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' };
  try {
    const u = new URL(origin);
    const domain = (env.SUITE_DOMAIN ?? '').toLowerCase();
    if (domain && u.protocol === 'https:' && (u.hostname === domain || u.hostname.endsWith(`.${domain}`))) return allow;
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (env.NODE_ENV !== 'production' && local && (u.protocol === 'http:' || u.protocol === 'https:')) return allow;
  } catch {
    /* not a URL */
  }
  return {};
}
