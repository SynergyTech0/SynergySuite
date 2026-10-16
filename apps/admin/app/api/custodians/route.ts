import { route } from "@/lib/api";
import { suggest } from "@/lib/directory";

// The custodian picker: names and emails only, for anyone who uses Compliance.
export const GET = route("compliance", async (_me, req) => suggest(new URL(req.url).searchParams.get("q") ?? ""));
