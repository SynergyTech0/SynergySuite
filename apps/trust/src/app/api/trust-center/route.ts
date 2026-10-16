import { route, jsonBody } from '@/lib/api';
import { getSettings, saveSettings, TrustCenterError } from '@/lib/trust-center';
import { ValidationError } from '@/lib/queries';
import { appUrl } from '@synergy/config';

export const dynamic = 'force-dynamic';

/** The public page's address: https://trust.SUITE_DOMAIN/trust/<slug>, or localhost in development. */
function publicUrl(slug: string | null | undefined) {
  return slug ? `${appUrl('trust')}/trust/${slug}` : null;
}

/** GET /api/trust-center — current public-page settings for this tenant. */
export const GET = route(async (session) => {
  const settings = await getSettings(session.tenantId);
  return { settings, public_url: publicUrl(settings?.public_slug) };
});

/**
 * PATCH /api/trust-center
 *
 * Admin only, and marked as a write: turning this on publishes information about the
 * organisation to anyone with the URL, which is an outward-facing change.
 */
export const PATCH = route(async (session, req) => {
  const body = await jsonBody(req);
  const allowed = new Set([
    'enabled', 'public_slug', 'headline', 'intro', 'security_contact',
    'show_frameworks', 'show_control_counts', 'show_policies', 'show_subprocessors',
    'framework_ids',
  ]);
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length) {
    throw new ValidationError(`unsupported field(s): ${unknown.join(', ')}`);
  }
  try {
    const settings = await saveSettings(session.tenantId, body, {
      userId: session.userId,
      label: session.userEmail,
    });
    return { ok: true, settings, public_url: publicUrl(settings?.public_slug) };
  } catch (err) {
    if (err instanceof TrustCenterError) throw new ValidationError(err.message);
    throw err;
  }
}, { admin: true });
