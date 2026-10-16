import { route, jsonBody, NotFoundError } from '@/lib/api';
import { controlDetail, updateControl, ValidationError } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/** GET /api/controls/:key — control with its cross-framework mappings, evidence and monitors. */
export const GET = route(async (session, _req, ctx) => {
  const { key } = await ctx.params;
  const detail = await controlDetail(session, key);
  if (!detail) throw new NotFoundError(`no control with key '${key}'`);
  return detail;
});

/**
 * PATCH /api/controls/:key
 *
 * Body: { status?, na_rationale?, notes? }
 *
 * The update and its audit-log entry commit in one transaction — a status change that left
 * no trace would undermine the record the whole product rests on. Marking a control
 * not_applicable without a rationale is rejected with 400 rather than stored.
 */
export const PATCH = route(async (session, req, ctx) => {
  const { key } = await ctx.params;
  const body = await jsonBody(req);

  // Only these three fields are writable here. Silently ignoring an unknown key would let a
  // caller believe it had set something it had not.
  const allowed = new Set(['status', 'na_rationale', 'notes']);
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length) {
    throw new ValidationError(
      `unsupported field(s): ${unknown.join(', ')}. Writable: ${[...allowed].join(', ')}`,
    );
  }

  const patch: Parameters<typeof updateControl>[2] = {};
  if ('status' in body) {
    if (typeof body.status !== 'string') throw new ValidationError('status must be a string');
    patch.status = body.status as NonNullable<typeof patch.status>;
  }
  if ('na_rationale' in body) {
    if (body.na_rationale !== null && typeof body.na_rationale !== 'string') {
      throw new ValidationError('na_rationale must be a string or null');
    }
    patch.na_rationale = body.na_rationale as string | null;
  }
  if ('notes' in body) {
    if (body.notes !== null && typeof body.notes !== 'string') {
      throw new ValidationError('notes must be a string or null');
    }
    patch.notes = body.notes as string | null;
  }
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('nothing to update');
  }

  const control = await updateControl(session, key, patch, {
    userId: session.userId,
    label: session.userEmail,
  });
  return { control };
}, { write: true });
