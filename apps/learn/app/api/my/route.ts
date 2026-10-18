import { route } from "@/lib/api";
import { myLearning } from "@/lib/learn";

export const GET = route(async (me) => myLearning(me));
