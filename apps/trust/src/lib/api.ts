// Shared plumbing for the JSON API.

import { NextResponse } from 'next/server';
import {
  requireSession, requireWrite, requireAdmin, assertSameOrigin,
  NoSessionError, NoAccessError, ForbiddenError,
  type ReadySession,
} from './session';
import { ValidationError } from './queries';
import { AuthError } from './auth';

/** Dynamic-segment context. Next passes params as a promise. */
export type Ctx = { params: Promise<Record<string, string>> };

export type Handler<T> = (session: ReadySession, req: Request, ctx: Ctx) => Promise<T>;

export class NotFoundError extends Error {}

export type RouteOptions = {
  /** Mutating route: enforces same-origin and refuses read-only seats. */
  write?: boolean;
  /** Additionally restricts to owner/admin. */
  admin?: boolean;
};

function errorResponse(err: unknown) {
  if (err instanceof NoSessionError) {
    return NextResponse.json({ error: err.message, auth: 'required' }, { status: 401 });
  }
  // Signed in to the suite but not a member here: a different answer from "not signed in",
  // so a client shows "ask an admin" instead of sending the person to sign in again.
  if (err instanceof NoAccessError) {
    return NextResponse.json({ error: err.message, auth: 'no_access' }, { status: 403 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof ValidationError || err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  console.error('[api]', err);
  const message = err instanceof Error ? err.message : 'unknown error';
  return NextResponse.json({ error: message }, { status: 500 });
}

/**
 * Authenticated route.
 *
 * Validation errors keep their message: they explain a real requirement ("an N/A needs a
 * rationale"), and flattening them into a generic 400 throws away the only useful part of
 * the response.
 */
export function route<T>(handler: Handler<T>, opts: RouteOptions = {}) {
  return async (req: Request, ctx: Ctx = { params: Promise.resolve({}) }) => {
    try {
      // Origin is checked before anything else on a mutation, so a cross-site request is
      // refused without having touched the database.
      if (opts.write || opts.admin) await assertSameOrigin();
      const session = await requireSession();
      if (opts.write || opts.admin) requireWrite(session);
      if (opts.admin) requireAdmin(session);

      const body = await handler(session, req, ctx);
      return NextResponse.json(body satisfies T, {
        headers: { 'cache-control': 'no-store' },
      });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new ValidationError('request body must be a JSON object');
    }
    return body as Record<string, unknown>;
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError('request body must be valid JSON');
  }
}

export function requireString(body: Record<string, unknown>, field: string): string {
  const v = body[field];
  if (typeof v !== 'string' || !v.trim()) {
    throw new ValidationError(`'${field}' is required`);
  }
  return v;
}
