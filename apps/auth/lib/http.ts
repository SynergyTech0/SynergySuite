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
