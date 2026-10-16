import { appUrl } from "@synergy/config";
import { route } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/access";

export const GET = route("compliance", async (me) => ({ ...me, roleLabel: ROLE_LABEL[me.role], authConsole: `${appUrl("auth")}/admin` }));
