import { createManagedLibrary, svcRoute } from "@/lib/svc";

/** A library another suite app keeps the people of (see lib/svc.ts). */
export const POST = svcRoute(async (req) => createManagedLibrary(await req.json().catch(() => ({}))));
