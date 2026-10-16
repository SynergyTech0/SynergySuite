// Collector: http_security_headers
//
// Checks the response headers that browsers act on. These are cheap to set, are checked by
// every security questionnaire, and their absence is invisible until someone looks — which
// is precisely the shape of thing a continuous monitor is for.
//
// Checked against the FINAL response after redirects, because that is the document the
// browser actually applies a policy to. A site that sets HSTS on its apex redirect and
// nothing on the page it lands on is not protected.

import { createHash } from 'node:crypto';

export const kind = 'http_security_headers';
export const version = '0.1.0';
export const title = 'Public sites send the browser security headers';
export const description =
  'Requests each public URL and inspects the response headers a browser enforces: HSTS, CSP, X-Content-Type-Options, X-Frame-Options and Referrer-Policy. Follows redirects and judges the final response, since that is the document a policy is applied to.';
export const defaultSeverity = 'medium';
export const requiresHostAccess = false;
export const suggestedControls = ['CM-SDLC', 'NET-BOUNDARY'];

// `required` headers fail the control. `advisory` ones are reported but do not, because a
// reasonable organisation can decline them — a check that is permanently red for a defensible
// reason teaches people to ignore the whole monitor.
const REQUIRED = [
  {
    header: 'strict-transport-security',
    label: 'HSTS',
    why: 'Without it the first request of every session can be downgraded to plaintext.',
    validate: (v) => {
      const age = /max-age=(\d+)/i.exec(v)?.[1];
      if (!age) return { ok: false, detail: 'no max-age' };
      return Number(age) >= 15552000
        ? { ok: true, detail: `max-age=${age}` }
        : { ok: false, detail: `max-age=${age} is under the 180-day minimum` };
    },
  },
  {
    header: 'x-content-type-options',
    label: 'X-Content-Type-Options',
    why: 'Stops a browser second-guessing a declared content type and executing an upload.',
    validate: (v) => ({ ok: v.trim().toLowerCase() === 'nosniff', detail: v }),
  },
];

const ADVISORY = [
  {
    header: 'content-security-policy',
    label: 'CSP',
    why: 'The strongest defence against cross-site scripting, but needs tuning per site.',
  },
  {
    header: 'x-frame-options',
    label: 'X-Frame-Options',
    why: 'Clickjacking protection. Superseded by CSP frame-ancestors where that is set.',
  },
  {
    header: 'referrer-policy',
    label: 'Referrer-Policy',
    why: 'Stops full URLs leaking to third parties through the Referer header.',
  },
];

export function validateConfig(config) {
  if (!config || typeof config !== 'object') return { ok: false, reason: 'config must be an object' };
  if (!Array.isArray(config.urls) || config.urls.length === 0) {
    return { ok: false, reason: 'urls must be a non-empty array' };
  }
  for (const u of config.urls) {
    if (typeof u !== 'string') return { ok: false, reason: 'each url must be a string' };
    let parsed;
    try {
      parsed = new URL(u);
    } catch {
      return { ok: false, reason: `not a valid URL: ${u}` };
    }
    if (parsed.protocol !== 'https:') {
      return { ok: false, reason: `urls must be https (got ${parsed.protocol}//): ${u}` };
    }
  }
  return { ok: true };
}

export async function run(config) {
  const urls = config.urls;
  const timeoutMs = config.timeout_ms ?? 12_000;

  const results = {};
  const failures = [];
  const advisoryGaps = [];
  const unreachable = [];

  for (const url of urls) {
    let res;
    try {
      res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'synergy-trust-collector/0.1 (compliance evidence)' },
      });
    } catch (err) {
      unreachable.push({ url, error: String(err.message).slice(0, 120) });
      results[url] = { reachable: false };
      continue;
    }

    const present = {};
    for (const rule of REQUIRED) {
      const raw = res.headers.get(rule.header);
      if (!raw) {
        present[rule.header] = { ok: false, value: null, detail: 'absent' };
        failures.push({ url, header: rule.header, label: rule.label, issue: 'absent', why: rule.why });
      } else {
        const v = rule.validate(raw);
        present[rule.header] = { ok: v.ok, value: raw, detail: v.detail };
        if (!v.ok) {
          failures.push({ url, header: rule.header, label: rule.label, issue: v.detail, why: rule.why });
        }
      }
    }

    const advisory = {};
    for (const rule of ADVISORY) {
      const raw = res.headers.get(rule.header);
      advisory[rule.header] = { present: !!raw, value: raw };
      if (!raw) advisoryGaps.push({ url, header: rule.header, label: rule.label, why: rule.why });
    }

    // Not a pass/fail condition, but worth recording: a precise version in the Server
    // header hands an attacker the CVE list for that build without any probing.
    const server = res.headers.get('server');
    const versionLeak = server && /\d+\.\d+/.test(server) ? server : null;

    results[url] = {
      reachable: true,
      final_url: res.url,
      status: res.status,
      required: present,
      advisory,
      server_version_disclosed: versionLeak,
    };
  }

  const observed = {
    urls,
    required_headers: REQUIRED.map((r) => ({ header: r.header, why: r.why })),
    advisory_headers: ADVISORY.map((r) => ({ header: r.header, why: r.why })),
    failures,
    advisory_gaps: advisoryGaps,
    unreachable,
    results,
    checked_at: new Date().toISOString(),
  };

  if (unreachable.length === urls.length) {
    return {
      status: 'error',
      message: `none of the ${urls.length} URL(s) could be fetched`,
      observed,
    };
  }

  const checked = urls.length - unreachable.length;
  const parts = [];
  if (failures.length) {
    const byHeader = [...new Set(failures.map((f) => f.label))];
    parts.push(
      `${failures.length} required-header gap(s) across ${
        new Set(failures.map((f) => f.url)).size
      } site(s): ${byHeader.join(', ')} missing or weak`,
    );
  }
  if (unreachable.length) parts.push(`${unreachable.length} URL(s) unreachable`);

  return {
    status: failures.length ? 'fail' : unreachable.length ? 'error' : 'pass',
    message: parts.length
      ? parts.join('; ')
      : `${checked}/${urls.length} site(s) send all required headers` +
        (advisoryGaps.length ? `; ${advisoryGaps.length} advisory header(s) not set` : ''),
    observed,
    content_hash: hash(observed),
  };
}

function hash(observed) {
  return createHash('sha256').update(JSON.stringify(observed)).digest('hex');
}
