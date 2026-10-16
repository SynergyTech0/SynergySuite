import { type Params, body } from "@/lib/api";
import { registerResource, svcRoute, unregisterResource } from "@/lib/svc";

/** Another app links what it made for the group: { app, ref, name, url } (suite servers only). */
export const POST = svcRoute(async (req, { params }: Params<"id">) => registerResource((await params).id, await body(req)));

/** ?app= takes that link away again. */
export const DELETE = svcRoute(async (req, { params }: Params<"id">) =>
  unregisterResource((await params).id, new URL(req.url).searchParams.get("app") ?? ""));
