import { route } from "@/lib/api";
import * as drive from "@/lib/drive";

/** Empty the recycle bin. */
export const DELETE = route(async (me) => drive.emptyTrash(me));
