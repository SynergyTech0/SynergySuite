import { NextResponse, type NextRequest } from 'next/server';

/*
 * Security headers on every response. The hosted login/consent pages are the
 * sensitive surface — frame-ancestors 'none' + X-Frame-Options DENY block
 * clickjacking of the consent screen (a real OAuth attack). The CSP is strict
 * because the app ships no inline <script> (only React hydration + inline
 * styles, which 'unsafe-inline' in style-src covers) and loads nothing external.
 */
// Next.js dev mode compiles with eval() for HMR/source maps, so 'unsafe-eval'
// is required in development only. Production bundles don't use eval — the CSP
// stays strict there.
const DEV = process.env.NODE_ENV !== 'production';
const BASE_CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${DEV ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:", // TOTP QR is a data: URI
  "connect-src 'self'",
  "worker-src 'self'", // Synergy Authenticator service worker
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join('; ');

/*
 * form-action also governs the redirects that follow a form post. Signing in posts to
 * /api/auth/login, which redirects to /api/oidc/authorize, which redirects to the client's
 * redirect URI, e.g. the suite gateway at https://sso.<domain>. Browsers block that last hop
 * under form-action 'self', so the suite's own origins (siblings of auth.<domain>) are allowed.
 */
function formAction(req: NextRequest): string {
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '')
    .split(',')[0].trim().split(':')[0].toLowerCase();
  const dot = host.indexOf('.');
  const parent = dot > 0 ? host.slice(dot + 1) : '';
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(parent)) return "form-action 'self'";
  return `form-action 'self' https://*.${parent}`;
}

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  res.headers.set('Content-Security-Policy', `${BASE_CSP}; ${formAction(req)}`);
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  // camera=(self): the Synergy Authenticator scans enrollment QR codes on this origin.
  res.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(self), payment=()');
  if (process.env.NODE_ENV === 'production') {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return res;
}

export const config = {
  // Everything except Next's static assets (which don't need the headers and
  // are hot-path). API routes and pages all get covered.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
