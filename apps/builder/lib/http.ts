import { NextResponse } from "next/server";
import { currentUser } from "./session";
import type { Identity } from "@synergy/identity";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const notFound = () => new HttpError(404, "Not found");
export const forbidden = (what = "You can't change this app") => new HttpError(403, what);

/** Postgres errors people can act on, in their words; anything else is a 500. */
function fromPg(err: { code?: string; detail?: string }): HttpError | null {
  switch (err.code) {
    case "23505":
      return new HttpError(409, "That value is already used in a field that doesn't allow duplicates");
    case "23503":
      return /still referenced/.test(err.detail ?? "")
        ? new HttpError(409, "Records in a related table still point at this one; delete or change them first")
        : new HttpError(400, "That related record doesn't exist");
    case "23502":
      return new HttpError(400, "A required field is empty");
    case "22P02":
    case "22007":
    case "22008":
    case "22003":
    case "42804":
    case "42846":
      return new HttpError(400, "Some existing values can't be converted to that type");
    case "57014":
      return new HttpError(408, "That took too long and was stopped");
    default:
      return null;
  }
}

type Ctx<P> = { params: Promise<P> };

/**
 * A route handler that requires a signed-in user and answers errors as JSON. Errors with a
 * 4xx status (HttpError, FieldValueError, recognised Postgres errors) pass their message on.
 */
export function route<P = Record<string, string>>(fn: (req: Request, me: Identity, params: P) => Promise<Response | unknown>) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    const me = await currentUser();
    if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    try {
      const out = await fn(req, me, await ctx.params);
      if (out instanceof Response) return out;
      if (out === undefined) return new NextResponse(null, { status: 204 });
      return NextResponse.json(out);
    } catch (e) {
      const err = e as Error & { status?: number; code?: string };
      const known = typeof err.status === "number" && err.status >= 400 && err.status < 500 ? err : fromPg(err);
      if (known) return NextResponse.json({ error: known.message }, { status: known.status });
      console.error("[builder]", err);
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}

/** The JSON body, or a 400 when there isn't one. */
export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  const data = await req.json().catch(() => null);
  if (!data || typeof data !== "object") throw new HttpError(400, "Expected a JSON body");
  return data as T;
}
