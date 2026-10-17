import { body, route } from "@/lib/api";
import { androidEnrollment } from "@/lib/mdm/android";

/** { mode: work_profile|fully_managed, org }: a one-time enrollment link and QR code for an Android phone. */
export const POST = route(async (me, req) => androidEnrollment(me, await body<{ mode?: unknown; org?: unknown }>(req)));
