import { route } from "@/lib/api";
import * as members from "@/lib/members";

export const GET = route(async () => members.list());
