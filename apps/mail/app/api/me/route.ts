import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route(async ({ user }) => ({ email: user }));
