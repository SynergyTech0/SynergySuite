import { body, route } from "@/lib/api";
import { person, saveProfile, type ProfileInput } from "@/lib/directory";

export const GET = route(async (me) => person(me.email).catch(() => saveProfile(me.email, { name: me.name })));

export const PUT = route(async (me, req) => saveProfile(me.email, await body<Partial<ProfileInput>>(req)));
